// services/llm.js
// ─────────────────────────────────────────────────────────────────────────────
// The ONE LLM client for the whole backend: Gemini primary, OpenRouter
// automatic fallback. Replaces the four copy-pasted generateWithFallback /
// MODEL_PRIORITY / parseRetryDelay / sleep blocks in services/gemini.service.js,
// services/skillGapService.js, services/aiQuestionService.js,
// services/aiSkillExtractionService.js — plus chatbotService.js's hardcoded
// retired model. Uses the official @google/genai SDK (the old
// @google/generative-ai SDK is removed) plus plain fetch() for OpenRouter's
// OpenAI-compatible endpoint.
//
// Public API (unchanged for existing callers):
//   generateText({ prompt, system?, temperature?, maxOutputTokens?, models?, promptTag? }) -> string
//   generateJSON({ ...same, schema?, responseSchema? }) -> parsed JSON (optionally Zod-validated)
//   extractJSON(text)                                  -> JSON.parse with fence/prose trimming
//   isLLMAvailable() / disableLLM(reason)              -> availability / permanent disable (BOTH providers)
//   getModelList(override?)                            -> the Gemini model chain
//   getOpenRouterModelList(override?)                  -> the OpenRouter model chain
//   getProviderStats()                                 -> per-provider counters (diagnostics/tests)
//   LLMConfigError, LLMOutputError                     -> typed errors
//   resetLLMForTests()                                 -> TEST-ONLY state reset (not a runtime API)
//
// Provider chain (LLM_PROVIDER env, default "auto"):
//   auto        Gemini chain first (existing model-fallback behaviour). Only
//               when the WHOLE Gemini chain fails (invalid key, 403, 429 across
//               all models, network, 5xx — and, simpler, also prompt-level
//               errors) do we iterate the OpenRouter model list with the SAME
//               prompt/schema. A provider-level Gemini failure starts a
//               COOLDOWN: Gemini is skipped for GEMINI_COOLDOWN_MS (default
//               10 min) so subsequent calls go straight to OpenRouter, then
//               Gemini is retried first again. The fallback answer NEVER
//               permanently disables Gemini (the key may recover after
//               rotation) — only disableLLM() (or an invalid key with no
//               fallback configured) disables.
//   gemini      Gemini only — exactly the legacy behaviour (invalid key ->
//               permanent disable + LLMConfigError).
//   openrouter  OpenRouter only (useful for debugging the fallback provider).
//
// Robustness (implemented once, shared by BOTH providers):
//   • fallback across a pinned Gemini model chain (404 / 503 / 429 / empty -> next model)
//   • one delayed retry pass when EVERY Gemini model is quota-limited (429) —
//     skipped when the OpenRouter fallback is available (fall back immediately
//     instead of sleeping)
//   • permanent disable after an invalid API key ONLY when no fallback exists
//   • optional Zod output validation with one corrective retry (typed
//     LLMOutputError afterwards) — runs identically for Gemini and OpenRouter
//     answers because both flow through extractJSON + validate below
//   • exactly one structured log line per call:
//     {provider, model, ok, ms, promptTag} (never prompt contents, never keys)
//   • cumulative per-provider counters via getProviderStats()
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI, ApiError } from "@google/genai";

// Pinned, current-generation Gemini models. Override with GEMINI_MODELS
// (comma-separated, ordered).
// Oct 2026: the Google API 404s the 2.5 generation for keys classed as "new
// users" ("no longer available to new users… use models/gemini-3.5…"), so the
// current generation leads and the 2.5 IDs stay as a legacy tail for older
// keys (a 404 just advances to the next model).
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

// Known-retired IDs — never used by default; warn if an env override asks for one.
const RETIRED_MODEL_PATTERN = /gemini-(1\.5|2\.0)(-(flash|pro|ultra))?/i;

// Free OpenRouter models (checked working Oct 2026 by probe, in order).
// Override with OPENROUTER_MODELS (comma-separated, ordered).
//   • nvidia/nemotron-3-super-120b-a12b:free was DROPPED from the default —
//     the NVIDIA provider route answers 404 for every request
//     ("Provider returned error / Not found for account"), even though the
//     model still appears in the public catalog.
const DEFAULT_OPENROUTER_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "minimax/minimax-m3.1-flash:free",
  "poolside/laguna-s-2.1:free",
];

