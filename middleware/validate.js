// middleware/validate.js
// Zod-based request validation middleware.
//
// Usage: router.post("/path", validate(schema), handler)               // validates req.body
//        router.get("/path", validate(schema, "query"), handler)       // validates req.query
//        router.get("/path/:id", validate(schema, "params"), handler)  // validates req.params
//
// On failure returns 400 { success:false, message, issues }.
// On success the parsed value replaces req[source] (express req.query is a
// getter, so it is defined as an own property to override the prototype getter).

import { z } from "zod";

/**
 * @param {import("zod").ZodType} schema
 * @param {"body"|"query"|"params"} source
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req[source]);

      if (!result.success) {
        const issues = result.error.issues.map((issue) => ({
          path: issue.path.join(".") || source,
          message: issue.message,
          code: issue.code,
        }));

        return res.status(400).json({
          success: false,
          message: `Invalid request ${source}`,
          issues,
        });
      }

      const parsed = result.data;

      if (source === "query") {
        Object.defineProperty(req, "query", {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else if (source === "params") {
        Object.defineProperty(req, "params", {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        req.body = parsed;
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default validate;
