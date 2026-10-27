// tests/llmProvider.test.js
// Provider-chain tests for services/llm.js — Gemini primary + OpenRouter
// automatic fallback (LLM_PROVIDER=auto by default).
//
// ALL network is mocked: vi.stubGlobal("fetch", ...) intercepts BOTH the
// @google/genai SDK (its DEFAULT_FETCHER calls the GLOBAL fetch at call time)
// and services/llm.js's own OpenRouter request. No real network, no real keys —
// the fake keys below ("test-gemini-key" / "sk-or-test-key") are sent nowhere.
//
// Covered (task a–g):
//   (a) Gemini invalid-key  -> same prompt goes to OpenRouter, answer parsed
//   (b) Gemini success      -> OpenRouter never called
//   (c) both providers fail -> throw path (Gemini error primary, fallback attached)
//   (d) cooldown            -> after a provider failure the next call goes
//                              straight to OpenRouter; GEMINI_COOLDOWN_MS=0 ->
//                              Gemini is probed again (re-probe semantics)
//   (e) LLM_PROVIDER=openrouter skips Gemini (+ gemini-only + openrouter w/o key)
//   (f) disableLLM() disables BOTH providers
//   (g) JSON path: fenced JSON from OpenRouter -> extractJSON + Zod validation,
//       one corrective retry, typed LLMOutputError afterwards
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { z } from "zod";
import {
  generateText,
  generateJSON,
  isLLMAvailable,
  disableLLM,
  getProviderStats,
  getOpenRouterModelList,
  LLMConfigError,
  LLMOutputError,
  resetLLMForTests,
} from "../services/llm.js";

// ── Hermetic environment ─────────────────────────────────────────────────────
const ENV_KEYS = [
  "GEMINI_API_KEY",
  "FALLBACK_API_KEY_OPEN_ROUTER",
  "LLM_PROVIDER",
  "GEMINI_COOLDOWN_MS",
  "OPENROUTER_MODELS",
  "GEMINI_MODELS",
  "OPENROUTER_REASONING_EFFORT",
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// ── Fetch mock plumbing ──────────────────────────────────────────────────────
const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const geminiSuccess = (text) =>
  jsonResponse(200, {
    candidates: [
      { content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });

const geminiHttpError = (status, message) =>
  jsonResponse(status, { error: { code: status, message, status: "ERROR" } });

const openRouterSuccess = (content) =>
  jsonResponse(200, {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

const openRouterHttpError = (status, message) =>
  jsonResponse(status, { error: { code: status, message } });

let recorded = []; // { provider, url, body, headers }
let geminiImpl = () => geminiSuccess("{}");
let openRouterImpl = () => openRouterSuccess("{}");

const fetchMock = vi.fn(async (input, init) => {
  // The @google/genai SDK calls fetch with a single WHATWG Request object;
  // our own OpenRouter call uses (url, init). Handle both.
  const request =
    input && typeof input === "object" && typeof input.text === "function" ? input : null;
  const url = request ? request.url : typeof input === "string" ? input : String(input?.url ?? input);
  const headers = request
    ? Object.fromEntries(request.headers.entries())
    : (init?.headers ?? null);
  let rawBody = request ? await request.text() : init?.body;
  let body = null;
  if (typeof rawBody === "string") {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }
  const provider = /generativelanguage\.googleapis\.com/.test(url)
    ? "gemini"
    : /openrouter\.ai/.test(url)
      ? "openrouter"
      : "unknown";
  recorded.push({ provider, url, body, headers });
  if (provider === "gemini") return geminiImpl(url, body);
  if (provider === "openrouter") return openRouterImpl(url, body);
  throw new Error(`Unexpected network call in test: ${url}`);
});

const geminiCalls = () => recorded.filter((r) => r.provider === "gemini");
const orCalls = () => recorded.filter((r) => r.provider === "openrouter");

// Capture (and silence) the module's structured log/warn lines for assertions.
let logLines = [];
let warnLines = [];
const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
  logLines.push(args.map(String).join(" "));
});
const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
  warnLines.push(args.map(String).join(" "));
});

const structuredLogs = () =>
  logLines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry === "object");

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

beforeEach(() => {
  resetLLMForTests();
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.FALLBACK_API_KEY_OPEN_ROUTER = "sk-or-test-key";
  process.env.LLM_PROVIDER = "auto";
  process.env.GEMINI_COOLDOWN_MS = "60000";
  delete process.env.OPENROUTER_MODELS;
  delete process.env.GEMINI_MODELS;
  delete process.env.OPENROUTER_REASONING_EFFORT; // → default {effort:"none"}

  recorded = [];
  logLines = [];
  warnLines = [];
  fetchMock.mockClear();
  geminiImpl = () => geminiSuccess('{"from":"gemini"}');
  openRouterImpl = () => openRouterSuccess('{"from":"openrouter"}');
});

