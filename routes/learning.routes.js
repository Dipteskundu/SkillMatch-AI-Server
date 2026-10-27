// routes/learning.routes.js
// SkillForge Learning Hub (Phase 4) — learner API (candidate role).

import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireCandidate } from "../middleware/recruiterGate.js";
import { validate } from "../middleware/validate.js";
import {
  learningPathParams,
  lessonParams,
  quizSubmitBody,
  matchPathsBody,
} from "../lib/learningSchemas.js";
import {
  getCatalog,
  enrollInPath,
  unenrollFromPath,
  getPathDetail,
  getLesson,
  completeLesson,
  getQuiz,
  submitQuiz,
  getProgress,
  matchPaths,
} from "../controllers/learningController.js";

const router = express.Router();

router.get("/api/learning/catalog", verifyToken, requireCandidate, getCatalog);
router.get("/api/learning/progress", verifyToken, requireCandidate, getProgress);
router.post("/api/learning/match-paths", verifyToken, requireCandidate, validate(matchPathsBody), matchPaths);

router.post("/api/learning/paths/:pathId/enroll", verifyToken, requireCandidate, validate(learningPathParams, "params"), enrollInPath);
router.delete("/api/learning/paths/:pathId/enroll", verifyToken, requireCandidate, validate(learningPathParams, "params"), unenrollFromPath);
router.get("/api/learning/paths/:pathId", verifyToken, requireCandidate, validate(learningPathParams, "params"), getPathDetail);
router.get("/api/learning/paths/:pathId/lessons/:lessonId", verifyToken, requireCandidate, validate(lessonParams, "params"), getLesson);
router.post("/api/learning/paths/:pathId/lessons/:lessonId/complete", verifyToken, requireCandidate, validate(lessonParams, "params"), completeLesson);
router.get("/api/learning/paths/:pathId/quiz", verifyToken, requireCandidate, validate(learningPathParams, "params"), getQuiz);
router.post("/api/learning/paths/:pathId/quiz/submit", verifyToken, requireCandidate, validate(learningPathParams, "params"), validate(quizSubmitBody), submitQuiz);

export default router;
