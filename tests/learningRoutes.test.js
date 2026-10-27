// tests/learningRoutes.test.js
// Phase 4 SkillForge LEARNER API — contract tests with in-memory fake Mongoose
// models (tests/fixtures/fakeModels.js), mocked fit engine, no network.
//
// Covers: catalog shape, free-path limit + release, daily lesson views (free vs
// pro), lesson completion (xp + streak), quiz unlock/hiding, server-side quiz
// grading (salted hashes), first-pass badges + skill verification + job cards,
// re-pass dedupe, progress, and gap->path matching.

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

// Offline JWT decode path (no Firebase Admin init in tests).
vi.mock("../services/firebaseService.js", () => ({
  getFirebaseService: vi.fn(() => null),
}));

// In-memory Mongoose models shared with the raw-driver middleware lookups.
vi.mock("../models/index.js", async () => {
  const { makeFakeModel, makeFakeRawDb } = await import("./fixtures/fakeModels.js");
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

// Deterministic fit engine for the "jobs you can now apply to" cards.
vi.mock("../services/fitScoreService.js", () => ({
  computeFitForDocs: vi.fn(async () => ({ total: 72 })),
}));

import app from "../api/index.js";
import { computeFitForDocs } from "../services/fitScoreService.js";
import { hashExpectedAnswer } from "../services/skillEvaluationService.js";
import { getFakeDocs, resetFakeStore, makeFakeRawDb } from "./fixtures/fakeModels.js";

const UID = "uid-1";
const SALT = "quiz-salt-1";
const techId = new ObjectId();

function tokenFor(uid = UID) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function get(url, uid = UID) {
  return request(app).get(url).set("Authorization", `Bearer ${tokenFor(uid)}`);
}
function post(url, body, uid = UID) {
  return request(app).post(url).set("Authorization", `Bearer ${tokenFor(uid)}`).send(body);
}
function del(url, uid = UID) {
  return request(app).delete(url).set("Authorization", `Bearer ${tokenFor(uid)}`);
}

function seedUser({ plan = "free", skills = [], verifiedSkills = [] } = {}) {
  getFakeDocs("users").push({
    firebaseUid: UID,
    email: `${UID}@test.dev`,
    role: "candidate",
    plan,
    skills,
    verifiedSkills,
  });
}

function seedPath({ status = "published", skillSlug = "react", title = "React", slug = "react" } = {}) {
  const lessonIds = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
  const mkLesson = (id, t) => ({
    _id: id,
    title: t,
    durationMin: 5,
    type: "article",
    content: { intro: "Intro.", sections: [{ heading: "H", paragraphs: ["P"] }], takeaways: ["T"] },
  });
  const doc = {
    _id: new ObjectId(),
    technologyId: techId,
    skillSlug,
    title,
    slug,
    level: "beginner",
    estimatedHours: 4,
    status,
    modules: [
      { _id: new ObjectId(), title: "M1", lessons: [mkLesson(lessonIds[0], "L1"), mkLesson(lessonIds[1], "L2")] },
      { _id: new ObjectId(), title: "M2", lessons: [mkLesson(lessonIds[2], "L3"), mkLesson(lessonIds[3], "L4")] },
    ],
    quiz: {
      passingScore: 70,
      salt: SALT,
      questions: [
        { _id: new ObjectId(), prompt: "Q1?", options: ["A", "B", "C", "D"], answerIndex: 1, answerHash: hashExpectedAnswer(1, SALT), explanation: "Because.", skillSlug },
        { _id: new ObjectId(), prompt: "Q2?", options: ["A", "B", "C", "D"], answerIndex: 2, answerHash: hashExpectedAnswer(2, SALT), explanation: "Because.", skillSlug },
      ],
    },
    versions: [],
    contentLog: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  getFakeDocs("learning_paths").push(doc);
  return doc;
}

function seedProgress(overrides = {}) {
  const doc = {
    _id: new ObjectId(),
    userId: UID,
    enrollments: [],
    quizAttempts: [],
    dailyLessonViews: { date: "", count: 0 },
    xp: 0,
    streakDays: 0,
    lastActivityAt: null,
    badges: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  getFakeDocs("user_progress").push(doc);
  return doc;
}

function enroll(progress, path, extra = {}) {
  progress.enrollments.push({
    pathId: path._id,
    enrolledAt: new Date(),
    completedLessonIds: [],
    percent: 0,
    completedAt: null,
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FREE_DAILY_LESSONS;
  delete process.env.FREE_ACTIVE_PATHS;
  resetFakeStore();
  globalThis.__testDb = makeFakeRawDb();
  seedUser();
  getFakeDocs("technologies").push({ _id: techId, name: "Web Development", slug: "web-development", category: "web", order: 1, createdAt: new Date() });
});

// ─────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────

describe("GET /api/learning/catalog", () => {
  it("401s without a token (route exists — not 404)", async () => {
    const res = await request(app).get("/api/learning/catalog");
    expect(res.status).toBe(401);
  });

  it("returns ordered technologies with published paths, progress, badges, xp and streak", async () => {
    const path = seedPath();
    seedPath({ title: "Python", slug: "python", skillSlug: "python", status: "draft" }); // draft: hidden
    const progress = seedProgress({ xp: 25, streakDays: 3 });
    enroll(progress, path, { percent: 50 });
    const badgeCertId = new ObjectId();
    progress.badges.push({ skillSlug: "sql", skillName: "SQL", pathId: path._id, certificateId: badgeCertId, at: new Date() });
    getFakeDocs("certificates").push({ _id: badgeCertId, userId: UID, verifiableCode: "cert-code-1", skillSlug: "sql", skillName: "SQL", issuedAt: new Date() });

    const res = await get("/api/learning/catalog");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { technologies, badges, xp, streakDays } = res.body.data;
    expect(technologies).toHaveLength(1);
    expect(technologies[0]).toMatchObject({ name: "Web Development", slug: "web-development", category: "web" });
    expect(technologies[0].paths).toHaveLength(1);
    expect(technologies[0].paths[0]).toMatchObject({
      title: "React",
      level: "beginner",
      estimatedHours: 4,
      lessonCount: 4,
      quizQuestionCount: 2,
      progressPercent: 50,
      enrolled: true,
      completed: false,
    });
    expect(badges).toEqual([expect.objectContaining({ skillSlug: "sql", skillName: "SQL", verifiableCode: "cert-code-1" })]);
    expect(xp).toBe(25);
    expect(streakDays).toBe(3);

    // Lesson content must never leak into the catalog.
    expect(JSON.stringify(res.body)).not.toMatch(/"content"/);
  });
});

// ─────────────────────────────────────────────────────────────
// Enroll / unenroll
// ─────────────────────────────────────────────────────────────

describe("enrollment", () => {
  it("blocks a second ACTIVE path on the free plan with FREE_PATH_LIMIT and frees the slot via DELETE", async () => {
    const path1 = seedPath();
    const path2 = seedPath({ title: "SQL", slug: "sql", skillSlug: "sql" });
    const progress = seedProgress();
    enroll(progress, path1); // one active enrollment

    const blocked = await post(`/api/learning/paths/${path2._id}/enroll`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FREE_PATH_LIMIT");
    expect(blocked.body.code).toBe("FREE_PATH_LIMIT");
    expect(blocked.body.message).toContain("DELETE");
    expect(progress.enrollments).toHaveLength(1);

    // DELETE releases the slot (quiz attempts / badges preserved).
    progress.quizAttempts.push({ pathId: path1._id, score: 90, passed: true, at: new Date() });
    const released = await del(`/api/learning/paths/${path1._id}/enroll`);
    expect(released.status).toBe(200);
    expect(released.body.data.released).toBe(true);
    expect(progress.enrollments).toHaveLength(0);
    expect(progress.quizAttempts).toHaveLength(1);

    const enrolled = await post(`/api/learning/paths/${path2._id}/enroll`);
    expect(enrolled.status).toBe(200);
    expect(enrolled.body.data.enrollment).toMatchObject({ pathId: String(path2._id), percent: 0, completed: false });
    expect(progress.enrollments).toHaveLength(1);
  });

  it("completed paths do not consume the free active-path slot", async () => {
    const path1 = seedPath();
    const path2 = seedPath({ title: "SQL", slug: "sql", skillSlug: "sql" });
    const progress = seedProgress();
    enroll(progress, path1, { percent: 100, completedAt: new Date(), completedLessonIds: [] });

    const res = await post(`/api/learning/paths/${path2._id}/enroll`);
    expect(res.status).toBe(200);
    expect(progress.enrollments).toHaveLength(2);
  });

  it("pro plan bypasses the free-path limit", async () => {
    getFakeDocs("users")[0].plan = "pro";
    seedPath();
    const path2 = seedPath({ title: "SQL", slug: "sql", skillSlug: "sql" });
    const progress = seedProgress();
    enroll(progress, getFakeDocs("learning_paths")[0]);

    const res = await post(`/api/learning/paths/${path2._id}/enroll`);
    expect(res.status).toBe(200);
  });

  it("enrolling an unpublished path 404s", async () => {
    const draft = seedPath({ status: "draft" });
    const res = await post(`/api/learning/paths/${draft._id}/enroll`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// Lessons + entitlements
// ─────────────────────────────────────────────────────────────

describe("GET /api/learning/paths/:pathId/lessons/:lessonId", () => {
  it("counts one daily view per fetch of an incomplete lesson and 403s over the free cap", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path);
    const lessonId = String(path.modules[0].lessons[0]._id);

    const first = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(first.status).toBe(200);
    expect(first.body.data.lesson).toMatchObject({ title: "L1", durationMin: 5 });
    expect(first.body.data.lesson.content).toMatchObject({ intro: "Intro." });
    expect(first.body.data.entitlement.remainingToday).toBe(2);

    const second = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(second.body.data.entitlement.remainingToday).toBe(1);
    const third = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(third.body.data.entitlement.remainingToday).toBe(0);

    const fourth = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(fourth.status).toBe(403);
    expect(fourth.body.error.code).toBe("DAILY_LESSON_LIMIT");
  });

  it("completed lessons stay re-readable for free users without burning views", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, {
      completedLessonIds: [path.modules[0].lessons[0]._id],
      percent: 25,
    });
    progress.dailyLessonViews = { date: "", count: 0 };
    const lessonId = String(path.modules[0].lessons[0]._id);

    // Cap already exhausted today — a completed lesson still loads.
    progress.dailyLessonViews = { date: new Date().toISOString().slice(0, 10), count: 3 };
    const res = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(res.status).toBe(200);
    expect(progress.dailyLessonViews.count).toBe(3); // no increment
  });

  it("pro plan is unlimited and reports remainingToday as null", async () => {
    getFakeDocs("users")[0].plan = "pro";
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path);
    const lessonId = String(path.modules[0].lessons[0]._id);

    for (let i = 0; i < 5; i += 1) {
      const res = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.entitlement.remainingToday).toBeNull();
    }
    expect(progress.dailyLessonViews.count).toBe(0); // pro views are not metered
  });

  it("requires enrollment before opening a lesson", async () => {
    const path = seedPath();
    seedProgress(); // no enrollment
    const lessonId = String(path.modules[0].lessons[0]._id);
    const res = await get(`/api/learning/paths/${path._id}/lessons/${lessonId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ENROLLED");
  });
});

describe("POST /api/learning/paths/:pathId/lessons/:lessonId/complete", () => {
  it("awards xp once per lesson, recomputes percent and updates the streak", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path);
    const [l1, l2] = path.modules[0].lessons;

    const first = await post(`/api/learning/paths/${path._id}/lessons/${l1._id}/complete`);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ percent: 25, xp: 10, streakDays: 1 });
    expect(progress.enrollments[0].completedLessonIds).toHaveLength(1);

    // Re-completing the same lesson does NOT double-award xp.
    const again = await post(`/api/learning/paths/${path._id}/lessons/${l1._id}/complete`);
    expect(again.body.data).toMatchObject({ percent: 25, xp: 10, streakDays: 1 });

    // Streak continues when the last activity was YESTERDAY.
    progress.lastActivityAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    progress.streakDays = 5;
    const next = await post(`/api/learning/paths/${path._id}/lessons/${l2._id}/complete`);
    expect(next.body.data).toMatchObject({ percent: 50, xp: 20, streakDays: 6 });
  });

  it("resets the streak after a gap of 2+ days and marks the path completed at 100%", async () => {
    const path = seedPath();
    const progress = seedProgress({ streakDays: 9, lastActivityAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    enroll(progress, path);

    const l1 = path.modules[0].lessons[0];
    const first = await post(`/api/learning/paths/${path._id}/lessons/${l1._id}/complete`);
    expect(first.body.data.streakDays).toBe(1); // gap > 1 day -> reset

    for (const mod of path.modules) {
      for (const lesson of mod.lessons) {
        await post(`/api/learning/paths/${path._id}/lessons/${lesson._id}/complete`);
      }
    }
    expect(progress.enrollments[0].percent).toBe(100);
    expect(progress.enrollments[0].completedAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// Quiz: unlock, hiding, grading, badge, verification, jobs
// ─────────────────────────────────────────────────────────────

describe("quiz", () => {
  it("locks the quiz below 80% progress", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, { percent: 75 });

    const res = await get(`/api/learning/paths/${path._id}/quiz`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("QUIZ_LOCKED");
  });

  it("returns only questionId/prompt/options — never answerIndex, answerHash, explanation or salt", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, { percent: 80 });

    const res = await get(`/api/learning/paths/${path._id}/quiz`);
    expect(res.status).toBe(200);
    expect(res.body.data.quiz.passingScore).toBe(70);
    expect(res.body.data.quiz.questions).toHaveLength(2);
    for (const q of res.body.data.quiz.questions) {
      expect(Object.keys(q).sort()).toEqual(["_id", "options", "prompt"]);
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/answerIndex/);
    expect(raw).not.toMatch(/answerHash/);
    expect(raw).not.toMatch(/explanation/);
    expect(raw).not.toMatch(/salt/);
  });

  it("grades against salted hashes; a first pass issues a badge, verifies the skill and returns job cards", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, { percent: 100 });
    getFakeDocs("find_jobs").push(
      { _id: new ObjectId(), title: "React Dev", company: "Acme", status: "approved", skills: ["React"], niceToHaveSkills: [], createdAt: new Date() },
      { _id: new ObjectId(), title: "Vue Dev", company: "Beta", status: "approved", skills: ["Vue.js"], niceToHaveSkills: [], createdAt: new Date() },
    );

    const [q1, q2] = path.quiz.questions;
    const res = await post(`/api/learning/paths/${path._id}/quiz/submit`, {
      answers: [
        { questionId: String(q1._id), choice: 1 }, // correct
        { questionId: String(q2._id), choice: 0 }, // wrong (correct: 2)
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ passed: false, score: 50, attempts: 1, badge: null });
    expect(res.body.data.newlyVerifiedSkills).toEqual([]);
    expect(progress.badges).toHaveLength(0);

    // All-correct retake passes and unlocks everything.
    const pass = await post(`/api/learning/paths/${path._id}/quiz/submit`, {
      answers: [
        { questionId: String(q1._id), choice: 1 },
        { questionId: String(q2._id), choice: 2 },
      ],
    });

    expect(pass.status).toBe(200);
    expect(pass.body.data).toMatchObject({
      passed: true,
      score: 100,
      attempts: 2,
      badge: { verifiableCode: "vc-static-code-1", skillSlug: "react", skillName: "React" },
      newlyVerifiedSkills: ["React"],
    });
    expect(computeFitForDocs).toHaveBeenCalled();
    // Only the React-matching approved job is returned, with the mocked fit.
    expect(pass.body.data.jobsYouCanNowApplyTo).toEqual([
      { _id: expect.any(String), title: "React Dev", company: "Acme", fitScore: 72 },
    ]);

    // Certificate + badge persisted once; profile skill upserted with provenance.
    expect(getFakeDocs("certificates")).toHaveLength(1);
    expect(progress.badges).toHaveLength(1);
    const user = getFakeDocs("users")[0];
    expect(user.verifiedSkills).toContain("React");
    expect(user.skills.some((s) => s?.name === "React" && s.source === "learning" && s.verified === true)).toBe(true);

    // Re-pass: NO duplicate badge/certificate, no re-verification.
    const repass = await post(`/api/learning/paths/${path._id}/quiz/submit`, {
      answers: [
        { questionId: String(q1._id), choice: 1 },
        { questionId: String(q2._id), choice: 2 },
      ],
    });
    expect(repass.body.data).toMatchObject({ passed: true, score: 100, attempts: 3, badge: null });
    expect(repass.body.data.newlyVerifiedSkills).toEqual([]);
    expect(getFakeDocs("certificates")).toHaveLength(1);
    expect(progress.badges).toHaveLength(1);
  });

  it("filters out jobs below the 50 fit threshold", async () => {
    computeFitForDocs.mockResolvedValueOnce({ total: 41 });
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, { percent: 100 });
    getFakeDocs("find_jobs").push({ _id: new ObjectId(), title: "React Dev", company: "Acme", status: "approved", skills: ["React"], niceToHaveSkills: [], createdAt: new Date() });

    const [q1, q2] = path.quiz.questions;
    const res = await post(`/api/learning/paths/${path._id}/quiz/submit`, {
      answers: [
        { questionId: String(q1._id), choice: 1 },
        { questionId: String(q2._id), choice: 2 },
      ],
    });
    expect(res.body.data.passed).toBe(true);
    expect(res.body.data.jobsYouCanNowApplyTo).toEqual([]);
  });

  it("rejects quiz submit while locked", async () => {
    const path = seedPath();
    const progress = seedProgress();
    enroll(progress, path, { percent: 20 });
    const res = await post(`/api/learning/paths/${path._id}/quiz/submit`, { answers: [{ questionId: "x", choice: 0 }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("QUIZ_LOCKED");
  });
});

// ─────────────────────────────────────────────────────────────
// Progress + match-paths
// ─────────────────────────────────────────────────────────────

describe("GET /api/learning/progress", () => {
  it("returns enrollments with titles, badges, xp, streak and the 10 most recent quiz attempts", async () => {
    const path = seedPath();
    const progress = seedProgress({ xp: 40, streakDays: 2 });
    enroll(progress, path, { percent: 75 });
    const certId = new ObjectId();
    progress.badges.push({ skillSlug: "sql", skillName: "SQL", pathId: path._id, certificateId: certId, at: new Date() });
    getFakeDocs("certificates").push({ _id: certId, userId: UID, verifiableCode: "cert-9", issuedAt: new Date() });
    for (let i = 0; i < 12; i += 1) {
      progress.quizAttempts.push({ pathId: path._id, score: i * 10, passed: i > 8, at: new Date(Date.now() + i * 1000) });
    }

    const res = await get("/api/learning/progress");

    expect(res.status).toBe(200);
    const { enrollments, badges, xp, streakDays, quizAttempts } = res.body.data;
    expect(enrollments).toEqual([
      expect.objectContaining({ pathId: String(path._id), title: "React", slug: "react", percent: 75, completed: false }),
    ]);
    expect(badges[0]).toMatchObject({ skillName: "SQL", verifiableCode: "cert-9" });
    expect(xp).toBe(40);
    expect(streakDays).toBe(2);
    expect(quizAttempts).toHaveLength(10);
    expect(new Date(quizAttempts[0].at).getTime()).toBeGreaterThan(new Date(quizAttempts[1].at).getTime());
  });
});

describe("POST /api/learning/match-paths", () => {
  it("maps alias skills to published paths and dedupes", async () => {
    seedPath(); // react
    seedPath({ title: "Python", slug: "python", skillSlug: "python" });

    const res = await post("/api/learning/match-paths", {
      skills: ["reactjs", "React", "py", "Blockchain"],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([
      { skill: "reactjs", pathId: expect.any(String), title: "React", slug: "react", level: "beginner", hours: 4 },
      { skill: "py", pathId: expect.any(String), title: "Python", slug: "python", level: "beginner", hours: 4 },
    ]);
  });

  it("400s an empty skills array via Zod", async () => {
    const res = await post("/api/learning/match-paths", { skills: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });
});

// ─────────────────────────────────────────────────────────────
// Path detail
// ─────────────────────────────────────────────────────────────

describe("GET /api/learning/paths/:pathId", () => {
  it("returns outline + quiz meta without content or answers", async () => {
    getFakeDocs("technologies").find((t) => String(t._id) === String(techId)).name = "Web Development";
    const path = seedPath();
    const progress = seedProgress({ xp: 10 });
    enroll(progress, path, { percent: 50, completedLessonIds: [path.modules[0].lessons[0]._id] });
    progress.quizAttempts.push({ pathId: path._id, score: 60, passed: false, at: new Date() });

    const res = await get(`/api/learning/paths/${path._id}`);

    expect(res.status).toBe(200);
    const p = res.body.data.path;
    expect(p).toMatchObject({
      title: "React",
      level: "beginner",
      skillSlug: "react",
      skillName: "React",
      technologyName: "Web Development",
      progressPercent: 50,
      enrolled: true,
    });
    expect(p.modules).toHaveLength(2);
    expect(p.modules[0].lessons[0]).toMatchObject({ title: "L1", completed: true });
    expect(p.modules[0].lessons[1]).toMatchObject({ title: "L2", completed: false });
    expect(p.quiz).toMatchObject({ questionCount: 2, passingScore: 70, attempted: 1, bestScore: 60, passed: false });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/answerIndex/);
    expect(raw).not.toMatch(/answerHash/);
    expect(raw).not.toMatch(/"content"/);
  });
});
