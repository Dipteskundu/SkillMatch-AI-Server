// routes/copilot.routes.js
// Recruiter copilot (PLAN §4.7) — all recommendation-only drafts.
// Same auth pattern as routes/chatbot.routes.js (verifyToken), plus the
// existing requireRecruiter gate and Zod body validation. Rate limiting comes
// from the shared aiLimiter path list in api/index.js.
import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireRecruiter } from "../middleware/recruiterGate.js";
import { validate } from "../middleware/validate.js";
import {
  interviewQuestionsBody,
  outreachDraftBody,
  pipelineSummaryBody,
} from "../lib/schemas.js";
import {
  handleInterviewQuestions,
  handleOutreachDraft,
  handlePipelineSummary,
} from "../controllers/copilotController.js";

const router = express.Router();

router.post(
  "/api/copilot/pipeline-summary",
  verifyToken,
  requireRecruiter,
  validate(pipelineSummaryBody),
  handlePipelineSummary,
);

router.post(
  "/api/copilot/outreach-draft",
  verifyToken,
  requireRecruiter,
  validate(outreachDraftBody),
  handleOutreachDraft,
);

router.post(
  "/api/copilot/interview-questions",
  verifyToken,
  requireRecruiter,
  validate(interviewQuestionsBody),
  handleInterviewQuestions,
);

export default router;
