// routes/interviewPrep.routes.js
import express from "express";
import {
  startPrep,
  submitPrep,
  getPrepSessions,
  getPrepSession,
} from "../controllers/interviewPrep.controller.js";

const router = express.Router();

// app.use("/api", router) — JWT is enforced by the global /api middleware.
router.post("/api/interview-prep/start", startPrep);
router.post("/api/interview-prep/:sessionId/submit", submitPrep);
router.get("/api/interview-prep/sessions", getPrepSessions);
router.get("/api/interview-prep/:sessionId", getPrepSession);

export default router;
