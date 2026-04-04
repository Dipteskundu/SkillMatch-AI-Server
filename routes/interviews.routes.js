// routes/interviews.routes.js
// Handles interview-related API routes

import express from "express";
import {
  scheduleInterview,
  getRecruiterInterviews,
  updateInterviewStatus,
  getCandidateInterviews,
  getInterviewById,
  updateInterview,
  cancelInterview,
  completeInterview,
  startInterview
} from "../controllers/interviews.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { requireRecruiter } from "../middleware/recruiterGate.js";

const router = express.Router();

// Test endpoint to verify routes are working
router.get("/api/interviews/test", (req, res) => {
  res.json({ success: true, message: "Interviews routes are working!" });
});

// All interview APIs require auth
router.use("/api/interviews", verifyToken);

// POST: Schedule New Interview (pipeline)
router.post("/api/interviews/schedule", requireRecruiter, scheduleInterview);

// Legacy alias (kept for frontend compatibility)
router.post("/api/interviews", requireRecruiter, scheduleInterview);

// GET: Recruiter Interviews (secure)
router.get("/api/interviews/recruiter", requireRecruiter, getRecruiterInterviews);

// Legacy recruiter list route (requires uid match)
router.get("/api/interviews/recruiter/:uid", requireRecruiter, getRecruiterInterviews);

// GET: Candidate Interviews (secure)
router.get("/api/interviews/candidate", getCandidateInterviews);

// Legacy candidate list route (requires uid match)
router.get("/api/interviews/candidate/:uid", getCandidateInterviews);

// GET: Get Single Interview by ID
router.get("/api/interviews/:id", getInterviewById);

// PUT: Update Interview Status (legacy)
router.put("/api/interviews/:id/status", requireRecruiter, updateInterviewStatus);

// PATCH: Update/Reschedule Interview details (legacy)
router.patch("/api/interviews/:id", requireRecruiter, updateInterview);

// Production-ready status endpoints
router.patch("/api/interviews/:id/cancel", requireRecruiter, cancelInterview);
router.patch("/api/interviews/:id/complete", requireRecruiter, completeInterview);
router.patch("/api/interviews/:id/start", requireRecruiter, startInterview);

export default router;
