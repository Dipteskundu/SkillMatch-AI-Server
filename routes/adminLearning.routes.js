// routes/adminLearning.routes.js
// SkillForge Learning Hub (Phase 4) — admin content pipeline.
// Auth-gated (verifyToken + role admin) even though older admin routes aren't.

import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";
import { validate } from "../middleware/validate.js";
import {
  learningOutlineBody,
  lessonEditBody,
  pathPublishBody,
  learningPathParams,
  lessonParams,
} from "../lib/learningSchemas.js";
import {
  createOutline,
  getReviewQueue,
  generatePathContent,
  editLesson,
  publishPath,
  archivePath,
  listPaths,
} from "../controllers/adminLearningController.js";

const router = express.Router();

router.post("/api/admin/learning/outlines", verifyToken, requireAdmin, validate(learningOutlineBody), createOutline);
router.get("/api/admin/learning/review-queue", verifyToken, requireAdmin, getReviewQueue);
router.get("/api/admin/learning/paths", verifyToken, requireAdmin, listPaths);
router.post("/api/admin/learning/paths/:pathId/generate", verifyToken, requireAdmin, validate(learningPathParams, "params"), generatePathContent);
router.put("/api/admin/learning/paths/:pathId/lessons/:lessonId", verifyToken, requireAdmin, validate(lessonParams, "params"), validate(lessonEditBody), editLesson);
router.post("/api/admin/learning/paths/:pathId/publish", verifyToken, requireAdmin, validate(learningPathParams, "params"), validate(pathPublishBody), publishPath);
router.post("/api/admin/learning/paths/:pathId/archive", verifyToken, requireAdmin, validate(learningPathParams, "params"), archivePath);

export default router;
