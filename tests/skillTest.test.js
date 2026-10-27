// tests/skillTest.test.js
// Phase 2 skill-test security redesign — route contract + grading tests with
// a mocked raw-driver collection (no database, no network).
//
// What this proves:
//  • generate NEVER serializes the answer key (correctAnswer / answerHash /
//    answerSalt / answer fields) — the key lives only in the DB as a salted
//    SHA-256 of the correct option's index;
//  • MCQ options are shuffled per attempt;
//  • grading works out-of-band (option text OR 0-based index) via the hash
//    path, and wrong answers score correctly;
//  • the 10-minute limit is enforced server-side (+30s grace), late submits
//    are rejected with TEST_EXPIRED and cannot be replayed;
//  • double submit is rejected atomically (anti-replay);
//  • verifiedSkills / isSkillVerified writes + 2h fail cooldown still work;
//  • legacy in-flight documents (plaintext correctAnswer) still grade.
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

// Deterministic AI: 3 questions per skill, correct answer always "Option B"
// (its position after the server-side shuffle is unknown to clients).
vi.mock("../services/aiQuestionService.js", () => ({
  generateSkillQuestions: vi.fn(async (skills) => {
    const out = [];
    skills.forEach((skill, si) => {
      for (let i = 0; i < 3; i += 1) {
        out.push({
          id: `q${si * 3 + i + 1}`,
          text: `${skill} question ${i + 1}`,
          difficulty: i === 0 ? "Simple" : "Medium",
          skill,
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: "Option B",
        });
      }
    });
    return out;
  }),
}));

// NOTE: services/fitScoreService.js is intentionally NOT mocked — the fitScore
// owner wires a fire-and-forget aiScore refresh into the pass path; it runs via
// setImmediate against the mocked DB (an in-memory fake) and cannot throw into
// the request path. Mocking it here would strip the named exports that
// transparency.routes.js / applications.routes.js import.

import app from "../api/index.js";
import {
  normalizeAnswer,
  resolveSubmittedIndex,
  hashExpectedAnswer,
} from "../services/skillEvaluationService.js";

let dbState;

function matchesQuery(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value instanceof ObjectId) return String(doc[key]) === String(value);
    return doc[key] === value;
  });
}

