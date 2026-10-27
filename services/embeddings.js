// services/embeddings.js
// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL semantic-embedding hook for the fit score (PLAN §4 Tier-1 #1).
//
// Rules (deliberate):
//   • NO fake/deterministic-hash embeddings. If we cannot call a real embedding
//     model, we return `null` and callers fall back to taxonomy-only matching.
//   • The Gemini client here is separate from services/llm.js's internal
//     client (llm.js does not export it) but reuses llm.js's availability
//     signal, so an invalid/rejected GEMINI_API_KEY disables embeddings too.
//   • Set EMBEDDING_ENABLED=false to force embeddings off; EMBEDDING_MODEL to
//     override the model (default: text-embedding-004).
//   • The first failure disables embeddings for the process (logged once).
//
// Public API:
//   areEmbeddingsAvailable() -> boolean (cheap, no network)
//   embed(texts)             -> Promise<number[][]|null>  (null = unavailable)
//   resetEmbeddingsState()   -> test helper
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from "@google/genai";
import { isLLMAvailable } from "./llm.js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

let client = null;
let disabled = false;
let warned = false;

function logUnavailableOnce(reason) {
  if (warned) return;
  warned = true;
  console.warn(
    `embeddings: unavailable (${reason}). Skill matching falls back to taxonomy ` +
      "(aliases + adjacency). Set a working GEMINI_API_KEY to enable semantic matching.",
  );
}

/** True when an embedding call could plausibly succeed. Cheap, no network. */
export function areEmbeddingsAvailable() {
  if (disabled) return false;
  if (process.env.EMBEDDING_ENABLED === "false") return false;
  return isLLMAvailable();
}

function getClient() {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY?.trim(),
      httpOptions: { timeout: 15_000 }, // never hang a scoring request
    });
  }
  return client;
}

/**
 * Embed an array of texts.
 * @returns {Promise<number[][]|null>} one vector per input, or null when
 *   embeddings are unavailable/disabled (callers must skip semantic matching).
 */
export async function embed(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? "").trim()).filter(Boolean);

  if (!areEmbeddingsAvailable()) {
    logUnavailableOnce(disabled ? "disabled after earlier failure" : "not configured");
    return null;
  }
  if (list.length === 0) return [];

  try {
    // Serialised, one model, sequential — embedding volume here is tiny
    // (a handful of skill names per score).
    const ai = getClient();
    const model = process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
    const vectors = [];
    for (const text of list) {
      const response = await ai.models.embedContent({
        model: model.startsWith("models/") ? model : `models/${model}`,
        contents: text,
      });
      const values = response?.embeddings?.[0]?.values ?? response?.embedding?.values ?? null;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`Embedding model returned no values for "${text.slice(0, 40)}"`);
      }
      vectors.push(values);
    }
    return vectors;
  } catch (error) {
    // Invalid key, quota, retired model, network — disable for the process so
    // scoring never repeatedly pays this cost. Graceful fallback, logged once.
    disabled = true;
    client = null;
    logUnavailableOnce(error?.message || String(error));
    return null;
  }
}

/** Test helper: forget disabled state / cached client. */
export function resetEmbeddingsState() {
  client = null;
  disabled = false;
  warned = false;
}
