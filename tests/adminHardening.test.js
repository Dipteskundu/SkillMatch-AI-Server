// tests/adminHardening.test.js — Phase 5: every admin route must be gated
// (verifyToken + requireAdmin). Before Phase 5 these endpoints were open.
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

vi.mock("../services/firebaseService.js", () => ({
  getFirebaseService: vi.fn(() => null),
}));

vi.mock("../models/index.js", async () => {
  const { makeFakeModel } = await import("./fixtures/fakeModels.js");
  return {
    Technology: makeFakeModel("technologies"),
    LearningPath: makeFakeModel("learning_paths"),
    UserProgress: makeFakeModel("user_progress"),
    Certificate: makeFakeModel("certificates"),
    User: makeFakeModel("users"),
    Job: makeFakeModel("find_jobs"),
    Skill: makeFakeModel("skills"),
    ApiKey: makeFakeModel("api_keys"),
    AuditLog: makeFakeModel("audit_logs"),
    Subscription: makeFakeModel("subscriptions"),
    CreditLedger: makeFakeModel("credit_ledger"),
    generateVerifiableCode: () => "vc-static-code-1",
  };
});

import app from "../api/index.js";
import { resetFakeStore, makeFakeRawDb, getFakeDocs } from "./fixtures/fakeModels.js";

const ADMIN = "admin-uid-1";
const CANDIDATE = "cand-uid-1";

function tokenFor(uid) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function as(method, url, uid, body) {
  const req = request(app)[method](url);
  if (uid) req.set("Authorization", `Bearer ${tokenFor(uid)}`);
  return body === undefined ? req : req.send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeStore();
  globalThis.__testDb = makeFakeRawDb();
  getFakeDocs("users").push(
    { firebaseUid: ADMIN, email: "admin@test.dev", role: "admin" },
    { firebaseUid: CANDIDATE, email: "cand@test.dev", role: "candidate" },
  );
  getFakeDocs("find_jobs").push({
    _id: "64b0000000000000000000aa",
    title: "Pending role",
    status: "pending",
    createdAt: new Date(),
  });
});

const ADMIN_GETS = [
  "/api/admin/jobs/pending",
  "/api/admin/jobs/approved",
  "/api/admin/jobs/delete-requests",
  "/api/dashboard/admin",
  "/api/admin/users",
];

describe("admin route gating (was open before Phase 5)", () => {
  it.each(ADMIN_GETS)("%s → 401 without a token", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it.each(ADMIN_GETS)("%s → 403 for candidates", async (url) => {
    const res = await as("get", url, CANDIDATE);
    expect(res.status).toBe(403);
  });

  it.each(ADMIN_GETS)("%s → 200 for admins", async (url) => {
    const res = await as("get", url, ADMIN);
    expect(res.status).toBe(200);
  });

  it("admin job actions (approve/reject/delete) are gated too", async () => {
    expect((await request(app).put("/api/admin/jobs/64b0000000000000000000aa/approve")).status).toBe(401);
    expect((await as("put", "/api/admin/jobs/64b0000000000000000000aa/approve", CANDIDATE)).status).toBe(403);
    expect((await as("put", "/api/admin/jobs/64b0000000000000000000aa/approve", ADMIN)).status).toBe(200);
    expect((await as("put", "/api/admin/jobs/64b0000000000000000000aa/reject", ADMIN)).status).toBe(200);
    expect((await as("delete", "/api/admin/jobs/64b0000000000000000000aa", ADMIN)).status).toBe(200);
  });

  it("approve actually flips status to approved (admin happy path)", async () => {
    await as("put", "/api/admin/jobs/64b0000000000000000000aa/approve", ADMIN);
    expect(getFakeDocs("find_jobs")[0].status).toBe("approved");
  });
});
