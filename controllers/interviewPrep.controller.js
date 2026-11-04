// controllers/interviewPrep.controller.js
import {
  startPrepSession,
  submitAnswers,
  listSessions,
  getSession,
} from "../services/interviewPrep.service.js";

const uid = (req) => {
  const id = req.user?.uid;
  if (!id) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return id;
};

// POST /api/interview-prep/start
export const startPrep = async (req, res) => {
  try {
    const { targetRole, skills, company, difficulty } = req.body || {};
    const result = await startPrepSession(uid(req), { targetRole, skills, company, difficulty });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// POST /api/interview-prep/:sessionId/submit
export const submitPrep = async (req, res) => {
  try {
    const answers = req.body?.answers;
    const result = await submitAnswers(uid(req), req.params.sessionId, answers);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// GET /api/interview-prep/sessions
export const getPrepSessions = async (req, res) => {
  try {
    const sessions = await listSessions(uid(req));
    res.status(200).json({ success: true, sessions, count: sessions.length });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// GET /api/interview-prep/:sessionId
export const getPrepSession = async (req, res) => {
  try {
    const session = await getSession(uid(req), req.params.sessionId);
    res.status(200).json({ success: true, session });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
