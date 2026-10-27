// controllers/copilotController.js
// Thin HTTP layer for the recruiter copilot (recommendation-only drafts —
// nothing here ever sends or publishes anything).
import { pipelineSummary, outreachDraft, interviewQuestions } from "../services/copilotService.js";

/** Map service errors that carry `.status` to their HTTP response. */
function respondError(res, error, label) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(label, error);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? "Server error while generating the copilot response." : error.message,
  });
}

/** The body uid must match the token uid (admins may act on behalf of others). */
function uidMatchesCaller(req, uid) {
  return req.user?.role === "admin" || req.user?.uid === uid;
}

// POST /api/copilot/pipeline-summary → { success, data: { summary, insights } }
export const handlePipelineSummary = async (req, res) => {
  try {
    const { uid, jobId } = req.body;
    if (!uidMatchesCaller(req, uid)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Request uid does not match the authenticated user.",
      });
    }
    const data = await pipelineSummary(uid, jobId ? { jobId } : {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(res, error, "Copilot pipeline summary error:");
  }
};

// POST /api/copilot/outreach-draft → { success, data: { subject, body } }
export const handleOutreachDraft = async (req, res) => {
  try {
    const { uid, applicationId, tone } = req.body;
    if (!uidMatchesCaller(req, uid)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Request uid does not match the authenticated user.",
      });
    }
    const data = await outreachDraft(uid, applicationId, tone || "professional");
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(res, error, "Copilot outreach draft error:");
  }
};

// POST /api/copilot/interview-questions → { success, data: { questions } }
export const handleInterviewQuestions = async (req, res) => {
  try {
    const { uid, jobId, applicationId } = req.body;
    if (!uidMatchesCaller(req, uid)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Request uid does not match the authenticated user.",
      });
    }
    const data = await interviewQuestions(uid, jobId, applicationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(res, error, "Copilot interview questions error:");
  }
};
