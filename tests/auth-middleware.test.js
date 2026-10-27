// Unit tests for the verifyToken middleware's rejection paths.
// firebaseService is mocked so no Firebase Admin init (or service-account
// file read) happens; getDB is never reached on these paths.
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/firebaseService.js", () => ({
  getFirebaseService: vi.fn(() => null),
}));

import { verifyToken } from "../middleware/auth.js";

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

describe("verifyToken", () => {
  it("401s when the Authorization header is missing and does not call next()", async () => {
    const res = makeRes();
    const next = vi.fn();

    await verifyToken({ headers: {} }, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "Unauthorized: Missing Token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("401s a non-Bearer header", async () => {
    const res = makeRes();
    const next = vi.fn();

    await verifyToken({ headers: { authorization: "Basic dXNlcjpwYXNz" } }, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s a malformed token (dev offline decoder path, Firebase Admin unavailable)", async () => {
    const res = makeRes();
    const next = vi.fn();

    await verifyToken(
      { headers: { authorization: "Bearer not-a-jwt" } },
      res,
      next,
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false });
    expect(next).not.toHaveBeenCalled();
  });
});
