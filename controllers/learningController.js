// controllers/learningController.js
// SkillForge Learning Hub (Phase 4) — LEARNER API.
//
// Identity convention: firebaseUid (req.user.uid — same as every other route).
// Entitlements: users.plan ("free" default / "pro" — Stripe lands Phase 5).
//   Free = FREE_DAILY_LESSONS lesson views/day (default 3) + FREE_ACTIVE_PATHS
//   active (not-completed) enrollment (default 1); Pro = unlimited.
// Quiz grading reuses the skill-test answer-key convention: per-question
// answerHash = sha256(`${salt}:idx:${correctChoice}`) (services/
// skillEvaluationService.hashExpectedAnswer) — answers never leave the server.

import { User, Job, LearningPath, Technology, UserProgress, Certificate, generateVerifiableCode } from "../models/index.js";
import {
  canonicalizeSkill,
  loadSkillVocabulary,
  normalizeJobSkills,
  normalizeCandidateSkills,
  normalizeKey,
} from "../services/skillNormalize.js";
import { computeFitForDocs } from "../services/fitScoreService.js";
import { hashExpectedAnswer } from "../services/skillEvaluationService.js";

const QUIZ_UNLOCK_PERCENT = 80;
const XP_PER_LESSON = 10;
const MIN_JOB_FIT = 50;
const MAX_JOB_CARDS = 5;

// ─────────────────────────────────────────────────────────────
// Entitlements (env-tunable; documented in .env.example)
// ─────────────────────────────────────────────────────────────

function intFromEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Free-tier daily lesson-view cap (FREE_DAILY_LESSONS, default 3). */
export function freeDailyLessonLimit() {
  return intFromEnv("FREE_DAILY_LESSONS", 3);
}

/** Free-tier active (not-completed) enrollment cap (FREE_ACTIVE_PATHS, default 1). */
export function freeActivePathLimit() {
  return intFromEnv("FREE_ACTIVE_PATHS", 1);
}

function isPro(user) {
  return user?.plan === "pro";
}

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

