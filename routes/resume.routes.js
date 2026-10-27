// routes/resume.routes.js

import express from "express";
import multer from "multer";
import { uploadResume, getResumeStatus } from "../controllers/resumeController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/resume/upload
// Expects multipart/form-data with a file field named 'resume' and a text field 'candidateId'
// Async by default (responds { resumeId, extractionStatus: "queued" });
// pass ?sync=true or the X-Sync-Resume: 1 header for the legacy inline flow.
router.post("/api/resume/upload", upload.single("resume"), uploadResume);

// GET /api/resume/status/:uid
// Latest resume doc for a candidate + whether its extraction job is active.
router.get("/api/resume/status/:uid", getResumeStatus);

export default router;