/** OpenRouter is OpenAI-compatible: POST <base>/chat/completions */
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** Same request budget as the Gemini client — never hang a call indefinitely. */
const REQUEST_TIMEOUT_MS = 120_000;
/** How long Gemini is skipped after a provider-level failure (GEMINI_COOLDOWN_MS). */
const DEFAULT_GEMINI_COOLDOWN_MS = 10 * 60 * 1000;

let cachedModelList = null;

/**
 * Resolve the Gemini model fallback chain (ordered, first = primary).
 * @param {string[]} [override] per-call override list
 */
export function getModelList(override) {
  if (Array.isArray(override) && override.length > 0) {
    return override.map((m) => String(m).trim()).filter(Boolean);
  }
  if (cachedModelList) return cachedModelList;

  const raw = process.env.GEMINI_MODELS || "";
  const fromEnv = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  cachedModelList = fromEnv.length > 0 ? fromEnv : [...DEFAULT_MODELS];

  for (const model of cachedModelList) {
    if (RETIRED_MODEL_PATTERN.test(model)) {
      console.warn(
        `llm: GEMINI_MODELS contains retired model "${model}" — it will likely fail. ` +
          `Current defaults: ${DEFAULT_MODELS.join(",")}`,
      );
    }
  }
  return cachedModelList;
}

/**
 * Resolve the OpenRouter model fallback chain (ordered, first = primary).
 * Reads OPENROUTER_MODELS fresh on every call (cheap, keeps tests/dev edits
 * hot) — intentionally NOT cached like the Gemini chain.
 * @param {string[]} [override] per-call override list
 */
export function getOpenRouterModelList(override) {
  if (Array.isArray(override) && override.length > 0) {
    return override.map((m) => String(m).trim()).filter(Boolean);
  }
  const fromEnv = (process.env.OPENROUTER_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_OPENROUTER_MODELS];
}

// ── Typed errors ─────────────────────────────────────────────────────────────

/** Configuration problem (missing key, or key permanently disabled). */
export class LLMConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LLMConfigError";
    this.permanent = true;
  }
}

/** The model answered, but the output could not be parsed / validated. */
export class LLMOutputError extends Error {
  constructor(message, { raw = null, issues = null } = {}) {
    super(message);
    this.name = "LLMOutputError";
    this.raw = raw; // raw model output (never logged by this module)
    this.issues = issues; // Zod issues, when schema validation failed
  }
}

// ── Client lifecycle ─────────────────────────────────────────────────────────

let client = null;
let disabled = false;
let disableWarned = false;
let disabledReason = "";

function getApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

function getOpenRouterKey() {
  return process.env.FALLBACK_API_KEY_OPEN_ROUTER?.trim() || "";
}

/** "sk-o…" — safe to log/display. Never expose more than the first 4 chars. */
function maskKey(key) {
  const k = String(key || "");
  return k.length > 0 ? `${k.slice(0, 4)}…` : "(none)";
}

function getClient() {
  if (disabled) {
    throw new LLMConfigError(disabledMessage());
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new LLMConfigError("Gemini API not configured. Set GEMINI_API_KEY in .env");
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS }, // never hang a request indefinitely
    });
  }
  return client;
}

function disabledMessage() {
  return (
    `AI is disabled${disabledReason ? `: ${disabledReason}` : ""}. ` +
    "Set a valid GEMINI_API_KEY (and/or FALLBACK_API_KEY_OPEN_ROUTER) in " +
    "environment variables to enable AI responses."
  );
}

/**
 * True when a call to SOME configured LLM provider could succeed.
 * (Gemini-only mode requires a Gemini key; openrouter-only mode requires the
 * OpenRouter key; auto mode accepts either.)
 */
