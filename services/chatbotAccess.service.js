import { classifyIntent, INTENTS } from "./classifier.service.js";

const PROTECTED_INTENTS = new Set([
  INTENTS.APPLY_JOB,
  INTENTS.SAVE_JOB,
  INTENTS.CREATE_JOB,
  INTENTS.VIEW_APPLICATIONS,
  INTENTS.VIEW_APPLICANTS,
  INTENTS.LEARNING_PLAN,
  INTENTS.SKILL_GAP,
  INTENTS.SKILL_TEST,
  INTENTS.PROFILE,
  INTENTS.DASHBOARD,
  INTENTS.UPLOAD_RESUME,
  INTENTS.SCHEDULE_INTERVIEW,
  INTENTS.USER_DATA_SUMMARY,
  INTENTS.JOB_MATCHING,
  INTENTS.NEXT_STEPS,
  INTENTS.WHO_AM_I,
]);

const ACTION_VERB = "(?:apply|submit|save|bookmark|upload|post|create|schedule|book|delete|remove|edit|update|shortlist|approve|reject|run|send)";
const ACTION_PATTERNS = [
  new RegExp(`^\\s*(?:please\\s+)?${ACTION_VERB}\\b`, "i"),
  new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${ACTION_VERB}\\b`, "i"),
  new RegExp(`\\b(?:i want|i need) you to\\s+${ACTION_VERB}\\b`, "i"),
  new RegExp(`\\b${ACTION_VERB}\\b.{0,60}\\b(?:for me|on my behalf)\\b`, "i"),
  /\bdo (?:it|this|that) for me\b/i,
];

const PERSONAL_SUBJECT = "(?:applications?|applicants?|matched jobs?|saved jobs?|jobs?|match(?:es| score)?|scores?|skill gap|skills?|resume|profile|interviews?|learning plan|dashboard|account)";
const PERSONAL_VALUE_PATTERNS = [
  new RegExp(`\\b(?:my|mine)\\b.{0,45}\\b${PERSONAL_SUBJECT}\\b`, "i"),
  new RegExp(`\\b(?:what|which|show|list|check|count|summari[sz]e|tell me about)\\b.{0,55}\\b${PERSONAL_SUBJECT}\\b.{0,35}\\b(?:my|mine|i)\\b`, "i"),
  /\b(?:how many|did i|have i|am i|what is my|what are my)\b.{0,70}\b(?:applications?|applicants?|jobs?|matches?|scores?|skills?|resume|profile|interviews?|learning plan)\b/i,
];

const INFORMATIONAL_PROMPT = /^(?:how\b|where\b|explain\b|tell me about\b|what does\b|what is\b|why does\b)/i;
const NAVIGATION_HOW_TO = /^(?:how (?:do|can|should) i\b|how to\b|where\b)/i;
const ACCOUNT_VALUE_INTENTS = new Set([INTENTS.USER_DATA_SUMMARY, INTENTS.WHO_AM_I]);

/**
 * Public chat may explain platform features, but it must not expose account
 * data or initiate an operation that belongs behind authentication.
 */
export function requiresLoginForGuestPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;

  if (ACTION_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const { intent, isActionRequest } = classifyIntent(text);
  if (isActionRequest || ACCOUNT_VALUE_INTENTS.has(intent)) return true;

  const asksForPersonalValue = PERSONAL_VALUE_PATTERNS.some((pattern) => pattern.test(text));
  if (asksForPersonalValue && !NAVIGATION_HOW_TO.test(text)) return true;

  // Questions asking for instructions or feature explanations stay public.
  if (INFORMATIONAL_PROMPT.test(text) && !/^(?:how many|what is my|what are my)\b/i.test(text)) {
    return false;
  }

  return PROTECTED_INTENTS.has(intent);
}

export const AUTH_REQUIRED_PAYLOAD = Object.freeze({
  success: false,
  code: "AUTH_REQUIRED",
  requiresLogin: true,
  message: "Please sign in first to access your account or use assistant tasks. You can keep asking general questions without signing in.",
});