/** Error helper: top-level `code` (existing API convention) + `error:{code,message}` (Phase 4 contract). */
function fail(res, status, code, message) {
  return res.status(status).json({ success: false, message, code, error: { code, message } });
}

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayDayKey(value) {
  const d = new Date(value);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

async function ensureProgress(userId) {
  let progress = await UserProgress.findOne({ userId });
  if (!progress) {
    try {
      progress = await UserProgress.create({ userId });
    } catch {
      progress = await UserProgress.findOne({ userId }); // unique-index race
    }
  }
  return progress;
}

function enrollmentFor(progress, pathId) {
  const key = String(pathId);
  return (progress?.enrollments || []).find((e) => String(e.pathId) === key) || null;
}

function lessonIdsOf(path) {
  const ids = new Set();
  for (const mod of path.modules || []) for (const lesson of mod.lessons || []) ids.add(String(lesson._id));
  return ids;
}

function totalLessonCount(path) {
  return (path.modules || []).reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
}

function findLesson(path, lessonId) {
  const key = String(lessonId);
  for (const mod of path.modules || []) {
    for (const lesson of mod.lessons || []) {
      if (String(lesson._id) === key) return { mod, lesson };
    }
  }
  return null;
}

function quizAttemptsFor(progress, pathId) {
  const key = String(pathId);
  return (progress?.quizAttempts || []).filter((a) => String(a.pathId) === key);
}

/** Display name for a canonical skill slug via the skill vocabulary. */
async function skillNameForSlug(slug, vocab) {
  const v = vocab || (await loadSkillVocabulary());
  const entry = (v.entries || []).find((e) => e.slug === slug);
  return entry?.name || String(slug || "").replace(/-/g, " ");
}

/** Canonical skill name (lowercase key) for a path's skillSlug. */
function canonicalForSlug(slug, vocab) {
  return vocab?.slugToCanonical?.[slug] || String(slug || "").replace(/-/g, " ");
}

function slugForCanonical(canonical, vocab) {
  const entry = (vocab?.entries || []).find((e) => normalizeKey(e.name) === canonical);
  return entry?.slug || String(canonical || "").replace(/\s+/g, "-");
}

/** Today's lesson-view count (self-healing: a stale date resets to 0). */
function todayViewCount(progress) {
  const dl = progress?.dailyLessonViews;
  if (!dl || dl.date !== dayKey(new Date())) return 0;
  return Number(dl.count) || 0;
}

// ─────────────────────────────────────────────────────────────
// 1. GET /api/learning/catalog
// ─────────────────────────────────────────────────────────────

export const getCatalog = async (req, res) => {
  try {
    const uid = req.user.uid;
    const [paths, technologies, progress, certificates] = await Promise.all([
      LearningPath.find({ status: "published" }).sort({ createdAt: 1 }).toArray(),
      Technology.find({}).sort({ order: 1, createdAt: 1 }).toArray(),
      ensureProgress(uid),
      Certificate.find({ userId: uid }).toArray(),
    ]);

    const certById = new Map(certificates.map((c) => [String(c._id), c]));
    const vocab = await loadSkillVocabulary();

    const summarize = (path) => {
      const enrollment = enrollmentFor(progress, path._id);
      return {
        _id: String(path._id),
        title: path.title,
        slug: path.slug,
        level: path.level,
        estimatedHours: path.estimatedHours,
        lessonCount: totalLessonCount(path),
        quizQuestionCount: path.quiz?.questions?.length || 0,
        progressPercent: enrollment?.percent || 0,
        enrolled: Boolean(enrollment),
        completed: Boolean(enrollment?.completedAt),
      };
    };

    const grouped = new Map(technologies.map((t) => [String(t._id), []]));
    const orphanPaths = [];
    for (const path of paths) {
      const key = path.technologyId ? String(path.technologyId) : null;
      if (key && grouped.has(key)) grouped.get(key).push(path);
      else orphanPaths.push(path);
    }

    const techOut = technologies.map((t) => ({
      _id: String(t._id),
      name: t.name,
      slug: t.slug,
      category: t.category,
      paths: grouped.get(String(t._id)).map(summarize),
    }));
    // Published paths whose technology row is missing are surfaced (not dropped).
    if (orphanPaths.length > 0) {
      techOut.push({
        _id: null,
        name: "More",
        slug: "more",
        category: "general",
        paths: orphanPaths.map(summarize),
      });
    }

    const badges = (progress?.badges || []).map((b) => ({
      skillSlug: b.skillSlug,
      skillName: b.skillName,
      at: b.at,
      verifiableCode: certById.get(String(b.certificateId))?.verifiableCode || null,
    }));

    return res.status(200).json({
      success: true,
      data: {
        technologies: techOut,
        badges,
        xp: progress?.xp || 0,
        streakDays: progress?.streakDays || 0,
      },
    });
  } catch (error) {
    console.error("Learning catalog error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the learning catalog" });
  }
};

// ─────────────────────────────────────────────────────────────
// 2. POST /api/learning/paths/:pathId/enroll
// ─────────────────────────────────────────────────────────────

export const enrollInPath = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    const progress = await ensureProgress(uid);
    const existing = enrollmentFor(progress, pathId);
    if (existing) {
      // Idempotent: enrolling twice returns the current enrollment.
      return res.status(200).json({
        success: true,
        data: {
          enrollment: {
            pathId: String(existing.pathId),
            enrolledAt: existing.enrolledAt,
            percent: existing.percent || 0,
            completed: Boolean(existing.completedAt),
          },
        },
      });
    }

    const user = await User.findOne({ firebaseUid: uid });
    if (!isPro(user)) {
      const limit = freeActivePathLimit();
      const active = (progress.enrollments || []).filter((e) => !e.completedAt);
      if (active.length >= limit) {
        return fail(
          res,
          403,
          "FREE_PATH_LIMIT",
          `Free plan allows ${limit} active learning path at a time. Complete it, or DELETE /api/learning/paths/${pathId}/enroll to switch.`,
        );
      }
    }

    const enrollment = {
      pathId: path._id,
      enrolledAt: new Date(),
      completedLessonIds: [],
      percent: 0,
      completedAt: null,
    };
    await UserProgress.updateOne({ userId: uid }, { $push: { enrollments: enrollment } });

    return res.status(200).json({
      success: true,
      data: {
        enrollment: {
          pathId: String(path._id),
          enrolledAt: enrollment.enrolledAt,
          percent: 0,
          completed: false,
        },
      },
    });
  } catch (error) {
    console.error("Learning enroll error:", error);
    return res.status(500).json({ success: false, message: "Failed to enroll in the learning path" });
  }
};

