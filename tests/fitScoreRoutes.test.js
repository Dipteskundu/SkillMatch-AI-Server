// tests/fitScoreRoutes.test.js
// Integration-style tests for the unified Hiring Fit Score API surface:
//   • GET  /api/jobs/:id/fit          (transparency.routes — FitMapModal contract)
//   • POST /api/jobs/:id/apply        (aiScore written on application creation)
//   • POST /api/applications/:id/recalculate (ownership-gated recompute)
// Raw-Driver collections are mocked exactly like tests/jobs.test.js — no DB.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { ObjectId } from "mongodb";

vi.mock("../config/db.js", () => ({
  connectDB: vi.fn(async () => {}),
  getDB: vi.fn(() => globalThis.__testDb),
}));

vi.mock("../config/mongoose.js", () => ({
  connectMongoose: vi.fn(async () => null),
  syncAllIndexes: vi.fn(async () => ({ total: 0, synced: 0, failed: [] })),
}));

// Never hit Gemini in tests (skill-gap suggestions use this deterministic stub).
vi.mock("../services/llm.js", () => ({
  generateJSON: vi.fn(async () => ["Practice the missing skill with a small project"]),
  generateText: vi.fn(async () => "ok"),
  isLLMAvailable: vi.fn(() => false),
}));

// No Firebase push notifications in tests.
vi.mock("../services/firebaseService.js", () => ({
  getFirebaseService: vi.fn(() => null),
}));

import app from "../api/index.js";

const jobId = new ObjectId();
const candidateUid = "candidate-uid-1";
const recruiterUid = "recruiter-uid-1";

const jobDoc = {
  _id: jobId,
  title: "Frontend Developer",
  company: "Acme",
  location: "Remote",
  status: "approved",
  skills: ["React", "JavaScript"],
  niceToHaveSkills: ["Figma"],
};

const candidateDoc = {
  firebaseUid: candidateUid,
  displayName: "Jane Doe",
  skills: ["JS", "Figma"], // "JS" -> javascript via the alias vocabulary
  verifiedSkills: ["JavaScript"],
  yearsOfExperience: 3,
  experience: [],
  education: [],
  certificates: [],
  projects: [],
  github: "",
  portfolioUrl: "",
};

