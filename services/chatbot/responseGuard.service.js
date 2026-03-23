const UNSAFE_ACTION_PATTERN =
  /\b(i|we|the system)\s+(updated|deleted|removed|approved|rejected|changed|modified|created|submitted|saved|applied|posted|performed|processed|accepted|denied)\b/i;

const DIRECT_ACTION_REQUEST_PATTERN =
  /\b(update|delete|remove|approve|reject|submit|apply|post|create|change|edit|modify|perform|execute)\b/i;

const OTHER_USER_PATTERN =
  /\b(other users?|another user|someone else|all users' private|everyone's private|their account)\b/i;

const SAFE_FALLBACK =
  "I can only provide read-only help from available platform information, and I cannot perform or claim account-changing actions.";

export function sanitizeChatbotAnswer(answer) {
  const text = String(answer || "").trim();
  if (!text) {
    return {
      answer:
        "I can only answer from available platform information, and I could not build a safe answer for that request.",
      source: "fallback",
      blocked: true,
    };
  }

  if (UNSAFE_ACTION_PATTERN.test(text) || DIRECT_ACTION_REQUEST_PATTERN.test(text) || OTHER_USER_PATTERN.test(text)) {
    return {
      answer:
        "I can only provide read-only guidance. I cannot perform or claim platform-changing actions, but I can explain how to do them in the UI.",
      source: "guard",
      blocked: true,
    };
  }

  return {
    answer: text,
    source: null,
    blocked: false,
  };
}