export function isLLMAvailable() {
  if (disabled) return false;
  const mode = getProviderMode();
  const geminiUsable = mode !== "openrouter" && Boolean(getApiKey());
  const openRouterUsable = mode !== "gemini" && Boolean(getOpenRouterKey());
  return geminiUsable || openRouterUsable;
}

/** Permanently disable BOTH providers (Gemini and OpenRouter). */
export function disableLLM(reason) {
  if (disabled) return;
  disabled = true;
  disabledReason = String(reason || "");
  client = null;
  if (!disableWarned) {
    disableWarned = true;
    console.warn(
      `AI is disabled${reason ? `: ${reason}` : ""}. ` +
        "Set a valid GEMINI_API_KEY (and/or FALLBACK_API_KEY_OPEN_ROUTER) in " +
        "environment variables to enable AI responses.",
    );
  }
}

// ── Provider mode / config logging ───────────────────────────────────────────

/** "auto" (default) | "gemini" | "openrouter" — unknown values fall back to auto. */
function getProviderMode() {
  const raw = String(process.env.LLM_PROVIDER || "")
    .toLowerCase()
    .trim();
  if (raw === "gemini" || raw === "openrouter") return raw;
  return "auto";
}

let configLogged = false;

/**
 * Lazy, non-fatal startup validation: one line telling operators whether the
 * OpenRouter fallback is active. Logs the key MASKED (first 4 chars only).
 */
function ensureConfigLogged() {
  if (configLogged) return;
  configLogged = true;
  const key = getOpenRouterKey();
  const mode = getProviderMode();
  if (key) {
    const models = getOpenRouterModelList();
    console.log(
      `llm: OpenRouter fallback enabled (${models.length} models, key ${maskKey(key)}, mode ${mode})`,
    );
  } else {
    console.log(`llm: OpenRouter fallback disabled (FALLBACK_API_KEY_OPEN_ROUTER not set, mode ${mode})`);
  }
}

// ── Cooldown state ───────────────────────────────────────────────────────────

let geminiCooldownUntil = 0;

