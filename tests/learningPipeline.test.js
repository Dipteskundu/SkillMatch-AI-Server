// tests/learningPipeline.test.js
// Phase 4 SkillForge ADMIN CONTENT PIPELINE — outline -> LLM generate ->
// review edit -> publish (versioned) -> archive, with a mocked LLM (no network).
//
// Proves: auth gating (401/403 for non-admins), draft creation, generation
// moving status to in_review with salted answer hashes stored, clean 503
// AI_UNAVAILABLE when the LLM is down (draft preserved), partial-failure
// atomicity (nothing half-published), versioned snapshots on publish, and the
// review queue / admin list.

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
    generateVerifiableCode: () => "vc-static-code-1",
  };
});

// Deterministic LLM stub (full export surface expected by transitive importers).
vi.mock("../services/llm.js", () => ({
  generateJSON: vi.fn(),
  generateText: vi.fn(async () => "ok"),
  isLLMAvailable: vi.fn(() => true),
  LLMConfigError: class LLMConfigError extends Error {},
}));

import app from "../api/index.js";
import { generateJSON, isLLMAvailable } from "../services/llm.js";
import { hashExpectedAnswer } from "../services/skillEvaluationService.js";
import { getFakeDocs, resetFakeStore, makeFakeRawDb } from "./fixtures/fakeModels.js";

const ADMIN = "admin-1";
const LESSON_CONTENT = {
  intro: "Why components matter.",
  sections: [
    { heading: "Mental model", paragraphs: ["A component is a function.", "It returns UI."] },
    { heading: "Practice", paragraphs: ["Try it."], list: ["one", "two"], code: { lang: "jsx", text: "<App />" } },
  ],
  takeaways: ["Think in components."],
};
const QUIZ_DRAFT = {
  questions: [
    { prompt: "What is a component?", options: ["A function", "A class only", "A database", "CSS"], answerIndex: 0, explanation: "Components are functions returning UI.", skillSlug: "react" },
    { prompt: "What does JSX stand for?", options: ["JavaScript XML", "Java Syntax", "JSON XY", "JS Extra"], answerIndex: 0, explanation: "JSX = JavaScript XML.", skillSlug: "react" },
  ],
};

function tokenFor(uid) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function adminPost(url, body) {
  return request(app).post(url).set("Authorization", `Bearer ${tokenFor(ADMIN)}`).send(body ?? {});
}
function adminGet(url) {
  return request(app).get(url).set("Authorization", `Bearer ${tokenFor(ADMIN)}`);
}

const outlineBody = {
  technologySlug: "web-development",
  skillSlug: "react",
  title: "React Fundamentals",
  level: "beginner",
  estimatedHours: 4,
  modules: [
    { title: "Basics", lessons: [{ title: "Components", durationMin: 6 }, { title: "Props", durationMin: 5 }] },
  ],
};

/** Seed a path in a given state directly (draft outline or generated in_review). */
function seedPathDoc({ status = "draft", withContent = false, withQuiz = false } = {}) {
  const salt = "pipeline-salt";
  const lesson = (title) => ({
    _id: new ObjectId(),
    title,
    durationMin: 6,
    type: "article",
    content: withContent ? LESSON_CONTENT : { intro: "", sections: [], takeaways: [] },
  });
  const doc = {
    _id: new ObjectId(),
    technologyId: getFakeDocs("technologies")[0]._id,
    skillSlug: "react",
    title: "React Fundamentals",
    slug: "react-fundamentals",
    level: "beginner",
    estimatedHours: 4,
    status,
    modules: [{ _id: new ObjectId(), title: "Basics", lessons: [lesson("Components"), lesson("Props")] }],
    quiz: withQuiz
      ? {
          passingScore: 70,
          salt,
          questions: QUIZ_DRAFT.questions.map((q) => ({
            _id: new ObjectId(),
            prompt: q.prompt,
            options: q.options,
            answerIndex: q.answerIndex,
            answerHash: hashExpectedAnswer(q.answerIndex, salt),
            explanation: q.explanation,
            skillSlug: q.skillSlug,
          })),
        }
      : { passingScore: 70, salt: "", questions: [] },
    versions: [],
    contentLog: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  getFakeDocs("learning_paths").push(doc);
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  isLLMAvailable.mockImplementation(() => true);
  resetFakeStore();
  globalThis.__testDb = makeFakeRawDb();
  getFakeDocs("users").push({ firebaseUid: ADMIN, email: `${ADMIN}@test.dev`, role: "admin" });
  getFakeDocs("users").push({ firebaseUid: "uid-1", email: "uid-1@test.dev", role: "candidate" });
  getFakeDocs("technologies").push({ _id: new ObjectId(), name: "Web Development", slug: "web-development", category: "web", order: 1, createdAt: new Date() });
});

// ─────────────────────────────────────────────────────────────
// Auth gating
// ─────────────────────────────────────────────────────────────

