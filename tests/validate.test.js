// Unit tests for the Zod validation middleware (middleware/validate.js),
// exercised directly with a small schema — no Express app or DB needed.
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

const personSchema = z.object({
  name: z.string().trim().min(1),
  age: z.coerce.number().int().min(0).max(150),
});

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("validate(schema) — body source", () => {
  it("rejects an invalid body with 400 {success:false, message, issues}", () => {
    const req = { body: { name: "", age: "old" } };
    const res = makeRes();
    const next = vi.fn();

    validate(personSchema)(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid request body");
    expect(res.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "name", code: expect.any(String) }),
        expect.objectContaining({ path: "age", code: expect.any(String) }),
      ]),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes a valid body to next() and replaces req.body with the parsed value", () => {
    const req = { body: { name: "  Ada  ", age: "42" } };
    const res = makeRes();
    const next = vi.fn();

    validate(personSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBeNull(); // no error response written
    // trimmed + coerced by the schema
    expect(req.body).toEqual({ name: "Ada", age: 42 });
  });

  it("strips unknown keys from the body (whitelist semantics — the role-escalation guard)", () => {
    const req = { body: { name: "Ada", age: 30, role: "admin", isAdmin: true } };
    const res = makeRes();
    const next = vi.fn();

    validate(personSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).not.toHaveProperty("role");
    expect(req.body).not.toHaveProperty("isAdmin");
    expect(req.body).toEqual({ name: "Ada", age: 30 });
  });
});

describe("validate(schema, 'query') — query source", () => {
  const querySchema = z.object({
    page: z.coerce.number().int().min(1),
  });

  it("rejects an invalid query with 400 and names the query as the source", () => {
    const req = { body: {}, query: { page: "0" }, params: {} };
    const res = makeRes();
    const next = vi.fn();

    validate(querySchema, "query")(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid request query");
    expect(next).not.toHaveBeenCalled();
  });

  it("overrides the express query getter with the parsed value on success", () => {
    const req = { body: {}, query: { page: "2" }, params: {} };
    const res = makeRes();
    const next = vi.fn();

    validate(querySchema, "query")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // express req.query is a prototype getter — validate() must shadow it
    // with an own property, and the value is coerced.
    expect(Object.prototype.hasOwnProperty.call(req, "query")).toBe(true);
    expect(req.query).toEqual({ page: 2 });
  });
});
