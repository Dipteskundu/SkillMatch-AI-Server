// tests/publicApi.test.js — Phase 5 public REST API (API-key auth) + admin
// key management. In-memory models, no network, no real keys.
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
import { hashApiKey, generateApiKey, resetApiKeyStateForTests } from "../middleware/apiKeyAuth.js";
import { getFakeDocs, resetFakeStore, makeFakeRawDb } from "./fixtures/fakeModels.js";

const ADMIN_UID = "admin-uid-1";

function tokenFor(uid, role) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function seedApiKey({ rateLimitPerMin = 60, revoked = false, active = true } = {}) {
  const { key, keyHash, keyPrefix } = generateApiKey();
  getFakeDocs("api_keys").push({
    _id: `${getFakeDocs("api_keys").length + 1}`.padStart(24, "0"),
    name: "test key",
    keyHash,
    keyPrefix,
    rateLimitPerMin,
    active,
    revokedAt: revoked ? new Date() : null,
    createdAt: new Date(),
  });
  return key;
}

function withKey(url, key) {
  return request(app).get(url).set("Authorization", `Bearer ${key}`);
}

function seedJobs() {
  getFakeDocs("find_jobs").push(
    {
      _id: "64b000000000000000000001",
      title: "Senior React Developer",
      description: "Build React apps",
      company: "Acme",
      location: "Remote",
      employmentType: "full-time",
      salary: "$120k",
      skills: ["React", "TypeScript"],
      niceToHaveSkills: ["Testing"],
      status: "approved",
      createdAt: new Date("2026-01-05"),
    },
    {
      _id: "64b000000000000000000002",
      title: "Python Data Engineer",
      description: "Pipelines",
      company: "DataCo",
      location: "Berlin",
      employmentType: "contract",
      skills: ["Python"],
      status: "approved",
      createdAt: new Date("2026-01-06"),
    },
    {
      _id: "64b000000000000000000003",
      title: "Secret Pending Role",
      description: "not public",
      company: "Hidden",
      skills: ["Go"],
      status: "pending",
      createdAt: new Date("2026-01-07"),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeStore();
  resetApiKeyStateForTests();
  globalThis.__testDb = makeFakeRawDb();
  getFakeDocs("users").push({
    firebaseUid: ADMIN_UID,
    email: "admin@test.dev",
    role: "admin",
  });
  seedJobs();
});

describe("GET /api/public/v1/jobs — API key auth", () => {
  it("401s INVALID_API_KEY without a key", async () => {
    const res = await request(app).get("/api/public/v1/jobs");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_API_KEY");
  });

  it("401s for an unknown key", async () => {
    const res = await withKey("/api/public/v1/jobs", "smk_live_totally-made-up");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_API_KEY");
  });

  it("401s for a revoked key", async () => {
    const key = seedApiKey({ revoked: true });
    const res = await withKey("/api/public/v1/jobs", key);
    expect(res.status).toBe(401);
  });

  it("429s RATE_LIMITED once the per-key window is exhausted", async () => {
    const key = seedApiKey({ rateLimitPerMin: 2 });
    expect((await withKey("/api/public/v1/jobs", key)).status).toBe(200);
    expect((await withKey("/api/public/v1/jobs", key)).status).toBe(200);
    const third = await withKey("/api/public/v1/jobs", key);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("accepts X-API-Key as an alternative header", async () => {
    const key = seedApiKey();
    const res = await request(app).get("/api/public/v1/jobs").set("X-API-Key", key);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/public/v1/jobs — filtering + shape", () => {
  it("returns only approved jobs, newest first, with the public shape", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs", key);
    expect(res.status).toBe(200);
    const { jobs, page, total, hasMore } = res.body.data;
    expect(total).toBe(2);
    expect(page).toBe(1);
    expect(hasMore).toBe(false);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Python Data Engineer"); // newest first
    expect(jobs[0].company).toEqual({ name: "DataCo" });
    expect(jobs[0]).toHaveProperty("requiredSkills");
    expect(jobs.every((j) => j.title !== "Secret Pending Role")).toBe(true);
    expect(jobs[0]).not.toHaveProperty("description"); // list shape stays light
  });

  it("filters by q across title/description", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs?q=react", key);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.jobs[0].title).toBe("Senior React Developer");
  });

  it("filters by skills (case-insensitive exact) and employmentType", async () => {
    const key = seedApiKey();
    const bySkill = await withKey("/api/public/v1/jobs?skills=python", key);
    expect(bySkill.body.data.jobs.map((j) => j.title)).toEqual(["Python Data Engineer"]);

    const byType = await withKey("/api/public/v1/jobs?employmentType=full-time", key);
    expect(byType.body.data.total).toBe(1);
    expect(byType.body.data.jobs[0].title).toBe("Senior React Developer");
  });

  it("rejects an invalid employmentType with 400", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs?employmentType=gig", key);
    expect(res.status).toBe(400);
  });

  it("paginates", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs?page=2&limit=1", key);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.jobs).toHaveLength(1);
    expect(res.body.data.hasMore).toBe(false);
  });
});

describe("GET /api/public/v1/jobs/:id", () => {
  it("returns full detail for an approved job", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs/64b000000000000000000001", key);
    expect(res.status).toBe(200);
    expect(res.body.data.job.description).toBe("Build React apps");
    expect(res.body.data.job.company).toEqual({ name: "Acme" });
    expect(Array.isArray(res.body.data.job.responsibilities)).toBe(true);
  });

  it("404s for pending jobs and unknown ids", async () => {
    const key = seedApiKey();
    const pending = await withKey("/api/public/v1/jobs/64b000000000000000000003", key);
    expect(pending.status).toBe(404);
    expect(pending.body.error.code).toBe("NOT_FOUND");

    const unknown = await withKey("/api/public/v1/jobs/ffffffffffffffffffffffff", key);
    expect(unknown.status).toBe(404);
  });

  it("400s on an invalid id", async () => {
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/jobs/not-an-id", key);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/public/v1/skills", () => {
  it("returns canonical skills with demand ordering", async () => {
    getFakeDocs("skills").push(
      { name: "React", slug: "react", category: "web", demand: 90 },
      { name: "SQL", slug: "sql", category: "data", demand: 95 },
    );
    const key = seedApiKey();
    const res = await withKey("/api/public/v1/skills", key);
    expect(res.status).toBe(200);
    expect(res.body.data.skills.map((s) => s.slug)).toEqual(["sql", "react"]);
    expect(res.body.data.skills[0]).not.toHaveProperty("__v");
  });
});

describe("admin API key management", () => {
  const url = "/api/admin/api-keys";

  it("401s without a token and 403s for candidates", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    const cand = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${tokenFor("cand-1")}`);
    // candidate user not in store → role defaults to "candidate" in verifyToken
    expect(cand.status).toBe(403);
  });

  it("mints a key ONCE (plaintext returned only at creation) and audits it", async () => {
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_UID)}`)
      .send({ name: "my integration" });

    expect(res.status).toBe(201);
    expect(res.body.data.key).toMatch(/^smk_live_/);
    expect(res.body.data.keyPrefix).toBe(res.body.data.key.slice(0, 13));

    const list = await request(app).get(url).set("Authorization", `Bearer ${tokenFor(ADMIN_UID)}`);
    expect(list.status).toBe(200);
    const listed = list.body.data.keys[0];
    expect(listed.keyPrefix).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain(res.body.data.key); // full key unrecoverable

    const audit = getFakeDocs("audit_logs").find((a) => a.action === "api_key_created");
    expect(audit).toBeTruthy();
    expect(audit.userId).toBe(ADMIN_UID);
  });

  it("the minted key works on the public API; revoking kills it", async () => {
    const created = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_UID)}`)
      .send({ name: "revoke me" });
    const key = created.body.data.key;
    expect((await withKey("/api/public/v1/jobs", key)).status).toBe(200);

    const revoke = await request(app)
      .delete(`${url}/${created.body.data._id}`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_UID)}`);
    expect(revoke.status).toBe(200);

    expect((await withKey("/api/public/v1/jobs", key)).status).toBe(401);
  });

  it("400s on an empty name", async () => {
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_UID)}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });
});