// ─────────────────────────────────────────────────────────────
// 3. DELETE /api/learning/paths/:pathId/enroll — release the slot
// ─────────────────────────────────────────────────────────────

export const unenrollFromPath = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const progress = await ensureProgress(uid);
    const key = String(pathId);
    // Quiz attempts + badges are intentionally preserved — only the
    // enrollment (the active-path slot) is released.
    const remaining = (progress.enrollments || []).filter((e) => String(e.pathId) !== key);
    await UserProgress.updateOne({ userId: uid }, { $set: { enrollments: remaining } });

    return res.status(200).json({ success: true, data: { released: true } });
  } catch (error) {
    console.error("Learning unenroll error:", error);
    return res.status(500).json({ success: false, message: "Failed to leave the learning path" });
  }
};

// ─────────────────────────────────────────────────────────────
// 4. GET /api/learning/paths/:pathId — outline only (NO content, NO answers)
// ─────────────────────────────────────────────────────────────

export const getPathDetail = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    const [progress, vocab] = await Promise.all([ensureProgress(uid), loadSkillVocabulary()]);
    const enrollment = enrollmentFor(progress, path._id);
    const completedSet = new Set((enrollment?.completedLessonIds || []).map(String));
    const attempts = quizAttemptsFor(progress, path._id);

    let technologyName = null;
    if (path.technologyId) {
      const tech = await Technology.findById(path.technologyId);
      technologyName = tech?.name || null;
    }

    return res.status(200).json({
      success: true,
      data: {
        path: {
          _id: String(path._id),
          title: path.title,
          slug: path.slug,
          level: path.level,
          skillSlug: path.skillSlug,
          skillName: await skillNameForSlug(path.skillSlug, vocab),
          technologyName,
          estimatedHours: path.estimatedHours,
          modules: (path.modules || []).map((m) => ({
            _id: String(m._id),
            title: m.title,
            lessons: (m.lessons || []).map((l) => ({
              _id: String(l._id),
              title: l.title,
              durationMin: l.durationMin,
              completed: completedSet.has(String(l._id)),
            })),
          })),
          quiz: {
            questionCount: path.quiz?.questions?.length || 0,
            passingScore: path.quiz?.passingScore ?? 70,
            attempted: attempts.length,
            bestScore: attempts.length ? Math.max(...attempts.map((a) => a.score || 0)) : null,
            passed: attempts.some((a) => a.passed),
          },
          progressPercent: enrollment?.percent || 0,
          enrolled: Boolean(enrollment),
        },
      },
    });
  } catch (error) {
    console.error("Learning path detail error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the learning path" });
  }
};

// ─────────────────────────────────────────────────────────────
// 5. GET /api/learning/paths/:pathId/lessons/:lessonId
// ─────────────────────────────────────────────────────────────