function geminiCooldownMs() {
  const raw = Number(process.env.GEMINI_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_GEMINI_COOLDOWN_MS;
}

function geminiInCooldown() {
  return Date.now() < geminiCooldownUntil;
}

/** Skip Gemini for GEMINI_COOLDOWN_MS after a provider-level failure. */
function startGeminiCooldown(err) {
  const ms = geminiCooldownMs();
  geminiCooldownUntil = Date.now() + ms;
  stats.gemini.cooldowns += 1;
  console.warn(
    `llm: gemini provider failure (${classifyError(err)}) — cooling Gemini down for ` +
      `${ms}ms; OpenRouter answers until the cooldown expires`,
  );
}

// ── Provider stats (diagnostics / tests) ─────────────────────────────────────

const stats = {
  gemini: { calls: 0, failures: 0, cooldowns: 0 },
  openrouter: { calls: 0, failures: 0, cooldowns: 0 },
};

/**
 * Cumulative per-provider call counters + availability snapshot.
 * Chain-level counting: one logical generateText/generateJSON attempt on a
 * provider = 1 call; 1 failure when that provider's whole chain failed.
 */
export function getProviderStats() {
  return {
    mode: getProviderMode(),
    disabled,
    gemini: {
      ...stats.gemini,
      configured: Boolean(getApiKey()),
      models: [...getModelList()],
      inCooldown: geminiInCooldown(),
      cooldownRemainingMs: Math.max(0, geminiCooldownUntil - Date.now()),
    },
    openrouter: {
      ...stats.openrouter,
      configured: Boolean(getOpenRouterKey()),
      keyMasked: maskKey(getOpenRouterKey()),
      models: getOpenRouterModelList(),
    },
  };
}

/** TEST-ONLY: reset module state (disable flag, cooldown, counters, client). */
export function resetLLMForTests() {
  disabled = false;
  disableWarned = false;
  disabledReason = "";
  client = null;
  geminiCooldownUntil = 0;
  configLogged = false;
  for (const provider of Object.keys(stats)) {
    stats[provider].calls = 0;
    stats[provider].failures = 0;
    stats[provider].cooldowns = 0;
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse "retry in Ns" from a 429 message; default 60s, capped at 120s. */
function parseRetryDelay(err) {
  const msg = String(err?.message || err);
  const match = msg.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.min(parseFloat(match[1]) || 60, 120);
  return 60;
}

/** Classify an API failure to decide: next model / retry / permanent disable. */
function classifyError(err) {
  if (err instanceof LLMConfigError) return "badkey";
  const status = err instanceof ApiError ? err.status : Number(err?.status) || undefined;
  const msg = String(err?.message || err);
  const lower = msg.toLowerCase();

  if (
    /api[_ ]key not valid/i.test(msg) ||
    /API_KEY_INVALID/i.test(msg) ||
    /api_key_invalid/i.test(msg) ||
    /api key rejected/i.test(msg) ||
    (status === 403 && lower.includes("api key"))
  ) {
    return "badkey";
  }
  if (status === 429 || lower.includes("429") || lower.includes("too many requests") || lower.includes("quota")) {
    return "quota";
  }
  if (status === 404 || lower.includes("404") || lower.includes("not found")) return "notfound";
  if (status === 503 || lower.includes("503") || lower.includes("unavailable")) return "unavailable";
  return "fatal";
}

/**
 * Provider-level (infrastructure) failure vs prompt-level (400/safety) error.
 * Provider-level failures start the Gemini cooldown; prompt-level ones still
 * fall through to OpenRouter (simpler) but Gemini is retried first next call.
 */
function isProviderLevelError(err) {
  if (err instanceof LLMConfigError) return true; // rejected/missing key
  const kind = classifyError(err);
  if (kind === "badkey" || kind === "quota" || kind === "unavailable" || kind === "notfound") return true;
  const status = Number(err?.status) || 0;
  if (status >= 500) return true;
  const lower = String(err?.message || "").toLowerCase();
  return /fetch failed|network|econnreset|etimedout|enotfound|eai_again|socket|premature|aborted|timeout|und_err|not ok/.test(
    lower,
  );
}

/** One structured telemetry line per call — no prompt text, no secrets. */
function logCall(provider, model, ok, startedAt, promptTag) {
  console.log(
    JSON.stringify({
      provider,
      model: model || null,
      ok,
      ms: Date.now() - startedAt,
      promptTag: promptTag || "llm",
    }),
  );
}

/** True when the OpenRouter fallback may absorb a Gemini failure. */
function fallbackAvailable() {
  return getProviderMode() !== "gemini" && Boolean(getOpenRouterKey());
}

// ── Gemini provider ──────────────────────────────────────────────────────────

/**
 * One Gemini model attempt. Returns trimmed text (throws on failure).
 */
async function callGeminiOnce(model, { prompt, system, temperature, maxOutputTokens, responseMimeType, responseSchema }) {
  const ai = getClient();
  const config = {};
  if (system) config.systemInstruction = system;
  if (temperature !== undefined) config.temperature = temperature;
  if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;
  if (responseMimeType) config.responseMimeType = responseMimeType;
  if (responseSchema) config.responseSchema = responseSchema;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config,
  });
  const text = (response.text ?? "").trim();
  if (!text) {
    const err = new Error(`Empty response from model ${model}`);
    err.status = 502;
    throw err;
  }
  return text;
}

/**
 * Run the full Gemini fallback chain + one quota retry pass (legacy behaviour).
 * Returns { text, model, provider: "gemini" }.
 */
async function geminiChain(params) {
  const list = getModelList(params.models);
  const startedAt = Date.now();
  const promptTag = params.promptTag;
  const canFallback = fallbackAvailable();

  let lastError = null;
  let lastModel = null;

  for (let pass = 0; pass < 2; pass += 1) {
    let sawQuotaThisPass = false;

    for (const model of list) {
      lastModel = model;
      try {
        const text = await callGeminiOnce(model, params);
        logCall("gemini", model, true, startedAt, promptTag);
        return { text, model, provider: "gemini" };
      } catch (err) {
        lastError = err;
        const kind = classifyError(err);

        if (kind === "badkey") {
          logCall("gemini", model, false, startedAt, promptTag);
          const configErr = new LLMConfigError(
            "Gemini API key rejected by the API. Check GEMINI_API_KEY in the environment.",
          );
          if (canFallback) {
            // Do NOT permanently disable: OpenRouter can answer now, and the
            // key may recover later (rotation). The caller starts a cooldown.
            throw configErr;
          }
          disableLLM("invalid GEMINI_API_KEY"); // legacy: no fallback configured
          throw configErr;
        }
        if (kind === "quota") {
          sawQuotaThisPass = true;
          continue; // try the next model in the chain
        }
        if (kind === "notfound" || kind === "unavailable") {
          continue; // model retired / temporarily down — try the next one
        }

        // Fatal (network, 400, 500, safety, ...) — do not mask it behind fallbacks.
        logCall("gemini", model, false, startedAt, promptTag);
        throw err;
      }
    }

    // Delayed quota retry pass only when there is NO fallback provider — with
    // OpenRouter available we fall back immediately instead of sleeping.
    if (sawQuotaThisPass && pass === 0 && !canFallback) {
      const delay = Math.min(parseRetryDelay(lastError), 90);
      console.warn(`llm: every model hit quota (429) — retrying the chain in ${delay}s`);
      await sleep(delay * 1000);
      continue;
    }
    break;
  }

  logCall("gemini", lastModel, false, startedAt, promptTag);

  if (!lastError) {
    lastError = new Error("All Gemini models failed. Try updating GEMINI_API_KEY or check your internet connection.");
  } else if (classifyError(lastError) === "quota") {
    // Surface the friendly quota message the callers used to build themselves.
    lastError.message =
      "Gemini API quota exceeded. Please wait a few minutes or check your plan at https://ai.google.dev/gemini-api/docs/rate-limits";
  }
  throw lastError;
}

// ── OpenRouter provider (OpenAI-compatible) ──────────────────────────────────

/**
 * OpenRouter `reasoning` request config. Free reasoning models burn their
 * whole max_tokens budget on chain-of-thought otherwise and return EMPTY
 * content (finish_reason=length) after 20-30s. Default: {effort:"none"}.
 * Set OPENROUTER_REASONING_EFFORT="" to omit the field entirely, or to a
 * supported effort (minimal/low/medium/high/…) to keep some reasoning.
 */
function openRouterReasoningConfig() {
  if (!Object.prototype.hasOwnProperty.call(process.env, "OPENROUTER_REASONING_EFFORT")) {
    return { effort: "none" };
  }
  const raw = String(process.env.OPENROUTER_REASONING_EFFORT || "").trim();
  return raw ? { effort: raw } : null;
}

/**
 * One HTTP round-trip to OpenRouter. JSON is requested in the prompt itself
 * (free models do not reliably support response_format: json_schema), so we
 * never send it and instead rely on the SHARED extractJSON + Zod validation +
 * corrective retry downstream.
 * Returns trimmed assistant content (throws on failure).
 */
async function postOpenRouter(model, key, { prompt, system, temperature, maxOutputTokens }, { withReasoning }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content: String(prompt ?? "") });

  const body = { model, messages };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxOutputTokens !== undefined) body.max_tokens = maxOutputTokens; // OpenAI-style name
  const reasoning = withReasoning ? openRouterReasoningConfig() : null;
  if (reasoning) body.reasoning = reasoning;

  let res;
  try {
    res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "SkillMatch AI", // app attribution (OpenRouter recommended, no secrets)
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const wrapped = new Error(`OpenRouter network error: ${err?.message || err}`);
    wrapped.cause = err;
    throw wrapped;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body — handled below via res.ok / statusText
  }

  const apiError = data && typeof data === "object" ? data.error : null;
  if (!res.ok || apiError) {
    const code = Number(apiError?.code) || res.status;
    const message = String(apiError?.message || res.statusText || `HTTP ${res.status}`);
    const err = new Error(`OpenRouter ${code}: ${message}`);
    err.status = Number.isFinite(code) ? code : res.status;
    throw err;
  }

  const message = data?.choices?.[0]?.message;
  // Reasoning models may put scratch work in `reasoning` — the final answer
  // always lives in `content`, so `reasoning` is intentionally ignored.
  const text = String(message?.content ?? "").trim();
  if (!text) {
    const finish = data?.choices?.[0]?.finish_reason;
    const hint =
      finish === "length"
        ? " (finish_reason=length: output truncated by max_tokens — reasoning tokens consumed the budget)"
        : finish
          ? ` (finish_reason: ${finish})`
          : "";
    const err = new Error(`Empty response from OpenRouter model ${model}${hint}`);
    err.status = 502;
    throw err;
  }
  return text;
}

