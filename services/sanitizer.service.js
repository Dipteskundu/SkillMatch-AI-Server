/**
 * Sanitizes a Gemini/fallback response to strip any phrases implying
 * that the bot has performed a write action.
 * @param {string} text
 * @returns {string}
 */

const FORBIDDEN_PHRASES = [
  "i updated your",
  "i updated the",
  "i deleted your",
  "i deleted the",
  "i applied",
  "i have applied",
  "i created",
  "i posted the",
  "i posted a",
  "i sent",
  "i submitted",
  "i scheduled",
  "i booked",
  "i removed",
];

export function sanitizeResponse(text) {
  if (!text || typeof text !== "string") {
    return "I cannot perform actions directly, but I can guide you on how to do it in the platform.";
  }

  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      return "I cannot perform actions directly, but I can guide you on how to do it in the platform.";
    }
  }

  return text;
}

// Only these keys are safe to send to the AI provider.
const PII_KEYS = new Set([
  "email", "phone", "phonenumber", "phone_number", "address",
  "dateofbirth", "dob", "nationalid", "nid", "ssn", "salary", "expectedsalary",
]);

/**
 * Strips PII (emails, phone numbers, addresses) out of a user context object
 * before it reaches the AI provider. Recurses into nested objects/arrays.
 * @param {object} obj
 * @returns {object} deep copy with PII removed
 */
export function stripPII(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => (item && typeof item === "object" ? stripPII(item) : item));
  }
  if (obj && typeof obj === "object") {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (PII_KEYS.has(key.toLowerCase().replace(/[_\s-]/g, ""))) continue;
      clean[key] = value && typeof value === "object" ? stripPII(value) : value;
    }
    return clean;
  }
  return obj;
}

/**
 * Removes PII patterns embedded inside free text (prompts, resumes snippets).
 * @param {string} text
 * @returns {string}
 */
export function stripPIIFromText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, "[redacted-email]")
    .replace(/(?:\+?88)?01[3-9]\d{8}/g, "[redacted-phone]")
    .replace(/\b\d{3}[-.\s]?\d{6,10}\b/g, "[redacted-number]");
}
