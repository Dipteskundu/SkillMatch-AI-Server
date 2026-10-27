// services/outputGuard.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight output check for LLM responses (career agent + recruiter copilot).
//
// Replaces the old substring denylist in services/sanitizer.service.js for AI
// output: instead of enumerating "action claims", we block the small class of
// outputs that indicate a prompt-injection attempt reached the model —
// instruction-override phrases, requests to expose the system prompt, and
// credential/API-key material — and fall back to a safe canned message (logged,
// never silently passed through).
//
// Public API:
//   containsInstructionOverride(text)   -> boolean (pure)
//   guardLLMOutput(text, fallback?)     -> string  (original text when clean)
//   SAFE_FALLBACK_MESSAGE               -> canned safe replacement
// ─────────────────────────────────────────────────────────────────────────────

const INSTRUCTION_OVERRIDE_PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|initial|original|preceding)\s+instructions?\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|initial|original|preceding)\s+instructions?\b/i,
  /\bforget\s+(?:all\s+|your\s+|the\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
  /\b(?:override|bypass)\s+(?:your\s+|the\s+|these\s+|previous\s+|prior\s+)?instructions?\b/i,
  /\bsystem\s*prompt\b/i,
  /\bapi[\s_-]?key\b/i,
];

export const SAFE_FALLBACK_MESSAGE =
  "I couldn't safely generate a response to that. Please try rephrasing — " +
  "I can help with jobs on JobMatch, your own profile and matches, or how the platform works.";

/** True when the text contains a known instruction-override / leak pattern. */
export function containsInstructionOverride(text) {
  if (!text || typeof text !== "string") return false;
  return INSTRUCTION_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Return the text unchanged when clean; otherwise log and replace it with a
 * safe fallback message.
 * @param {string} text   raw LLM output
 * @param {string} [fallbackMessage]
 */
export function guardLLMOutput(text, fallbackMessage = SAFE_FALLBACK_MESSAGE) {
  if (!text || typeof text !== "string") return fallbackMessage;
  if (containsInstructionOverride(text)) {
    console.warn(
      `outputGuard: blocked an LLM response containing an instruction-override pattern (length=${text.length}).`,
    );
    return fallbackMessage;
  }
  return text;
}