/**
 * One OpenRouter model attempt. Handles endpoints where reasoning is
 * MANDATORY (they 400 on reasoning:{effort:"none"}) by retrying the same
 * model once without the reasoning field.
 */
async function callOpenRouterOnce(model, key, params) {
  try {
    return await postOpenRouter(model, key, params, { withReasoning: true });
  } catch (err) {
    if (err.status === 400 && /reasoning/i.test(String(err.message)) && openRouterReasoningConfig()) {
      return postOpenRouter(model, key, params, { withReasoning: false });
    }
    throw err;
  }
}

/**
 * Run the OpenRouter model chain with the SAME prompt/schema as the Gemini
 * attempt. Returns { text, model, provider: "openrouter" }.
 */
async function openRouterChain(params) {
  const key = getOpenRouterKey();
  if (!key) {
    throw new LLMConfigError(
      "OpenRouter fallback not configured. Set FALLBACK_API_KEY_OPEN_ROUTER in .env",
    );
  }
  const models = getOpenRouterModelList();
  if (models.length === 0) {
    throw new LLMConfigError("OPENROUTER_MODELS is empty — set at least one model id.");
  }

  const startedAt = Date.now();
  const promptTag = params.promptTag;
  let lastError = null;

  for (const model of models) {
    try {
      const text = await callOpenRouterOnce(model, key, params);
      logCall("openrouter", model, true, startedAt, promptTag);
      return { text, model, provider: "openrouter" };
    } catch (err) {
      lastError = err;
      logCall("openrouter", model, false, startedAt, promptTag);
      if (err instanceof LLMConfigError) throw err; // config problem — no other model can help
      // 401/429/404/5xx/prompt-level: try the next model in the chain.
    }
  }

  throw lastError || new Error("OpenRouter: all models failed.");
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * One logical generation: Gemini chain first (unless openrouter-only or
 * cooling down), then the OpenRouter chain with the identical params.
 * Returns { text, model, provider }.
 */
async function requestText(params) {
  const mode = getProviderMode();
  ensureConfigLogged();

  if (disabled) {
    throw new LLMConfigError(disabledMessage());
  }

  const canFallback = fallbackAvailable();
  let geminiError = null;

  // ── 1. Gemini (primary) ──
  if (mode !== "openrouter") {
    if (!getApiKey()) {
      if (mode === "gemini" || !canFallback) {
        throw new LLMConfigError("Gemini API not configured. Set GEMINI_API_KEY in .env");
      }
      // No Gemini key but OpenRouter is configured: fall through silently.
    } else if (geminiInCooldown() && canFallback) {
      // Recent provider-level failure: skip Gemini (no stats — never attempted).
    } else {
      stats.gemini.calls += 1;
      try {
        return await geminiChain(params);
      } catch (err) {
        stats.gemini.failures += 1;
        if (disabled) throw err; // legacy permanent disable (badkey, no fallback)
        geminiError = err;

        if (isProviderLevelError(err)) startGeminiCooldown(err);

        if (mode === "gemini" || !canFallback) throw err;

        // auto + fallback available: log and fall through (prompt-level errors
        // fall through too — simpler — they just don't start a cooldown).
        console.warn(
          `llm: gemini failed (${classifyError(err)}${
            isProviderLevelError(err) ? ", provider-level" : ", prompt-level"
          }) — falling back to openrouter`,
        );
      }
    }
  }

  // ── 2. OpenRouter (fallback / only) ──
  if (mode !== "gemini") {
    if (getOpenRouterKey()) {
      stats.openrouter.calls += 1;
      try {
        return await openRouterChain(params);
      } catch (err) {
        stats.openrouter.failures += 1;
        if (!geminiError || mode === "openrouter") throw err;
        // Both providers failed: surface the PRIMARY (Gemini) error — callers
        // already handle its types — and keep the fallback error for diagnosis.
        geminiError.fallbackError = err;
        throw geminiError;
      }
    }
    if (mode === "openrouter") {
      throw new LLMConfigError(
        "LLM_PROVIDER=openrouter but FALLBACK_API_KEY_OPEN_ROUTER is not set.",
      );
    }
  }

  // ── 3. Nothing configured / nothing ran ──
  throw geminiError || new LLMConfigError(
    "No LLM provider configured. Set GEMINI_API_KEY or FALLBACK_API_KEY_OPEN_ROUTER in .env",
  );
}

/**
 * Strip markdown fences / surrounding prose and parse JSON.
 * Throws SyntaxError when nothing parseable is found.
 */
export function extractJSON(text) {
  let jsonStr = String(text ?? "").trim();

  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonStr = fence[1].trim();

  // Trim leading/trailing prose around the outermost JSON value.
  const firstOpen = jsonStr.search(/[{[]/);
  const lastClose = Math.max(jsonStr.lastIndexOf("}"), jsonStr.lastIndexOf("]"));
  if (firstOpen !== -1 && lastClose > firstOpen) {
    jsonStr = jsonStr.slice(firstOpen, lastClose + 1);
  }

  return JSON.parse(jsonStr);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate free-form text.
 * @returns {Promise<string>} trimmed response text
 */
export async function generateText({
  prompt,
  system,
  temperature,
  maxOutputTokens,
  models,
  promptTag = "text",
} = {}) {
  const { text } = await requestText({
    prompt: String(prompt ?? ""),
    system,
    temperature,
    maxOutputTokens,
    models,
    promptTag,
  });
  return text;
}

/**
 * Generate JSON, fence-stripped and parsed. Gemini gets
 * responseMimeType: application/json; OpenRouter is asked for JSON in the
 * prompt (free models often lack response_format support). Both paths then run
 * the SAME extractJSON + optional Zod validation; on failure the whole chain
 * is retried once with the validation error appended to the prompt, then a
 * typed LLMOutputError is thrown.
 * @returns {Promise<any>} parsed (and validated) JSON
 */
export async function generateJSON({
  prompt,
  system,
  schema,
  responseSchema,
  temperature,
  maxOutputTokens,
  models,
  promptTag = "json",
} = {}) {
  const base = { prompt: String(prompt ?? ""), system, temperature, maxOutputTokens, models, promptTag };

  const runOnce = async (effectivePrompt) => {
    const { text } = await requestText({ ...base, prompt: effectivePrompt, responseMimeType: "application/json", responseSchema });
    try {
      return { parsed: extractJSON(text), raw: text };
    } catch (err) {
      throw new LLMOutputError(`Failed to parse AI response as JSON: ${err.message}`, { raw: text });
    }
  };

  const validate = (parsed, raw) => {
    if (!schema || typeof schema.safeParse !== "function") return { ok: true, data: parsed };
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, data: result.data };
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, data: null, issues, raw };
  };

  const first = await runOnce(base.prompt);
  const firstCheck = validate(first.parsed, first.raw);
  if (firstCheck.ok) return firstCheck.data;

  // One corrective retry with the validation error appended to the prompt.
  const retryPrompt =
    `${base.prompt}\n\n` +
    `Your previous response failed validation: ${firstCheck.issues}. ` +
    "Return ONLY the corrected JSON, with no markdown and no extra text.";
  const second = await runOnce(retryPrompt);
  const secondCheck = validate(second.parsed, second.raw);
  if (secondCheck.ok) return secondCheck.data;

  throw new LLMOutputError(`AI response failed schema validation: ${secondCheck.issues}`, {
    raw: second.raw,
    issues: secondCheck.issues,
  });
}
