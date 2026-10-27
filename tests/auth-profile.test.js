// PUT /api/auth/profile/:uid — whitelist behavior (security-relevant).
//
// The route strips a fixed list of protected fields before building the
// $set payload, and takes the uid from the URL (never the body).
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../config/db.js", () => ({
  connectDB: vi.fn(async () => {}),
  getDB: vi.fn(() => globalThis.__testDb),
}));

vi.mock("../config/mongoose.js", () => ({
  connectMongoose: vi.fn(async () => null),
  syncAllIndexes: vi.fn(async () => ({ total: 0, synced: 0, failed: [] })),
}));

import app from "../api/index.js";

let findOne;
let updateOne;

beforeEach(() => {
  vi.clearAllMocks();
  findOne = vi.fn(async () => ({
    firebaseUid: "u1",
    email: "user@example.com",
    displayName: "User",
    role: "candidate",
    isSkillVerified: false,
    verifiedSkills: [],
  }));
  updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
  globalThis.__testDb = {
    collection: vi.fn(() => ({ findOne, updateOne })),
  };
});

describe("PUT /api/auth/profile/:uid", () => {
  it("strips protected fields from the $set payload and keys the update by URL uid", async () => {
    const res = await request(app).put("/api/auth/profile/u1").send({
      displayName: "New Name",
      bio: "hello there",
      _id: "64b000000000000000000000",
      firebaseUid: "attacker-controlled-uid",
      email: "attacker@evil.example",
      createdAt: "2020-01-01T00:00:00.000Z",
      isSkillVerified: true,
      verifiedSkills: ["hacked"],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    // uid comes from the URL, never from the body.
    expect(findOne).toHaveBeenCalledWith({ firebaseUid: "u1" });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ firebaseUid: "u1" });

    const set = update.$set;
    expect(set).not.toHaveProperty("_id");
    expect(set).not.toHaveProperty("firebaseUid");
    expect(set).not.toHaveProperty("email");
    expect(set).not.toHaveProperty("createdAt");
    expect(set).not.toHaveProperty("isSkillVerified");
    expect(set).not.toHaveProperty("verifiedSkills");
    // Legitimate fields still flow through.
    expect(set.displayName).toBe("New Name");
    expect(set.bio).toBe("hello there");
  });

  it("404s when the user does not exist and performs no update", async () => {
    findOne.mockResolvedValue(null);

    const res = await request(app)
      .put("/api/auth/profile/ghost")
      .send({ displayName: "Nobody" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "User not found" });
    expect(updateOne).not.toHaveBeenCalled();
  });

  // ── Security regression (PLAN.md §1.2, Phase 0) ──────────────────────────
  // The fix has landed: PUT /api/auth/profile/:uid runs
  // validate(profileUpdateBody) (lib/schemas.js) — a whitelist schema, so Zod
  // strips `role` (and every other unknown key) before the handler runs, and
  // the handler spreads the PARSED body. This test guards against regressing
  // that (e.g. switching the schema to z.looseObject or dropping validate()).
  it("SECURITY REGRESSION: strips `role` so the endpoint cannot escalate to admin", async () => {
    const res = await request(app)
      .put("/api/auth/profile/u1")
      .send({ displayName: "Nice Name", role: "admin" });

    expect(res.status).toBe(200);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty("role");
    expect(findOne).toHaveBeenCalledWith({ firebaseUid: "u1" });
  });
});
