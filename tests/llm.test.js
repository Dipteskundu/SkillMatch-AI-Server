// Unit tests for the consolidated Gemini client (services/llm.js) — the
// PURE parts only: JSON extraction, model-chain resolution, error types.
// No test here touches the network or requires GEMINI_API_KEY.
import { describe, it, expect } from "vitest";
import {
  extractJSON,
  getModelList,
  LLMConfigError,
  LLMOutputError,
} from "../services/llm.js";

describe("extractJSON", () => {
  it("parses a bare JSON object", () => {
    expect(extractJSON('{"ok": true, "n": 1}')).toEqual({ ok: true, n: 1 });
  });

  it("parses JSON wrapped in a markdown fence", () => {
    const fenced = '```json\n{"skills": ["js", "sql"]}\n```';
    expect(extractJSON(fenced)).toEqual({ skills: ["js", "sql"] });
  });

  it("parses JSON surrounded by prose (fence-less model output)", () => {
    const prose = 'Sure! Here is the result: {"score": 87} — hope that helps.';
    expect(extractJSON(prose)).toEqual({ score: 87 });
  });

  it("parses a bare JSON array", () => {
    expect(extractJSON("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("throws on output that contains no parseable JSON", () => {
    expect(() => extractJSON("I could not produce JSON.")).toThrow(SyntaxError);
  });
});

describe("getModelList", () => {
  it("uses a per-call override chain (trimmed, empty entries dropped)", () => {
    expect(getModelList([" model-a ", "", "model-b"])).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  it("returns a non-empty default chain when no override is given", () => {
    // Caching note: the first no-argument call in the process caches the
    // result — only its shape is asserted here to stay order-independent.
    const list = getModelList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
  });

  it("an all-blank override array still short-circuits (returns an empty chain, no env fallback)", () => {
    expect(getModelList(["  ", ""])).toEqual([]);
  });
});

describe("typed errors", () => {
  it("LLMConfigError and LLMOutputError are real Error subclasses", () => {
    const config = new LLMConfigError("no api key");
    const output = new LLMOutputError("bad shape");
    expect(config).toBeInstanceOf(Error);
    expect(config).toBeInstanceOf(LLMConfigError);
    expect(config.message).toBe("no api key");
    expect(output).toBeInstanceOf(Error);
    expect(output).toBeInstanceOf(LLMOutputError);
  });
});
