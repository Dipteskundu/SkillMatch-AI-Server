// POST /api/jobs/generate-draft — recruiter-only AI job-draft generation.
// DB + LLM are mocked exactly like tests/jobs.test.js / fitScoreRoutes.test.js
// so the route contract (validation, role gate, response shape, template
// fallback) is proven without a database or a Gemini key.
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

// Token gate: reads the test user from a global (same pattern as
// tests/chatbotGrounding.test.js) so no Firebase/network is involved.
vi.mock("../middleware/auth.js", () => ({
  verifyToken: (req, res, next) => {
    if (!globalThis.__testUser) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }
    req.user = globalThis.__testUser;
    return next();
  },
}));

// Never hit Gemini in tests — the route's behaviour is driven per-test by
// toggling isLLMAvailable()/generateJSON() below.
vi.mock("../services/llm.js", () => ({
  generateJSON: vi.fn(async () => ({})),
  generateText: vi.fn(async () => "ok"),
  isLLMAvailable: vi.fn(() => true),
}));

import app from "../api/index.js";
import { generateJSON, isLLMAvailable } from "../services/llm.js";

const recruiterUid = "recruiter-uid-1";

function makeDb(user) {
  return {
    collection: vi.fn((name) =>
      name === "users"
        ? { findOne: vi.fn(async () => user) }
        : { findOne: vi.fn(async () => null), find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) },
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isLLMAvailable.mockImplementation(() => true);
  globalThis.__testDb = makeDb({ firebaseUid: recruiterUid, role: "recruiter" });
  globalThis.__testUser = { uid: recruiterUid, role: "recruiter" };
});

/** Every draft — AI or template — must satisfy this contract. */
function expectWellFormedDraft(data) {
  expect(typeof data.description).toBe("string");
  expect(data.description.length).toBeGreaterThan(20);
  for (const key of ["responsibilities", "requirements", "niceToHaveSkills"]) {
    expect(Array.isArray(data[key])).toBe(true);
    expect(data[key].length).toBeGreaterThan(0);
    expect(data[key].every((item) => typeof item === "string" && item.trim().length > 0)).toBe(true);
  }
}

describe("POST /api/jobs/generate-draft — validation", () => {
  it("400s via Zod when uid/title are missing and never calls the LLM", async () => {
    const res = await request(app).post("/api/jobs/generate-draft").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: "Invalid request body" });
    expect(res.body.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["uid", "title"]),
    );
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("400s on an oversized skills array", async () => {
    const res = await request(app).post("/api/jobs/generate-draft").send({
      uid: recruiterUid,
      title: "Backend Engineer",
      skills: Array.from({ length: 51 }, (_, i) => `skill-${i}`),
    });

    expect(res.status).toBe(400);
    expect(res.body.issues.map((i) => i.path)).toContain("skills");
    expect(generateJSON).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/generate-draft — role gate", () => {
  it("403s for a candidate (non-recruiter role) without calling the LLM", async () => {
    globalThis.__testDb = makeDb({ firebaseUid: "candidate-uid-1", role: "candidate" });
    globalThis.__testUser = { uid: "candidate-uid-1", role: "candidate" };

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: "candidate-uid-1", title: "Senior React Developer" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false });
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("401s when no token is attached", async () => {
    globalThis.__testUser = null;

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: recruiterUid, title: "Senior React Developer" });

    expect(res.status).toBe(401);
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("403s when the body uid does not match the authenticated token uid", async () => {
    globalThis.__testUser = { uid: "some-other-recruiter", role: "recruiter" };

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: recruiterUid, title: "Senior React Developer" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/does not match/i);
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("403s when no user record exists for the uid", async () => {
    globalThis.__testDb = makeDb(null);

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: recruiterUid, title: "Senior React Developer" });

    expect(res.status).toBe(403);
    expect(generateJSON).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/generate-draft — template fallback (LLM down)", () => {
  it("returns a well-formed template draft when no API key is configured", async () => {
    isLLMAvailable.mockImplementation(() => false);

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({
        uid: recruiterUid,
        title: "Senior React Developer",
        skills: ["React", "TypeScript"],
        seniority: "Senior",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe("template");
    expectWellFormedDraft(res.body.data);
    expect(generateJSON).not.toHaveBeenCalled();

    // Responsibilities / requirements are DERIVED from the supplied skills.
    expect(res.body.data.requirements.some((r) => r.includes("React"))).toBe(true);
    expect(res.body.data.description).toContain("Senior React Developer");
    expect(res.body.data.description).toContain("Senior");
  });

  it("falls back to the template when the LLM call throws (quota/outage)", async () => {
    generateJSON.mockRejectedValue(new Error("Gemini API quota exceeded"));

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: recruiterUid, title: "Data Engineer", skills: ["Python", "SQL"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe("template");
    expectWellFormedDraft(res.body.data);
  });
});

describe("POST /api/jobs/generate-draft — LLM path", () => {
  it("returns the model's draft with source 'ai' and validates against the schema", async () => {
    generateJSON.mockResolvedValue({
      description: "AI-written description.",
      responsibilities: ["Build the thing"],
      requirements: ["Knows React"],
      niceToHaveSkills: ["Rust"],
    });

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({
        uid: recruiterUid,
        title: "Frontend Engineer",
        skills: ["React"],
        seniority: "Mid Level",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, source: "ai" });
    expect(res.body.data).toEqual({
      description: "AI-written description.",
      responsibilities: ["Build the thing"],
      requirements: ["Knows React"],
      niceToHaveSkills: ["Rust"],
    });

    expect(generateJSON).toHaveBeenCalledTimes(1);
    const args = generateJSON.mock.calls[0][0];
    expect(args.promptTag).toBe("job.generateDraft");
    expect(args.schema).toBeDefined();
    expect(typeof args.schema.safeParse).toBe("function");
    expect(args.prompt).toContain("Frontend Engineer");
    expect(args.prompt).toContain('["React"]');
  });

  it("patches a partial model response with template content (always well-formed)", async () => {
    generateJSON.mockResolvedValue({ description: "Only a description came back." });

    const res = await request(app)
      .post("/api/jobs/generate-draft")
      .send({ uid: recruiterUid, title: "QA Engineer", skills: ["Cypress"] });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expectWellFormedDraft(res.body.data);
    expect(res.body.data.description).toBe("Only a description came back.");
  });
});