function makeCollection(docs) {
  return {
    findOne: vi.fn(async (query = {}) => docs.find((d) => matchesQuery(d, query)) ?? null),
    find: vi.fn((query = {}) => ({
      toArray: async () => docs.filter((d) => matchesQuery(d, query)),
    })),
    insertOne: vi.fn(async (doc) => {
      const _id = doc._id ?? new ObjectId();
      docs.push({ ...doc, _id });
      return { acknowledged: true, insertedId: _id };
    }),
    updateOne: vi.fn(async (query, update) => {
      const doc = docs.find((d) => matchesQuery(d, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set ?? {});
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    countDocuments: vi.fn(async (query = {}) => docs.filter((d) => matchesQuery(d, query)).length),
  };
}

/** Seed a pending (or given-state) test document directly — mirrors what generate stores. */
function seedTest({
  candidateId = "uid-1",
  skills = ["React", "Node"],
  salt = "test-salt-123",
  startedAt = new Date(),
  result = "pending",
} = {}) {
  const doc = {
    candidateId,
    skills,
    answerSalt: salt,
    timeLimitMinutes: 10,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + 10 * 60 * 1000),
    answers: [],
    score: null,
    result,
    createdAt: startedAt,
    questions: [
      // correct answer: "Y" (index 2)
      { id: "q1", text: "Q1", difficulty: "Simple", skill: "React", type: "mcq", options: ["W", "X", "Y", "Z"], answerHash: hashExpectedAnswer(2, salt) },
      // correct answer: "P" (index 0)
      { id: "q2", text: "Q2", difficulty: "Medium", skill: "Node", type: "mcq", options: ["P", "Q", "R", "S"], answerHash: hashExpectedAnswer(0, salt) },
    ],
  };
  dbState.skill_tests.push({ ...doc, _id: new ObjectId() });
  return dbState.skill_tests[dbState.skill_tests.length - 1];
}

function postGenerate(body) {
  return request(app).post("/api/skill-test/generate").send(body);
}

function postSubmit(body) {
  return request(app).post("/api/skill-test/submit").send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState = { skill_tests: [], users: [], assessment_results: [] };
  dbState.users.push({ firebaseUid: "uid-1", verifiedSkills: [], isSkillVerified: false });
  globalThis.__testDb = {
    collection: vi.fn((name) => makeCollection(dbState[name] ?? (dbState[name] = []))),
  };
});

describe("POST /api/skill-test/generate", () => {
  it("returns only API-safe question fields — nothing answer-bearing is serialized", async () => {
    const res = await postGenerate({ candidateId: "uid-1", skills: ["React"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Regression: the old response embedded `correctAnswer` on every question.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/correctAnswer/);
    expect(raw).not.toMatch(/answerHash/);
    expect(raw).not.toMatch(/answerSalt/);
    expect(raw).not.toMatch(/"answer"/);
    expect(raw).not.toMatch(/"answers"/);

    const questions = res.body.data.questions;
    expect(questions).toHaveLength(3);
    for (const q of questions) {
      // Exact whitelist projection per the redesigned contract.
      expect(Object.keys(q).sort()).toEqual(["difficulty", "id", "index", "options", "prompt", "skill", "type"]);
      expect(q.options).toHaveLength(4);
      expect(q.type).toBe("mcq");
    }

    // Timer + threshold contract used by the frontend countdown.
    expect(res.body.data.timeLimitMinutes).toBe(10);
    expect(res.body.data.remainingSec).toBe(600);
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.data.passingScore).toBe(60);

    // The key DOES exist server-side — but only as a salted hash in the DB.
    const stored = dbState.skill_tests[0];
    expect(stored.answerSalt).toBeTruthy();
    expect(stored.questions[0].answerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.questions[0].correctAnswer).toBeUndefined();
  });

  it("shuffles MCQ options per attempt (clients cannot hardcode a position)", async () => {
    const orders = new Set();
    for (let i = 0; i < 5; i += 1) {
      const res = await postGenerate({ candidateId: "uid-1", skills: ["React"] });
      expect(res.status).toBe(200);
      orders.add(res.body.data.questions[0].options.join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("enforces the 2h fail cooldown server-side", async () => {
    dbState.users[0].nextAttemptTime = new Date(Date.now() + 60 * 60 * 1000);

    const res = await postGenerate({ candidateId: "uid-1", skills: ["React"] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "COOLDOWN", cooldown: true });
    expect(typeof res.body.nextAttemptAt).toBe("string");
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
    expect(dbState.skill_tests).toHaveLength(0);
  });

  it("400s a request without skills via Zod validation and inserts nothing", async () => {
    const res = await postGenerate({ candidateId: "uid-1" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: "Invalid request body" });
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(dbState.skill_tests).toHaveLength(0);
  });
});

describe("POST /api/skill-test/submit", () => {
  it("grades a fresh generate out-of-band, writes verifiedSkills, and blocks replay", async () => {
    const gen = await postGenerate({ candidateId: "uid-1", skills: ["React"] });
    expect(gen.status).toBe(200);
    const testId = String(gen.body.data.testId);

    // Out-of-band knowledge (DB document only — the API never exposed it):
    // the mocked AI's correct answer is "Option B". Submit its shuffled
    // position as a 0-based index.
    const answers = dbState.skill_tests[0].questions.map((q) => ({
      questionId: q.id,
      answer: String(q.options.indexOf("Option B")),
    }));

    const sub = await postSubmit({ testId, candidateId: "uid-1", answers });

    expect(sub.status).toBe(200);
    expect(sub.body.data).toMatchObject({
      score: 100,
      result: "pass",
      passed: true,
      passingScore: 60,
      isSkillVerified: true,
      verifiedSkills: ["React"],
      perSkill: [{ skill: "React", correct: 3, total: 3, score: 100 }],
      nextAttemptAt: null,
    });

    // User document got the verification writes (no cooldown on pass).
    expect(dbState.users[0].verifiedSkills).toEqual(["React"]);
    expect(dbState.users[0].isSkillVerified).toBe(true);
    expect(dbState.users[0].nextAttemptTime).toBeUndefined();

    // Analytics row: one assessment_results doc with duration + attempt.
    const row = dbState.assessment_results[0];
    expect(row).toMatchObject({ candidateId: "uid-1", score: 100, result: "pass", attempt: 1 });
    expect(String(row.assessmentId)).toBe(String(dbState.skill_tests[0]._id));
    expect(row.durationSec).toBeGreaterThanOrEqual(0);
    expect(row.durationSec).toBeLessThanOrEqual(630);

    // Anti-replay: the second submit is rejected, not re-graded.
    const replay = await postSubmit({ testId, candidateId: "uid-1", answers });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ success: false, code: "ALREADY_SUBMITTED" });
    expect(dbState.assessment_results).toHaveLength(1);
  });

  it("accepts the correct option TEXT as well as the index (hash path, shuffled options)", async () => {
    const test = seedTest();

    const sub = await postSubmit({
      testId: String(test._id),
      candidateId: "uid-1",
      // "  y " → normalized "y" matches shuffled option "Y"; "P" is raw text.
      answers: [
        { questionId: "q1", answer: "  y " },
        { questionId: "q2", answer: "P" },
      ],
    });

    expect(sub.status).toBe(200);
    expect(sub.body.data).toMatchObject({ score: 100, result: "pass", passed: true });
  });

  it("scores wrong answers 0, marks fail, and starts the 2h cooldown", async () => {
    const test = seedTest();

    const sub = await postSubmit({
      testId: String(test._id),
      candidateId: "uid-1",
      answers: [
        { questionId: "q1", answer: "0" }, // correct is index 2
        { questionId: "q2", answer: "1" }, // correct is index 0
      ],
    });

    expect(sub.status).toBe(200);
    expect(sub.body.data).toMatchObject({ score: 0, result: "fail", passed: false });
    expect(sub.body.data.perSkill).toEqual([
      { skill: "React", correct: 0, total: 1, score: 0 },
      { skill: "Node", correct: 0, total: 1, score: 0 },
    ]);
    expect(sub.body.data.verifiedSkills).toEqual([]);
    expect(typeof sub.body.data.nextAttemptAt).toBe("string");

    expect(dbState.users[0].verifiedSkills).toEqual([]);
    const nextTime = new Date(dbState.users[0].nextAttemptTime).getTime();
    expect(nextTime).toBeGreaterThan(Date.now() + 115 * 60 * 1000); // ~2h

    expect(dbState.assessment_results[0]).toMatchObject({ result: "fail", score: 0 });
  });

  it("keeps the 60 pass threshold (50% is a fail)", async () => {
    const test = seedTest();

    const sub = await postSubmit({
      testId: String(test._id),
      candidateId: "uid-1",
      answers: [
        { questionId: "q1", answer: "2" }, // correct
        { questionId: "q2", answer: "1" }, // wrong
      ],
    });

    expect(sub.status).toBe(200);
    expect(sub.body.data).toMatchObject({ score: 50, result: "fail", passed: false });
    expect(dbState.users[0].nextAttemptTime).toBeDefined();
  });

  it("rejects a late submit with TEST_EXPIRED, records the attempt, and blocks replay", async () => {
    // 10m45s elapsed: past 10 minutes + 30s grace.
    const startedAt = new Date(Date.now() - (10 * 60 + 45) * 1000);
    const test = seedTest({ startedAt });

    const answers = [
      { questionId: "q1", answer: "2" },
      { questionId: "q2", answer: "0" },
    ];
    const sub = await postSubmit({ testId: String(test._id), candidateId: "uid-1", answers });

    expect(sub.status).toBe(400);
    expect(sub.body).toMatchObject({ success: false, code: "TEST_EXPIRED", expired: true });
    expect(dbState.skill_tests[0].result).toBe("expired");
    // Expiry does not burn the 2h fail cooldown — the candidate may restart.
    expect(dbState.users[0].nextAttemptTime).toBeUndefined();
    // Timed-out attempt recorded for analytics.
    expect(dbState.assessment_results[0]).toMatchObject({ result: "expired", score: null, durationSec: 600 });

    // Even the "correct" answers cannot be submitted after expiry.
    const replay = await postSubmit({ testId: String(test._id), candidateId: "uid-1", answers });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe("TEST_EXPIRED");
  });

  it("accepts a submit inside the 30s grace window", async () => {
    const startedAt = new Date(Date.now() - (10 * 60 + 20) * 1000); // 20s into grace
    const test = seedTest({ startedAt });

    const sub = await postSubmit({
      testId: String(test._id),
      candidateId: "uid-1",
      answers: [
        { questionId: "q1", answer: "2" },
        { questionId: "q2", answer: "0" },
      ],
    });

    expect(sub.status).toBe(200);
    expect(sub.body.data.result).toBe("pass");
  });

  it("grades legacy in-flight documents that still carry a plaintext correctAnswer", async () => {
    const legacy = {
      candidateId: "uid-1",
      skills: ["React"],
      answerSalt: "",
      timeLimitMinutes: 10,
      startedAt: new Date(),
      answers: [],
      score: null,
      result: "pending",
      createdAt: new Date(),
      questions: [
        {
          id: "q1",
          text: "Legacy question",
          skill: "React",
          options: ["Alpha", "Beta", "Gamma", "Delta"],
          correctAnswer: "Beta",
        },
      ],
    };
    dbState.skill_tests.push({ ...legacy, _id: new ObjectId() });

    const sub = await postSubmit({
      testId: String(dbState.skill_tests[0]._id),
      candidateId: "uid-1",
      answers: [{ questionId: "q1", answer: " beta " }],
    });

    expect(sub.status).toBe(200);
    expect(sub.body.data).toMatchObject({ score: 100, result: "pass" });
  });

  it("404s a submit for an unknown or foreign test", async () => {
    const res = await postSubmit({
      testId: "64b000000000000000000000",
      candidateId: "uid-1",
      answers: [{ questionId: "q1", answer: "0" }],
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "Test not found" });
  });
});

describe("skill evaluation helpers", () => {
  it("normalizeAnswer trims, lowercases, and collapses whitespace", () => {
    expect(normalizeAnswer("  Foo   BAR \n")).toBe("foo bar");
    expect(normalizeAnswer(undefined)).toBe("");
  });

  it("resolveSubmittedIndex accepts option text or a 0-based index (text wins)", () => {
    const options = ["one", "1", "three"];
    expect(resolveSubmittedIndex("ONE", options)).toBe(0);
    expect(resolveSubmittedIndex("1", options)).toBe(1); // matches option text "1"
    expect(resolveSubmittedIndex("two", ["one", "two", "three"])).toBe(1);
    expect(resolveSubmittedIndex("9", options)).toBe(-1); // out of range
    expect(resolveSubmittedIndex("", options)).toBe(-1);
  });

  it("hashExpectedAnswer is a salt-dependent 64-hex SHA-256", () => {
    const a = hashExpectedAnswer(1, "salt-a");
    const b = hashExpectedAnswer(1, "salt-b");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("salt-a"); // hash reveals nothing about inputs
  });
});