function makeDb(overrides = {}) {
  const collections = {
    find_jobs: { findOne: vi.fn(async () => jobDoc) },
    users: { findOne: vi.fn(async () => candidateDoc) },
    skills: { find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) }, // -> starter vocabulary
    skill_tests: { findOne: vi.fn(async () => null) },
    communicationTests: { findOne: vi.fn(async () => null) },
    applications: {
      findOne: vi.fn(async () => null),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
      countDocuments: vi.fn(async () => 1),
    },
    skillGaps: { insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) },
    notifications: { insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) },
    ...overrides,
  };
  return { collection: vi.fn((name) => collections[name] || { findOne: async () => null, find: () => ({ toArray: async () => [] }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__testDb = makeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id/fit
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/jobs/:id/fit", () => {
  it("returns the unified score plus the legacy matchScore/display fields", async () => {
    const res = await request(app).get(`/api/jobs/${jobId}/fit?uid=${candidateUid}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;

    // Backward-compat shape (FitMapModal)
    expect(typeof data.matchScore).toBe("number");
    expect(data.jobTitle).toBe("Frontend Developer");
    expect(data.company).toBe("Acme");
    expect(data.totalRequired).toBe(2);
    expect(data.directSkills).toEqual(["JavaScript"]); // original casing, exact only
    // "React" is missing exactly, but the candidate's JavaScript is ADJACENT
    // (seed graph react <-> javascript) — so it is not reported as missing.
    expect(data.missingSkills).toEqual([]);
    expect(data.adjacentSkills).toEqual(["Figma"]); // nice-to-have the candidate has

    // THE contract
    expect(data.score).toMatchObject({
      total: data.matchScore,
      modelVersion: "fit-v1",
      noAssessment: false,
    });
    expect(data.score.matchedSkills).toEqual(["javascript"]);
    expect(data.score.missingSkills).toEqual([]);
    expect(data.score.adjacentSkills).toContainEqual({
      candidateSkill: "javascript",
      jobSkill: "react",
      credit: 0.6,
    });
    expect(Object.values(data.score.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(data.score.evidence.length).toBeGreaterThan(0);
    expect(typeof data.score.computedAt).toBe("string");

    // Worked example: required (1 exact + 1 adjacent)/2 = 80, preferred 100
    // -> skillMatch 0.7×80 + 0.3×100 = 86; assessment = verified coverage 1/3
    // -> 33; weights 64/36 -> total = round(55.04 + 11.88) = 67.
    expect(data.score.breakdown.skillMatch).toBe(86);
    expect(data.score.breakdown.assessment).toBe(33);
    expect(data.matchScore).toBe(67);
  });

  it("404s for an unknown job", async () => {
    globalThis.__testDb = makeDb({
      find_jobs: { findOne: vi.fn(async () => null) },
    });
    const res = await request(app).get(`/api/jobs/${jobId}/fit?uid=${candidateUid}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "Job not found" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jobs/:id/apply — aiScore written at creation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/jobs/:id/apply", () => {
  it("computes and stores the full aiScore subdocument on the application", async () => {
    const insertOne = globalThis.__testDb.collection("applications").insertOne;

    const res = await request(app)
      .post(`/api/jobs/${jobId}/apply`)
      .send({ uid: candidateUid, email: "jane@example.com" });

    expect(res.status).toBe(201);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const application = insertOne.mock.calls[0][0];

    // Candidate has JS (exact javascript), Python, Figma; job needs JavaScript
    // + React (adjacent to javascript) and prefers Figma (exact):
    // skillMatch = 0.7×80 + 0.3×100 = 86; assessment = verified coverage 1/3
    // -> 33; weights 64/36 -> total 67.
    expect(application.status).toBe("submitted");
    expect(application.aiScore).toMatchObject({
      total: 67,
      noAssessment: false,
      modelVersion: "fit-v1",
      matchedSkills: ["javascript"],
      missingSkills: [],
    });
    expect(application.aiScore.breakdown.skillMatch).toBe(86);
    expect(application.aiScore.weights.skillMatch).toBe(64);
    expect(application.aiScore.evidence.length).toBeGreaterThan(0);
    expect(application.aiScore.computedAt).toBeInstanceOf(Date);
  });

  it("500s without inserting anything when the job lookup hard-fails", async () => {
    globalThis.__testDb = makeDb({
      find_jobs: { findOne: vi.fn(async () => { throw new Error("db glitch"); }) },
    });
    const res = await request(app)
      .post(`/api/jobs/${jobId}/apply`)
      .send({ uid: candidateUid, email: "jane@example.com" });

    // The job fetch is now up-front (it feeds aiScore + skill-gap), so a hard
    // DB error rejects the apply instead of inserting a scoreless application.
    expect(res.status).toBe(500);
    expect(globalThis.__testDb.collection("applications").insertOne).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/applications/:id/recalculate
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/applications/:id/recalculate", () => {
  const applicationId = new ObjectId();
  const applicationDoc = {
    _id: applicationId,
    jobId,
    firebaseUid: candidateUid,
    email: "jane@example.com",
    status: "submitted",
    communicationScore: null,
  };

  it("403s for a recruiter who does not own the job", async () => {
    globalThis.__testDb = makeDb({
      applications: {
        findOne: vi.fn(async () => applicationDoc),
        insertOne: vi.fn(async () => ({ insertedId: applicationId })),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
        countDocuments: vi.fn(async () => 1),
      },
      users: {
        findOne: vi.fn(async (query) =>
          query.firebaseUid === recruiterUid
            ? { firebaseUid: recruiterUid, role: "recruiter", companyName: "OtherCo" }
            : candidateDoc),
      },
      find_jobs: { findOne: vi.fn(async () => ({ ...jobDoc, company: "Acme" })) },
    });

    const res = await request(app)
      .post(`/api/applications/${applicationId}/recalculate?uid=${recruiterUid}`);

    expect(res.status).toBe(403);
  });

  it("recomputes and stores aiScore for the job's owning recruiter", async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    globalThis.__testDb = makeDb({
      applications: {
        findOne: vi.fn(async () => applicationDoc),
        insertOne: vi.fn(async () => ({ insertedId: applicationId })),
        updateOne,
        countDocuments: vi.fn(async () => 1),
      },
      users: {
        findOne: vi.fn(async (query) =>
          query.firebaseUid === recruiterUid
            ? { firebaseUid: recruiterUid, role: "recruiter", companyName: "Acme" }
            : candidateDoc),
      },
      find_jobs: { findOne: vi.fn(async () => jobDoc) },
    });

    const res = await request(app)
      .post(`/api/applications/${applicationId}/recalculate?uid=${recruiterUid}`);

    expect(res.status).toBe(200);
    expect(res.body.data.aiScore).toMatchObject({
      total: expect.any(Number),
      modelVersion: "fit-v1",
    });
    expect(typeof res.body.data.aiScore.computedAt).toBe("string");

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: applicationId });
    expect(update.$set.aiScore).toMatchObject({ total: res.body.data.aiScore.total });
  });

  it("404s for an unknown application", async () => {
    globalThis.__testDb = makeDb({
      applications: { findOne: vi.fn(async () => null) },
    });
    const res = await request(app)
      .post(`/api/applications/${applicationId}/recalculate?uid=${recruiterUid}`);
    expect(res.status).toBe(404);
  });
});