describe("admin learning auth", () => {
  it("401s without a token and 403s for non-admin roles", async () => {
    const noToken = await request(app).get("/api/admin/learning/review-queue");
    expect(noToken.status).toBe(401);

    const candidate = await request(app)
      .get("/api/admin/learning/review-queue")
      .set("Authorization", `Bearer ${tokenFor("uid-1")}`);
    expect(candidate.status).toBe(403);
    expect(candidate.body).toMatchObject({ success: false, message: "Admin access required" });
    expect(getFakeDocs("learning_paths")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Outline -> draft
// ─────────────────────────────────────────────────────────────

describe("POST /api/admin/learning/outlines", () => {
  it("creates a draft with empty lesson content and an outline contentLog entry", async () => {
    const res = await adminPost("/api/admin/learning/outlines", outlineBody);

    expect(res.status).toBe(201);
    expect(res.body.data.path).toMatchObject({ title: "React Fundamentals", slug: "react-fundamentals", status: "draft", lessonCount: 2, quizQuestionCount: 0 });

    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.status).toBe("draft");
    expect(doc.modules[0].lessons[0].content.intro).toBe("");
    expect(doc.contentLog[0]).toMatchObject({ action: "outline", by: ADMIN });
  });

  it("404s for an unknown technology and 400s an invalid body", async () => {
    const unknown = await adminPost("/api/admin/learning/outlines", { ...outlineBody, technologySlug: "blockchain-dev" });
    expect(unknown.status).toBe(404);

    const invalid = await adminPost("/api/admin/learning/outlines", { technologySlug: "web-development", skillSlug: "react" });
    expect(invalid.status).toBe(400);
    expect(getFakeDocs("learning_paths")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Generate (LLM)
// ─────────────────────────────────────────────────────────────

describe("POST /api/admin/learning/paths/:pathId/generate", () => {
  it("drafts lesson content + quiz, stores salted hashes and moves the path to in_review", async () => {
    const path = seedPathDoc({ status: "draft" });
    generateJSON
      .mockResolvedValueOnce(LESSON_CONTENT) // lesson 1
      .mockResolvedValueOnce(LESSON_CONTENT) // lesson 2
      .mockResolvedValueOnce(QUIZ_DRAFT); // quiz

    const res = await adminPost(`/api/admin/learning/paths/${path._id}/generate`);

    expect(res.status).toBe(200);
    expect(res.body.data.path).toMatchObject({ status: "in_review", lessonCount: 2, lessonsWithContent: 2, quizQuestionCount: 2 });

    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.status).toBe("in_review");
    expect(doc.modules[0].lessons[0].content.intro).toBe("Why components matter.");
    expect(doc.quiz.salt).toMatch(/^[0-9a-f]{32}$/);
    const q = doc.quiz.questions[0];
    expect(q.answerIndex).toBe(0); // stored server-side for review/snapshot
    expect(q.answerHash).toBe(hashExpectedAnswer(q.answerIndex, doc.quiz.salt)); // salted-hash convention
    expect(doc.contentLog.some((e) => e.action === "generate")).toBe(true);
  });

  it("fails cleanly with 503 AI_UNAVAILABLE when no LLM provider is available (draft preserved)", async () => {
    const path = seedPathDoc({ status: "draft" });
    isLLMAvailable.mockImplementation(() => false);

    const res = await adminPost(`/api/admin/learning/paths/${path._id}/generate`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    expect(res.body.success).toBe(false);
    expect(generateJSON).not.toHaveBeenCalled();

    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.status).toBe("draft"); // outline untouched
    expect(doc.modules[0].lessons[0].content.intro).toBe("");
  });

  it("retries a failing lesson once, then fails with 503 + the failed lesson (nothing persisted)", async () => {
    const path = seedPathDoc({ status: "draft" });
    generateJSON
      .mockRejectedValueOnce(new Error("model down")) // L1 attempt 1
      .mockRejectedValueOnce(new Error("model down")) // L1 attempt 2 (retry)
      .mockResolvedValueOnce(LESSON_CONTENT) // L2 succeeds
      .mockResolvedValueOnce(QUIZ_DRAFT); // quiz succeeds

    const res = await adminPost(`/api/admin/learning/paths/${path._id}/generate`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    expect(res.body.error.message).toContain("Components"); // names the failed lesson

    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.status).toBe("draft"); // never half-published
    expect(doc.modules[0].lessons.every((l) => l.content.intro === "")).toBe(true);
    expect(doc.quiz.questions).toHaveLength(0);
    expect(doc.contentLog.some((e) => e.action === "generate_failed")).toBe(true);
  });

  it("recovers from a single lesson failure via the per-lesson retry", async () => {
    const path = seedPathDoc({ status: "draft" });
    generateJSON
      .mockRejectedValueOnce(new Error("flaky")) // L1 attempt 1
      .mockResolvedValueOnce(LESSON_CONTENT) // L1 attempt 2 (retry succeeds)
      .mockResolvedValueOnce(LESSON_CONTENT) // L2
      .mockResolvedValueOnce(QUIZ_DRAFT); // quiz

    const res = await adminPost(`/api/admin/learning/paths/${path._id}/generate`);
    expect(res.status).toBe(200);
    expect(getFakeDocs("learning_paths")[0].status).toBe("in_review");
  });

  it("404s unknown paths and rejects generating an archived path", async () => {
    const missing = await adminPost(`/api/admin/learning/paths/${new ObjectId()}/generate`);
    expect(missing.status).toBe(404);

    const archived = seedPathDoc({ status: "archived" });
    const res = await adminPost(`/api/admin/learning/paths/${archived._id}/generate`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });
});

// ─────────────────────────────────────────────────────────────
// Review edit
// ─────────────────────────────────────────────────────────────

describe("PUT /api/admin/learning/paths/:pathId/lessons/:lessonId", () => {
  it("edits drafted content and logs the action", async () => {
    const path = seedPathDoc({ status: "in_review", withContent: true, withQuiz: true });
    const lessonId = String(path.modules[0].lessons[0]._id);
    const edited = { ...LESSON_CONTENT, intro: "Edited intro by the reviewer." };

    const res = await request(app)
      .put(`/api/admin/learning/paths/${path._id}/lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`)
      .send({ content: edited });

    expect(res.status).toBe(200);
    expect(res.body.data.lesson.content.intro).toBe("Edited intro by the reviewer.");
    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.modules[0].lessons[0].content.intro).toBe("Edited intro by the reviewer.");
    expect(doc.contentLog.some((e) => e.action === "edit_lesson")).toBe(true);
  });

  it("400s malformed content and 404s unknown lessons", async () => {
    const path = seedPathDoc({ status: "in_review", withContent: true });
    const bad = await request(app)
      .put(`/api/admin/learning/paths/${path._id}/lessons/${path.modules[0].lessons[0]._id}`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`)
      .send({ content: { intro: "" } });
    expect(bad.status).toBe(400);

    const missing = await request(app)
      .put(`/api/admin/learning/paths/${path._id}/lessons/${new ObjectId()}`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN)}`)
      .send({ content: LESSON_CONTENT });
    expect(missing.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// Publish / archive / lists
// ─────────────────────────────────────────────────────────────

describe("publish / archive", () => {
  it("publishes a generated path, bumps the version and snapshots modules + quiz server-side", async () => {
    const path = seedPathDoc({ status: "in_review", withContent: true, withQuiz: true });

    const first = await adminPost(`/api/admin/learning/paths/${path._id}/publish`, { note: "First release" });
    expect(first.status).toBe(200);
    expect(first.body.data.path).toMatchObject({ status: "published", version: 1, currentVersion: 1 });

    const doc = getFakeDocs("learning_paths")[0];
    expect(doc.status).toBe("published");
    expect(doc.versions).toHaveLength(1);
    expect(doc.versions[0]).toMatchObject({ version: 1, publishedBy: ADMIN, note: "First release" });
    // Snapshot includes the server-side answer key (never serialized to learners).
    expect(doc.versions[0].snapshot.quiz.questions[0].answerIndex).toBe(0);
    expect(doc.versions[0].snapshot.quiz.salt).toBeTruthy();
    expect(doc.versions[0].snapshot.modules[0].lessons).toHaveLength(2);
    expect(doc.contentLog.some((e) => e.action === "publish")).toBe(true);

    // Re-publish bumps to v2.
    const second = await adminPost(`/api/admin/learning/paths/${path._id}/publish`, {});
    expect(second.body.data.path.version).toBe(2);
    expect(doc.versions).toHaveLength(2);
  });

  it("refuses to publish a path without full content or a quiz", async () => {
    const noContent = seedPathDoc({ status: "in_review", withContent: false, withQuiz: true });
    const res1 = await adminPost(`/api/admin/learning/paths/${noContent._id}/publish`, {});
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe("CONTENT_INCOMPLETE");

    const noQuiz = seedPathDoc({ status: "in_review", withContent: true, withQuiz: false });
    const res2 = await adminPost(`/api/admin/learning/paths/${noQuiz._id}/publish`, {});
    expect(res2.status).toBe(400);
  });

  it("archives a path", async () => {
    const path = seedPathDoc({ status: "published", withContent: true, withQuiz: true });
    const res = await adminPost(`/api/admin/learning/paths/${path._id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body.data.path.status).toBe("archived");
    expect(getFakeDocs("learning_paths")[0].status).toBe("archived");
  });
});

describe("admin lists", () => {
  it("review-queue returns only drafts + in_review with counts; /paths returns all statuses", async () => {
    seedPathDoc({ status: "draft" });
    seedPathDoc({ status: "in_review", withContent: true, withQuiz: true });
    seedPathDoc({ status: "published", withContent: true, withQuiz: true });

    const queue = await adminGet("/api/admin/learning/review-queue");
    expect(queue.status).toBe(200);
    expect(queue.body.data.paths).toHaveLength(2);
    expect(queue.body.data.paths.map((p) => p.status).sort()).toEqual(["draft", "in_review"]);
    expect(queue.body.data.paths[0]).toHaveProperty("lessonCount");
    expect(queue.body.data.paths[0]).toHaveProperty("technologyName", "Web Development");

    const all = await adminGet("/api/admin/learning/paths");
    expect(all.status).toBe(200);
    expect(all.body.data.paths).toHaveLength(3);
  });
});
