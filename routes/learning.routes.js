// routes/learning.routes.js
// Learning Hub routes (spec v1.2). Mounted in api/index.js.

import express from "express";
import { rateLimit } from "express-rate-limit";
import { verifyToken, optionalVerifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";
import {
  listPaths, getPathById,
  getLessonById, askLessonQuestion, updateProgress,
  createPath, updatePath, deletePath,
  listModules, createModule, updateModule, deleteModule,
  listLessons, createLesson, updateLesson, deleteLesson,
} from "../controllers/learningController.js";
import {
  enrollInPath,
  generatePlan,
  listMyPlans,
  updatePlan,
  regeneratePlan,
} from "../controllers/learningPlanController.js";
import {
  startAssessment,
  submitAttempt,
  getAttemptResults,
  listAssessments,
  listAssessmentsSummary,
} from "../controllers/learningAssessmentController.js";
import {
  getAdaptiveRecommendationsCtrl,
  getCertificateCtrl,
} from "../controllers/learningPlanController.js";
import {
  getAdaptiveRecommendations,
  getCertificateInfo,
  normalizePlan,
  buildPlanPrompt,
  recommendDiagnostic,
  buildWeeklySchedule,
} from "../services/learningPlan.service.js";

const router = express.Router();

const rateMessage = {
  success: false,
  message: "Too many requests. Please try again shortly.",
};

// Public catalog reads: generous limit, but still bounded so the
// catalog cannot be scraped into oblivion.
const catalogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateMessage,
});

// AI generation: strict, because every hit is a paid model call.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Plan generation is temporarily rate limited. Please wait a few minutes.",
  },
});

// Attempt lifecycle: bounded, though not AI-priced.
const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateMessage,
});

// ── Public catalog (guests get previews; enrollment unlocks content) ──
router.get("/api/v1/learning/paths", catalogLimiter, listPaths);
router.get(
  "/api/v1/learning/paths/:id",
  catalogLimiter,
  optionalVerifyToken,
  getPathById,
);

// ── Plans (LH-005 / LH-006 / LH-008 / LH-009) ────────────────────
router.post("/api/v1/learning/enrollments", verifyToken, enrollInPath);
router.post("/api/v1/learning/plans/generate", verifyToken, aiLimiter, generatePlan);
router.get("/api/v1/learning/my-plans", verifyToken, listMyPlans);
router.patch("/api/v1/learning/plans/:id", verifyToken, updatePlan);
router.post(
  "/api/v1/learning/plans/:id/regenerate",
  verifyToken,
  aiLimiter,
  regeneratePlan,
);

// ── Practice assessments (LH-007, diagnostic only in Phase 2) ─────
router.post("/api/v1/learning/assessments/:id/start", verifyToken, attemptLimiter, startAssessment);
router.post("/api/v1/learning/attempts/:id/submit", verifyToken, attemptLimiter, submitAttempt);
router.get("/api/v1/learning/attempts/:id/results", verifyToken, getAttemptResults);

// ── Lessons (Phase 3: LH-010/011/018) ──────────────────────────────
// Full lesson content requires auth + enrollment; guests see preview only.
router.get(
  "/api/v1/learning/lessons/:id",
  catalogLimiter,
  optionalVerifyToken,
  getLessonById,
);

// AI mentoring on a lesson — rate-limited per user (10/15min).
router.post(
  "/api/v1/learning/lessons/:id/ask",
  verifyToken,
  aiLimiter,
  askLessonQuestion,
);

// Progress tracking — resumable, owner-scoped.
router.patch("/api/v1/learning/progress", verifyToken, updateProgress);

// Adaptive recommendations after lesson (LH-023) — topic-focused suggestions
// for the next lesson or job-gap roles. Pure function on the server,
router.get("/api/v1/learning/recommendations", verifyToken, getAdaptiveRecommendationsCtrl);

// Certificate eligibility on path completion (LH-027)
router.get("/api/v1/learning/certificate", verifyToken, getCertificateCtrl);

// ── Assessments (Phase 4: LH-012 → LH-017, LH-021) ──────────────────
// Phase 2 diagnostic reuses this engine (type: "diagnostic");
// Phase 4 ships full assessment engine with randomization + time limits.
router.get("/api/v1/assessments", catalogLimiter, listAssessments);

// Start an assessment attempt — questions serialized WITHOUT answers.
// Rate-limited, owner-scoped, resumable on refresh (LH-012).
router.post(
  "/api/v1/assessments/:id/start",
  verifyToken,
  attemptLimiter,
  startAssessment,
);

// Server-side MCQ grading — 409 on double-submit (LH-012).
// Never touches skill_tests / assessment_results (LH-021).
router.post(
  "/api/v1/attempts/:id/submit",
  verifyToken,
  attemptLimiter,
  submitAttempt,
);

// Owner-only. Explanations released after grading — that is the point
// of viewing results. LH-012.
router.get("/api/v1/attempts/:id/results", verifyToken, getAttemptResults);

// Summary of user's assessment history (LH-017).
router.get("/api/v1/assessments/summary", verifyToken, listAssessmentsSummary);

// ── Admin (LH-022) ─────────────────────────────────────────────────
// Protected by requireAdmin — only users with role "admin" can access.
// These endpoints support full content management: publish/unpublish,
// CRUD for paths/modules/lessons, and a review-before-bank flow for
// question banks.  Rate‑limited less aggressively than AI endpoints
// because the operations are administrative, not per‑call model calls.
const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Admin API rate limited. Please try again later.",
  },
});

router.get("/api/v1/admin/learning/paths", [verifyToken, requireAdmin, adminLimiter], listPaths);
router.get(
  "/api/v1/admin/learning/paths/:id",
  [verifyToken, requireAdmin, adminLimiter],
  getPathById,
);
router.post("/api/v1/admin/learning/paths", [verifyToken, requireAdmin, adminLimiter], createPath);
router.patch("/api/v1/admin/learning/paths/:id", [verifyToken, requireAdmin, adminLimiter], updatePath);
router.delete("/api/v1/admin/learning/paths/:id", [verifyToken, requireAdmin, adminLimiter], deletePath);

router.get("/api/v1/admin/learning/modules", [verifyToken, requireAdmin, adminLimiter], listModules);
router.post("/api/v1/admin/learning/modules", [verifyToken, requireAdmin, adminLimiter], createModule);
router.patch("/api/v1/admin/learning/modules/:id", [verifyToken, requireAdmin, adminLimiter], updateModule);
router.delete("/api/v1/admin/learning/modules/:id", [verifyToken, requireAdmin, adminLimiter], deleteModule);

router.get("/api/v1/admin/learning/lessons", [verifyToken, requireAdmin, adminLimiter], listLessons);
router.post("/api/v1/admin/learning/lessons", [verifyToken, requireAdmin, adminLimiter], createLesson);
router.patch("/api/v1/admin/learning/lessons/:id", [verifyToken, requireAdmin, adminLimiter], updateLesson);
router.delete("/api/v1/admin/learning/lessons/:id", [verifyToken, requireAdmin, adminLimiter], deleteLesson);

router.get("/api/v1/admin/learning/assessments", [verifyToken, requireAdmin, adminLimiter], listAssessments);
router.get("/api/v1/admin/learning/assessments/summary", [verifyToken, requireAdmin, adminLimiter], listAssessmentsSummary);

export default router;
