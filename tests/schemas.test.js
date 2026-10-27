// Unit tests for the shared Zod schemas (lib/schemas.js).
// Importing this module also registers the Mongoose User/Application models
// (schema-only — no connection is attempted).
import { describe, it, expect } from "vitest";
import {
  uidParam,
  objectIdParam,
  paginationQuery,
  escapeRegExp,
} from "../lib/schemas.js";

describe("uidParam", () => {
  it("accepts a normal Firebase uid and trims it", () => {
    expect(uidParam.parse("  abcDEF123  ")).toBe("abcDEF123");
  });

  it("rejects an empty uid", () => {
    expect(uidParam.safeParse("").success).toBe(false);
    expect(uidParam.safeParse("   ").success).toBe(false);
  });

  it("rejects uids beyond Firebase's 128-char limit", () => {
    expect(uidParam.safeParse("a".repeat(128)).success).toBe(true);
    expect(uidParam.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("rejects a missing (non-string) uid", () => {
    expect(uidParam.safeParse(undefined).success).toBe(false);
    expect(uidParam.safeParse(42).success).toBe(false);
  });
});

describe("objectIdParam", () => {
  it("accepts a 24-char hex ObjectId (either case)", () => {
    expect(objectIdParam.safeParse("64b000000000000000000000").success).toBe(true);
    expect(objectIdParam.safeParse("64B0ABCDEF000000000000AB").success).toBe(true);
  });

  it("rejects wrong-length or non-hex ids (injection guard)", () => {
    expect(objectIdParam.safeParse("64b000").success).toBe(false);
    expect(objectIdParam.safeParse("'.*; drop table jobs--").success).toBe(false);
    expect(objectIdParam.safeParse("zzzzzzzzzzzzzzzzzzzzzzzzzz").success).toBe(false);
  });
});

describe("paginationQuery", () => {
  it("defaults page=1 and limit=20", () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("coerces query-string values to numbers", () => {
    expect(paginationQuery.parse({ page: "3", limit: "50" })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it("rejects page < 1", () => {
    expect(paginationQuery.safeParse({ page: 0 }).success).toBe(false);
  });

  it("rejects limit > 100 (caps pagination cost)", () => {
    expect(paginationQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(paginationQuery.safeParse({ limit: 100 }).success).toBe(true);
  });

  it("rejects non-integer pages", () => {
    expect(paginationQuery.safeParse({ page: 1.5 }).success).toBe(false);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so user input can't alter the pattern", () => {
    const escaped = escapeRegExp("a.b*c?");
    expect(new RegExp(escaped).test("a.b*c?")).toBe(true);
    expect(new RegExp(escaped).test("axbyc?")).toBe(false);
  });

  it("stringifies non-string input", () => {
    expect(escapeRegExp(42)).toBe("42");
  });
});