// ─────────────────────────────────────────────────────────────────────────────

describe("provider chain (LLM_PROVIDER=auto)", () => {
  it("(a) Gemini invalid-key → OpenRouter gets the SAME prompt and the answer parses", async () => {
    geminiImpl = () => geminiHttpError(400, "API key not valid. Follow this guide to fix it.");
    openRouterImpl = () => openRouterSuccess('{"answer":"fallback-ok"}');

    const out = await generateText({ prompt: "UNIQUE PROMPT 42", promptTag: "test.fallback" });

    expect(out).toBe('{"answer":"fallback-ok"}');

    // Same prompt, same shape, routed to OpenRouter with the key + chain head.
    expect(geminiCalls().length).toBeGreaterThan(0);
    const openRouter = orCalls();
    expect(openRouter).toHaveLength(1);
    expect(openRouter[0].body.model).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(openRouter[0].headers.Authorization).toBe("Bearer sk-or-test-key");
    expect(openRouter[0].body.messages).toEqual([{ role: "user", content: "UNIQUE PROMPT 42" }]);
    // Free models: JSON is requested via the prompt, never response_format.
    expect(openRouter[0].body).not.toHaveProperty("response_format");
    // Reasoning disabled by default (free reasoning models burn max_tokens on CoT).
    expect(openRouter[0].body.reasoning).toEqual({ effort: "none" });

    // A successful fallback answer must NOT permanently disable Gemini.
    expect(isLLMAvailable()).toBe(true);
    const stats = getProviderStats();
    expect(stats.disabled).toBe(false);
    expect(stats.gemini).toMatchObject({ calls: 1, failures: 1 });
    expect(stats.openrouter).toMatchObject({ calls: 1, failures: 0 });
    expect(stats.gemini.inCooldown).toBe(true);

    // Structured per-call log line: {provider, model, ok, ms, promptTag}.
    const answered = structuredLogs().find((entry) => entry.ok === true);
    expect(answered).toMatchObject({ provider: "openrouter", promptTag: "test.fallback" });
    expect(typeof answered.model).toBe("string");
    expect(typeof answered.ms).toBe("number");
  });

  it("(b) Gemini success → OpenRouter is never called", async () => {
    geminiImpl = () => geminiSuccess("gemini-wins");

    const out = await generateText({ prompt: "hello" });

    expect(out).toBe("gemini-wins");
    expect(orCalls()).toHaveLength(0);
    expect(getProviderStats().openrouter.calls).toBe(0);
    expect(structuredLogs().some((entry) => entry.provider === "gemini" && entry.ok === true)).toBe(true);
  });

  it("(c) both providers fail → throws (Gemini error primary, OpenRouter error attached)", async () => {
    geminiImpl = () => geminiHttpError(503, "Service Unavailable");
    openRouterImpl = () => openRouterHttpError(500, "Internal Server Error");

    const err = await generateText({ prompt: "boom" }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LLMOutputError); // providers failed, output never parsed
    expect(err.fallbackError).toBeTruthy();
    expect(String(err.fallbackError.message)).toContain("OpenRouter 500");

    expect(geminiCalls().length).toBeGreaterThan(0);
    expect(orCalls()).toHaveLength(4); // whole OpenRouter chain tried (4 default models)
    expect(getOpenRouterModelList().every((m) => orCalls().some((c) => c.body.model === m))).toBe(true);
    const stats = getProviderStats();
    expect(stats.gemini).toMatchObject({ calls: 1, failures: 1 });
    expect(stats.openrouter).toMatchObject({ calls: 1, failures: 1 }); // chain-level, not per model
  });

  it("(a2) 400 mentioning reasoning → same model retried ONCE without the reasoning field", async () => {
    geminiImpl = () => geminiHttpError(400, "API key not valid.");
    let orAttempt = 0;
    openRouterImpl = () => {
      orAttempt += 1;
      if (orAttempt === 1) {
        // e.g. minimax rejects reasoning:{effort:"none"}: "reasoning disabled"
        return openRouterHttpError(400, "Reasoning is mandatory for this model. Remove the reasoning field.");
      }
      return openRouterSuccess('{"answer":"retried-ok"}');
    };

    const out = await generateText({ prompt: "p" });

    expect(out).toBe('{"answer":"retried-ok"}');
    expect(orCalls()).toHaveLength(2);
    // First request carried the default reasoning config; the retry dropped it —
    // same model, same prompt, no chain hop.
    expect(orCalls()[0].body.reasoning).toEqual({ effort: "none" });
    expect(orCalls()[1].body).not.toHaveProperty("reasoning");
    expect(orCalls()[1].body.model).toBe(orCalls()[0].body.model);
    // The in-model retry is invisible to chain stats: one successful attempt.
    const stats = getProviderStats();
    expect(stats.openrouter).toMatchObject({ calls: 1, failures: 0 });
  });

  it("(d) cooldown → after a provider-level Gemini failure the next call goes straight to OpenRouter", async () => {
    geminiImpl = () => geminiHttpError(500, "Internal Server Error");
    openRouterImpl = () => openRouterSuccess("first-answer");
    await expect(generateText({ prompt: "p1" })).resolves.toBe("first-answer");
    expect(getProviderStats().gemini.cooldowns).toBe(1);
    expect(warnLines.some((line) => line.includes("cooling Gemini down"))).toBe(true);

    // Gemini has RECOVERED — but it is still cooling down, so it must be skipped.
    geminiImpl = () => geminiSuccess("gemini-recovered");
    openRouterImpl = () => openRouterSuccess("second-answer");
    recorded = [];
    const out = await generateText({ prompt: "p2" });

    expect(out).toBe("second-answer");
    expect(geminiCalls()).toHaveLength(0);
    expect(orCalls()).toHaveLength(1);
    expect(getProviderStats().gemini.calls).toBe(1); // still only the first attempt
  });

  it("(d2) GEMINI_COOLDOWN_MS=0 → Gemini is probed again on the very next call (re-probe)", async () => {
    process.env.GEMINI_COOLDOWN_MS = "0";
    geminiImpl = () => geminiHttpError(500, "Internal Server Error");
    openRouterImpl = () => openRouterSuccess("fallback-answer");
    await expect(generateText({ prompt: "p1" })).resolves.toBe("fallback-answer");

    geminiImpl = () => geminiSuccess("gemini-back");
    recorded = [];
    const out = await generateText({ prompt: "p2" });

    expect(out).toBe("gemini-back");
    expect(geminiCalls()).toHaveLength(1);
    expect(orCalls()).toHaveLength(0);
  });

  it("(e) LLM_PROVIDER=openrouter skips Gemini entirely (even when Gemini would succeed)", async () => {
    process.env.LLM_PROVIDER = "openrouter";
    geminiImpl = () => geminiSuccess("should-not-be-used");
    openRouterImpl = () => openRouterSuccess("openrouter-only");

    const out = await generateText({ prompt: "p" });

    expect(out).toBe("openrouter-only");
    expect(geminiCalls()).toHaveLength(0);
    const stats = getProviderStats();
    expect(stats.mode).toBe("openrouter");
    expect(stats.gemini.calls).toBe(0);
    expect(stats.openrouter.calls).toBe(1);
  });

  it("(e2) LLM_PROVIDER=gemini never touches OpenRouter (legacy invalid-key behaviour)", async () => {
    process.env.LLM_PROVIDER = "gemini";
    geminiImpl = () => geminiHttpError(400, "API key not valid.");

    await expect(generateText({ prompt: "p" })).rejects.toBeInstanceOf(LLMConfigError);

    expect(orCalls()).toHaveLength(0);
    // gemini-only mode: no fallback exists → legacy permanent disable (both).
    expect(isLLMAvailable()).toBe(false);
    expect(getProviderStats().disabled).toBe(true);
  });

  it("(e3) LLM_PROVIDER=openrouter without a key → LLMConfigError, Gemini untouched", async () => {
    process.env.LLM_PROVIDER = "openrouter";
    delete process.env.FALLBACK_API_KEY_OPEN_ROUTER;

    await expect(generateText({ prompt: "p" })).rejects.toBeInstanceOf(LLMConfigError);
    expect(geminiCalls()).toHaveLength(0);
  });

  it("(f) disableLLM() disables BOTH providers — no provider is called afterwards", async () => {
    disableLLM("unit test");

    expect(isLLMAvailable()).toBe(false);
    await expect(generateText({ prompt: "p" })).rejects.toBeInstanceOf(LLMConfigError);
    await expect(generateJSON({ prompt: "{}" })).rejects.toBeInstanceOf(LLMConfigError);

    expect(recorded).toHaveLength(0); // neither Gemini nor OpenRouter was hit
    expect(getProviderStats()).toMatchObject({ disabled: true, mode: "auto" });
    expect(getProviderStats().openrouter.configured).toBe(true); // key present, still disabled
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("JSON path on the OpenRouter fallback (shared extractJSON + Zod)", () => {
  const schema = z.object({
    skills: z.array(z.string()),
    experience_years: z.number(),
  });

  it("(g) fenced JSON from OpenRouter is extracted and Zod-validated", async () => {
    geminiImpl = () => geminiHttpError(400, "API key not valid.");
    openRouterImpl = () =>
      openRouterSuccess('```json\n{"skills":["React","Node.js"],"experience_years":5}\n```');

    const out = await generateJSON({ prompt: "Extract skills.", schema, promptTag: "test.json" });

    expect(out).toEqual({ skills: ["React", "Node.js"], experience_years: 5 });
    expect(orCalls()).toHaveLength(1);
    expect(orCalls()[0].body.messages[0].content).toContain("Extract skills.");
    expect(structuredLogs().some((entry) => entry.provider === "openrouter" && entry.promptTag === "test.json")).toBe(true);
  });

  it("(g2) a schema violation triggers ONE corrective retry, then succeeds", async () => {
    geminiImpl = () => geminiHttpError(400, "API key not valid.");
    let attempt = 0;
    openRouterImpl = () => {
      attempt += 1;
      return openRouterSuccess(
        attempt === 1
          ? '{"skills":"nope","experience_years":"five"}'
          : '{"skills":["SQL"],"experience_years":3}',
      );
    };

    const out = await generateJSON({ prompt: "Extract skills.", schema });

    expect(out).toEqual({ skills: ["SQL"], experience_years: 3 });
    expect(orCalls()).toHaveLength(2);
    expect(orCalls()[1].body.messages[0].content).toContain("failed validation");
  });

  it("(g3) persistent schema violations → typed LLMOutputError (Gemini cooled down mid-request)", async () => {
    geminiImpl = () => geminiHttpError(400, "API key not valid.");
    openRouterImpl = () => openRouterSuccess('{"skills":"nope","experience_years":"five"}');

    const err = await generateJSON({ prompt: "Extract skills.", schema }).catch((e) => e);

    expect(err).toBeInstanceOf(LLMOutputError);
    expect(err.issues).toBeTruthy();
    expect(geminiCalls()).toHaveLength(1); // first attempt only — then cooldown
    expect(orCalls()).toHaveLength(2); // both OpenRouter attempts (initial + corrective)
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("config + model chains", () => {
  it("lazy config line: enabled with a MASKED key, disabled when the key is unset", async () => {
    geminiImpl = () => geminiSuccess("ok");
    await generateText({ prompt: "p" });

    const enabled = logLines.find((line) => line.includes("OpenRouter fallback enabled"));
    expect(enabled).toBeTruthy();
    expect(enabled).toContain("(4 models"); // default OPENROUTER_MODELS chain
    expect(enabled).toContain("sk-o"); // masked to the first 4 chars
    expect(enabled).not.toContain("sk-or-test-key"); // NEVER the raw key

    resetLLMForTests();
    delete process.env.FALLBACK_API_KEY_OPEN_ROUTER;
    logLines = [];
    await generateText({ prompt: "p" });
    expect(logLines.some((line) => line.includes("OpenRouter fallback disabled"))).toBe(true);
  });

  it("getOpenRouterModelList: default chain, OPENROUTER_MODELS override, per-call override", () => {
    expect(getOpenRouterModelList()).toEqual([
      "nvidia/nemotron-3.5-lightning:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "minimax/minimax-m3.1-flash:free",
      "poolside/laguna-s-2.1:free",
    ]);

    process.env.OPENROUTER_MODELS = "org/model-a:free, org/model-b:free ,";
    expect(getOpenRouterModelList()).toEqual(["org/model-a:free", "org/model-b:free"]);

    expect(getOpenRouterModelList(["x/y:free"])).toEqual(["x/y:free"]);
    expect(getOpenRouterModelList(["  ", ""])).toEqual([]);
  });

  it("getProviderStats never exposes raw key material", async () => {
    geminiImpl = () => geminiSuccess("ok");
    await generateText({ prompt: "p" });

    const stats = getProviderStats();
    const serialized = JSON.stringify(stats);
    expect(serialized).not.toContain("sk-or-test-key");
    expect(serialized).not.toContain("test-gemini-key");
    expect(stats.openrouter.keyMasked).toBe("sk-o…");
  });
});