export const getLesson = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId, lessonId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }
    const found = findLesson(path, lessonId);
    if (!found) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }

    const [progress, user] = await Promise.all([ensureProgress(uid), User.findOne({ firebaseUid: uid })]);
    const enrollment = enrollmentFor(progress, path._id);
    if (!enrollment) {
      return fail(res, 403, "NOT_ENROLLED", "Enroll in this learning path before opening its lessons.");
    }

    const pro = isPro(user);
    const completed = (enrollment.completedLessonIds || []).some((id) => String(id) === String(lessonId));
    const limit = freeDailyLessonLimit();

    if (!completed && !pro) {
      // Free tier: ONE daily view per fetch of a not-yet-completed lesson.
      let views = progress.dailyLessonViews;
      if (!views || views.date !== dayKey(new Date())) views = { date: dayKey(new Date()), count: 0 };
      if ((Number(views.count) || 0) >= limit) {
        return fail(
          res,
          403,
          "DAILY_LESSON_LIMIT",
          `You've used today's ${limit} free lesson view${limit === 1 ? "" : "s"}. Come back tomorrow, or upgrade to Pro for unlimited lessons.`,
        );
      }
      const next = { date: views.date, count: (Number(views.count) || 0) + 1 };
      await UserProgress.updateOne({ userId: uid }, { $set: { dailyLessonViews: next } });
      progress.dailyLessonViews = next;
    }

    return res.status(200).json({
      success: true,
      data: {
        lesson: {
          _id: String(found.lesson._id),
          title: found.lesson.title,
          content: found.lesson.content || { intro: "", sections: [], takeaways: [] },
          durationMin: found.lesson.durationMin,
        },
        entitlement: {
          // Free: views left today. Pro (unlimited): null.
          remainingToday: pro ? null : Math.max(0, limit - todayViewCount(progress)),
        },
      },
    });
  } catch (error) {
    console.error("Learning lesson error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the lesson" });
  }
};

// ─────────────────────────────────────────────────────────────
// 6. POST /api/learning/paths/:pathId/lessons/:lessonId/complete
// ─────────────────────────────────────────────────────────────

export const completeLesson = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId, lessonId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }
    if (!findLesson(path, lessonId)) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }

    const [progress, user] = await Promise.all([ensureProgress(uid), User.findOne({ firebaseUid: uid })]);
    const enrollment = enrollmentFor(progress, path._id);
    if (!enrollment) {
      return fail(res, 403, "NOT_ENROLLED", "Enroll in this learning path before marking lessons complete.");
    }

    const lessonIds = lessonIdsOf(path);
    const already = (enrollment.completedLessonIds || []).some((id) => String(id) === String(lessonId));

    // Dedupe + intersect with the path's actual lessons.
    const completedIds = new Set((enrollment.completedLessonIds || []).map(String));
    if (!already) completedIds.add(String(lessonId));
    const completedList = [...completedIds].filter((id) => lessonIds.has(id));
    const percent = totalLessonCount(path)
      ? Math.round((completedList.length / totalLessonCount(path)) * 100)
      : 0;

    const now = new Date();
    const completedAt = percent === 100 ? enrollment.completedAt || now : null;

    // Streak: same calendar day -> unchanged; yesterday -> +1; else reset to 1.
    const last = progress.lastActivityAt ? new Date(progress.lastActivityAt) : null;
    let streakDays = progress.streakDays || 0;
    if (!last || dayKey(last) !== dayKey(now)) {
      streakDays = last && dayKey(last) === yesterdayDayKey(now) ? streakDays + 1 : 1;
    }

    const xp = (progress.xp || 0) + (already ? 0 : XP_PER_LESSON);

    const nextEnrollments = (progress.enrollments || []).map((e) =>
      String(e.pathId) === String(path._id)
        ? { ...e, completedLessonIds: completedList.map((id) => id), percent, completedAt }
        : e,
    );
    await UserProgress.updateOne(
      { userId: uid },
      { $set: { enrollments: nextEnrollments, xp, streakDays, lastActivityAt: now } },
    );

    const pro = isPro(user);
    const limit = freeDailyLessonLimit();
    return res.status(200).json({
      success: true,
      data: {
        percent,
        xp,
        streakDays,
        remainingToday: pro ? null : Math.max(0, limit - todayViewCount(progress)),
      },
    });
  } catch (error) {
    console.error("Learning complete error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark the lesson complete" });
  }
};

// ─────────────────────────────────────────────────────────────
// 7. GET /api/learning/paths/:pathId/quiz — NEVER answers
// ─────────────────────────────────────────────────────────────

export const getQuiz = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    const progress = await ensureProgress(uid);
    const enrollment = enrollmentFor(progress, path._id);
    if (!enrollment || (enrollment.percent || 0) < QUIZ_UNLOCK_PERCENT) {
      return fail(
        res,
        403,
        "QUIZ_LOCKED",
        `Complete ${QUIZ_UNLOCK_PERCENT}% of the lessons in this path to unlock the quiz.`,
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        quiz: {
          // Whitelist projection — answerIndex / answerHash / explanation never leave.
          questions: (path.quiz?.questions || []).map((q) => ({
            _id: String(q._id),
            prompt: q.prompt,
            options: q.options,
          })),
          passingScore: path.quiz?.passingScore ?? 70,
        },
      },
    });
  } catch (error) {
    console.error("Learning quiz error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the quiz" });
  }
};

