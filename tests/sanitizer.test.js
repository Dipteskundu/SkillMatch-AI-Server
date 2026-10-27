// Pure unit tests for the chatbot response sanitizer — guards against the
// bot claiming it performed write actions on the user's behalf.
import { describe, it, expect } from "vitest";
import { sanitizeResponse } from "../services/sanitizer.service.js";

describe("sanitizeResponse", () => {
  it("passes clean informational text through unchanged", () => {
    const text = "You could improve your SQL skills with a joins course.";
    expect(sanitizeResponse(text)).toBe(text);
  });

  it("blocks claims that an action was performed", () => {
    expect(sanitizeResponse("I updated your profile with new skills.")).toBe(
      "I cannot perform actions directly, but I can guide you on how to do it in the platform.",
    );
  });

  it("matches forbidden phrases case-insensitively", () => {
    expect(sanitizeResponse("I have Applied to 3 jobs for you")).toBe(
      "I cannot perform actions directly, but I can guide you on how to do it in the platform.",
    );
  });

  it("falls back to the canned reply for empty or non-string input", () => {
    const canned =
      "I cannot perform actions directly, but I can guide you on how to do it in the platform.";
    expect(sanitizeResponse("")).toBe(canned);
    expect(sanitizeResponse(null)).toBe(canned);
    expect(sanitizeResponse(undefined)).toBe(canned);
    expect(sanitizeResponse(42)).toBe(canned);
  });
});
