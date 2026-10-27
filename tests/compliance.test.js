// tests/compliance.test.js — Phase 5 Compliance Center APIs.
// Disclosure (public), own-data export + audit log (auth), bias metrics
// (admin, REAL aggregates only — the honesty of the note is asserted too).
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
import { getFakeDocs, resetFakeStore, makeFakeRawDb } from "./fixtures/fakeModels.js";

const ME = "me-uid-1";
const OTHER = "other-uid-1";
const ADMIN = "admin-uid-1";

function tokenFor(uid) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function authed(method, url, uid) {
  return request(app)[method](url).set("Authorization", `Bearer ${tokenFor(uid)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeStore();
  globalThis.__testDb = makeFakeRawDb();
  getFakeDocs("users").push(
    { firebaseUid: ME, email: "me@test.dev", role: "candidate", plan: "free", skills: ["React"] },
    { firebaseUid: OTHER, email: "other@test.dev", role: "candidate", plan: "free" },
    { firebaseUid: ADMIN, email: "admin@test.dev", role: "admin", plan: "free" },
  );
});

describe("GET /api/compliance/disclosure (public)", () => {
  it("200s without auth and states weights that sum to 100", async () => {
    const res = await request(app).get("/api/compliance/disclosure");
    expect(res.status).toBe(200);
    const w = res.body.data.weights;
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    expect(res.body.data.scoreModelVersion).toBe("fit-v1");
    expect(res.body.data.demographics).toMatch(/No protected or demographic/i);
    expect(res.body.data.humanInTheLoop).toMatch(/recruiters make/i);
  });
});

describe("GET /api/compliance/me/score-export", () => {
  beforeEach(() => {
    getFakeDocs("applications").push(
      {
        candidateId: ME,
        jobId: "64b000000000000000000001",
        status: "shortlisted",
        aiScore: { total: 78, breakdown: { skillMatch: 40 }, evidence: [{ factor: "skillMatch", quote: "React" }], modelVersion: "fit-v1", computedAt: new Date() },
      },
      { candidateId: OTHER, jobId: "64b000000000000000000002", status: "applied", aiScore: { total: 33 } },
    );
    getFakeDocs("find_jobs").push(
      { _id: "64b000000000000000000001", title: "React Dev", company: "Acme", status: "approved" },
      { _id: "64b000000000000000000002", title: "Other Role", company: "OtherCo", status: "approved" },
    );
    getFakeDocs("certificates").push({ userId: ME, skillSlug: "sql", skillName: "SQL", verifiableCode: "abc123", score: 90, issuedAt: new Date() });
    getFakeDocs("user_progress").push({ userId: ME, xp: 120, streakDays: 3, badges: [{ skillSlug: "sql" }], enrollments: [] });
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/api/compliance/me/score-export");
    expect(res.status).toBe(401);
  });

  it("exports ONLY the caller's data, enriched with job titles, and writes an audit entry", async () => {
    const res = await authed("get", "/api/compliance/me/score-export", ME);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.user.email).toBe("me@test.dev");
    expect(d.skills).toEqual(["React"]);
    expect(d.applications).toHaveLength(1); // other user's application excluded
    expect(d.applications[0].jobTitle).toBe("React Dev");
    expect(d.applications[0].aiScore.total).toBe(78);
    expect(d.applications[0].aiScore.evidence[0].quote).toBe("React");
    expect(d.certificates[0].skillSlug).toBe("sql");
    expect(d.learning.xp).toBe(120);

    const audit = getFakeDocs("audit_logs").find((a) => a.action === "data_export" && a.userId === ME);
    expect(audit).toBeTruthy();
    expect(getFakeDocs("audit_logs").filter((a) => a.userId === OTHER)).toHaveLength(0);
  });
});

describe("GET /api/compliance/me/audit-log", () => {
  it("returns the caller's entries newest-first with totals, excluding others", async () => {
    for (let i = 1; i <= 3; i += 1) {
      getFakeDocs("audit_logs").push({ userId: ME, action: `act_${i}`, entity: "x", at: new Date(2026, 0, i) });
    }
    getFakeDocs("audit_logs").push({ userId: OTHER, action: "secret_act", entity: "x", at: new Date() });

    const res = await authed("get", "/api/compliance/me/audit-log?page=1&limit=2", ME);
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(2);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.entries[0].action).toBe("act_3"); // newest first
    expect(JSON.stringify(res.body.data)).not.toContain("secret_act");
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/api/compliance/me/audit-log");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/compliance/admin/bias-metrics", () => {
  beforeEach(() => {
    getFakeDocs("applications").push(
      { aiScore: { total: 30, breakdown: { assessment: 0 } } },
      { aiScore: { total: 50, breakdown: { assessment: 10 } } },
      { aiScore: { total: 70, breakdown: { assessment: 0 } } },
      { aiScore: { total: 90, breakdown: { assessment: 25 } } },
      { status: "applied" }, // unscored
    );
    getFakeDocs("find_jobs").push({ status: "approved" }, { status: "approved" }, { status: "pending" });
    getFakeDocs("users").push({
      firebaseUid: "cand-2",
      email: "c2@test.dev",
      role: "candidate",
      skills: [{ name: "React", source: "resume" }, { name: "SQL", source: "learning", verified: true }, "Legacy String Skill"],
    });
  });

  it("401s without a token and 403s for candidates", async () => {
    expect((await request(app).get("/api/compliance/admin/bias-metrics")).status).toBe(401);
    const cand = await authed("get", "/api/compliance/admin/bias-metrics", ME);
    expect(cand.status).toBe(403);
  });

  it("computes REAL score bands + coverage and refuses to invent demographic numbers", async () => {
    const res = await authed("get", "/api/compliance/admin/bias-metrics", ADMIN);
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d.scoreBands).toHaveLength(4);
    const byBand = Object.fromEntries(d.scoreBands.map((b) => [b.band, b.count]));
    expect(byBand["0-40"]).toBe(1); // 30
    expect(byBand["40-60"]).toBe(1); // 50
    expect(byBand["60-80"]).toBe(1); // 70
    expect(byBand["80-100"]).toBe(1); // 90
    expect(d.sampleSize).toEqual({ applications: 5, scoredApplications: 4 });
    expect(d.assessmentCoveragePct).toBe(50); // 2 of 4 have assessment > 0
    expect(d.jobs).toEqual({ withScores: 4, total: 2 });

    // skill provenance: object skills counted by source; legacy strings = self
    // (ME's "React" string from the outer fixture + cand-2's legacy string)
    expect(d.coverageBySkillSource).toEqual({ resume: 1, assessment: 0, learning: 1, self: 2 });

    // NO fabricated demographic metrics
    const raw = JSON.stringify(d);
    expect(raw).not.toMatch(/byGender|byEthnicity|fourFifths|0\.35/);
    expect(d.note).toMatch(/does not collect demographic/i);
    expect(d.note).toMatch(/opt-in/i);
  });

  it("returns honest zeros with no data", async () => {
    resetFakeStore();
    getFakeDocs("users").push({ firebaseUid: ADMIN, email: "admin@test.dev", role: "admin" });
    const res = await authed("get", "/api/compliance/admin/bias-metrics", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.scoreBands.every((b) => b.count === 0 && b.pct === 0)).toBe(true);
    expect(res.body.data.assessmentCoveragePct).toBe(0);
  });
});