// ─────────────────────────────────────────────────────────────
// 8. POST /api/learning/paths/:pathId/quiz/submit
// ─────────────────────────────────────────────────────────────

async function computeJobsUserCanApplyTo(uid, canonicalSkill, vocab) {
  const [jobs, user] = await Promise.all([
    Job.find({ status: "approved" }).toArray(),
    User.findOne({ firebaseUid: uid }),
  ]);

  const matches = [];
  for (const job of jobs) {
    const required = normalizeJobSkills(job.skills || [], vocab);
    const preferred = normalizeJobSkills(
      job.niceToHaveSkills || (job.preferredSkills || []).map((p) => p?.name).filter(Boolean) || [],
      vocab,
    );
    const hitsSkill = [...required, ...preferred].some((s) => s.canonical === canonicalSkill);
    if (!hitsSkill) continue;

    const fit = await computeFitForDocs({ user, job, vocabulary: vocab });
    matches.push({
      _id: String(job._id),
      title: job.title,
      company: job.company || "",
      fitScore: Number(fit?.total) || 0,
    });
  }

  matches.sort((a, b) => b.fitScore - a.fitScore);
  return matches.filter((m) => m.fitScore >= MIN_JOB_FIT).slice(0, MAX_JOB_CARDS);
}

export const submitQuiz = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;
    const { answers } = req.body;

    const path = await LearningPath.findById(pathId);
    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }
    const questions = path.quiz?.questions || [];
    if (questions.length === 0) {
      return res.status(404).json({ success: false, message: "This quiz is not available yet" });
    }

    const progress = await ensureProgress(uid);
    const enrollment = enrollmentFor(progress, path._id);
    if (!enrollment || (enrollment.percent || 0) < QUIZ_UNLOCK_PERCENT) {
      return fail(
        res,
        403,
        "QUIZ_LOCKED",
        `Complete ${QUIZ_UNLOCK_PERCENT}% of the lessons in this path to unlock the quiz.`,
      );
    }

    // Server-side grading against salted hashes (answers never leave the server).
    const salt = path.quiz?.salt || "";
    const choiceByQuestion = new Map(answers.map((a) => [String(a.questionId), a.choice]));
    let correct = 0;
    for (const q of questions) {
      const choice = choiceByQuestion.get(String(q._id));
      if (Number.isInteger(choice) && q.answerHash && hashExpectedAnswer(choice, salt) === q.answerHash) {
        correct += 1;
      }
    }
    const passingScore = path.quiz?.passingScore ?? 70;
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= passingScore;

    const priorAttempts = quizAttemptsFor(progress, path._id);
    const alreadyPassed = priorAttempts.some((a) => a.passed);
    const firstPass = passed && !alreadyPassed;

    const now = new Date();
    await UserProgress.updateOne(
      { userId: uid },
      { $push: { quizAttempts: { pathId: path._id, score, passed, at: now } } },
    );

    let badge = null;
    let newlyVerifiedSkills = [];
    let jobsYouCanNowApplyTo = [];

    if (firstPass) {
      const vocab = await loadSkillVocabulary();
      const skillName = await skillNameForSlug(path.skillSlug, vocab);
      const canonicalSkill = canonicalForSlug(path.skillSlug, vocab);

      // 1. Certificate (first pass only — re-passes never duplicate).
      const verifiableCode = generateVerifiableCode();
      const cert = await Certificate.create({
        userId: uid,
        skillSlug: path.skillSlug,
        skillName,
        pathId: path._id,
        verifiableCode,
        score,
        issuedAt: now,
      });

      // 2. Badge on UserProgress.
      await UserProgress.updateOne(
        { userId: uid },
        { $push: { badges: { skillSlug: path.skillSlug, skillName, pathId: path._id, certificateId: cert._id, at: now } } },
      );
      badge = { verifiableCode, skillSlug: path.skillSlug, skillName, issuedAt: now };

      // 3. Upsert the verified skill into the candidate profile
      //    (provenance: { name, source: "learning", verified: true }).
      try {
        const user = await User.findOne({ firebaseUid: uid });
        const existing = normalizeCandidateSkills(
          user?.skills || [],
          { verifiedSkills: user?.verifiedSkills || [] },
          vocab,
        ).some((s) => s.canonical === canonicalSkill);

        const updates = { $addToSet: { verifiedSkills: skillName } };
        if (!existing) {
          updates.$push = { skills: { name: skillName, source: "learning", verified: true } };
        }
        await User.updateOne({ firebaseUid: uid }, updates);
        newlyVerifiedSkills = [skillName];
      } catch (err) {
        console.error("Learning: profile skill upsert failed (non-fatal):", err?.message || err);
      }

      // 4. Jobs this newly-verified skill unlocks (best-effort).
      try {
        jobsYouCanNowApplyTo = await computeJobsUserCanApplyTo(uid, canonicalSkill, vocab);
      } catch (err) {
        console.error("Learning: jobs-you-can-apply-to failed (non-fatal):", err?.message || err);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        passed,
        score,
        attempts: priorAttempts.length + 1,
        badge, // null unless FIRST pass
        newlyVerifiedSkills,
        jobsYouCanNowApplyTo,
      },
    });
  } catch (error) {
    console.error("Learning quiz submit error:", error);
    return res.status(500).json({ success: false, message: "Failed to grade the quiz" });
  }
};

