// Pure unit tests for the chatbot input normalizer.
import { describe, it, expect } from "vitest";
import { normalizeInput } from "../utils/normalizeInput.js";

describe("normalizeInput", () => {
  it("trims and lowercases input", () => {
    expect(normalizeInput("  HELLO World  ")).toBe("hello world");
  });

  it("strips punctuation", () => {
    expect(normalizeInput('What is "React", really?')).toBe(
      "what is react really",
    );
  });

  it("collapses runs of whitespace (including newlines/tabs)", () => {
    expect(normalizeInput("a \n\t  b   c")).toBe("a b c");
  });

  it("coerces empty, null and undefined input to an empty string", () => {
    expect(normalizeInput("")).toBe("");
    expect(normalizeInput(null)).toBe("");
    expect(normalizeInput(undefined)).toBe("");
    // Falsy values fall through `input || ""` — documented behavior.
    expect(normalizeInput(0)).toBe("");
    expect(normalizeInput(false)).toBe("");
  });
});