// ─────────────────────────────────────────────────────────────
// 9. GET /api/learning/progress
// ─────────────────────────────────────────────────────────────

export const getProgress = async (req, res) => {
  try {
    const uid = req.user.uid;
    const progress = await ensureProgress(uid);

    const enrollments = [];
    for (const e of progress.enrollments || []) {
      const path = await LearningPath.findById(e.pathId);
      enrollments.push({
        pathId: String(e.pathId),
        title: path?.title || null,
        slug: path?.slug || null,
        percent: e.percent || 0,
        completed: Boolean(e.completedAt),
        enrolledAt: e.enrolledAt,
      });
    }

    const certificates = await Certificate.find({ userId: uid }).toArray();
    const certById = new Map(certificates.map((c) => [String(c._id), c]));
    const badges = (progress.badges || []).map((b) => ({
      skillSlug: b.skillSlug,
      skillName: b.skillName,
      at: b.at,
      verifiableCode: certById.get(String(b.certificateId))?.verifiableCode || null,
    }));

    const quizAttempts = [...(progress.quizAttempts || [])]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 10)
      .map((a) => ({ pathId: String(a.pathId), score: a.score, passed: a.passed, at: a.at }));

    return res.status(200).json({
      success: true,
      data: {
        enrollments,
        badges,
        xp: progress.xp || 0,
        streakDays: progress.streakDays || 0,
        quizAttempts,
      },
    });
  } catch (error) {
    console.error("Learning progress error:", error);
    return res.status(500).json({ success: false, message: "Failed to load your learning progress" });
  }
};

// ─────────────────────────────────────────────────────────────
// 10. POST /api/learning/match-paths — gap -> path CTA
// ─────────────────────────────────────────────────────────────

export const matchPaths = async (req, res) => {
  try {
    const { skills } = req.body;
    const vocab = await loadSkillVocabulary();

    const seen = new Set();
    const matches = [];
    for (const raw of skills) {
      const canonical = canonicalizeSkill(raw, vocab) || normalizeKey(raw);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);

      const slug = slugForCanonical(canonical, vocab);
      const path = await LearningPath.findOne({ skillSlug: slug, status: "published" });
      if (path) {
        matches.push({
          skill: raw,
          pathId: String(path._id),
          title: path.title,
          slug: path.slug,
          level: path.level,
          hours: path.estimatedHours,
        });
      }
    }

    return res.status(200).json({ success: true, data: { matches } });
  } catch (error) {
    console.error("Learning match-paths error:", error);
    return res.status(500).json({ success: false, message: "Failed to match skill gaps to learning paths" });
  }
};
