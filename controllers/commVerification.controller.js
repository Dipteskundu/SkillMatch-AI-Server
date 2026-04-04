// controllers/commVerification.controller.js
// Global (one-time) communication verification for candidates.
// Unlike the per-job communication.controller.js, this creates a global
// isCommunicationVerified flag on the candidate's user document.

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { generateQuestions, evaluateAnswers } from "../services/gemini.service.js";

const COMM_VER_COLLECTION = "communication_verifications";
const PASS_THRESHOLD = 60; // minimum score to pass

/**
 * POST /api/verification/communication/start
 * Starts a new global communication verification session.
 * Body: { candidateId: string }
 */
async function startCommVerification(req, res) {
  try {
    const db = getDB();
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ success: false, message: "candidateId is required" });
    }

    // Check cooldown
    const candidate = await db.collection("users").findOne({ firebaseUid: candidateId });
    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    if (candidate.nextCommunicationRetryAt) {
      const nextTime = new Date(candidate.nextCommunicationRetryAt);
      if (nextTime > new Date()) {
        const diffMin = Math.ceil((nextTime - new Date()) / 60000);
        return res.status(400).json({
          success: false,
          cooldown: true,
          message: `You can retake the communication test in ${diffMin} minutes.`,
          nextRetryAt: candidate.nextCommunicationRetryAt,
        });
      }
    }

    // Already verified
    if (candidate.isCommunicationVerified) {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        message: "You are already communication verified.",
      });
    }

    // Check for in-progress session
    const inProgress = await db.collection(COMM_VER_COLLECTION).findOne({
      candidateId,
      status: "in_progress",
    });

    if (inProgress) {
      return res.status(200).json({
        success: true,
        sessionId: inProgress._id.toString(),
        questions: inProgress.questions,
        timeLimit: 12,
      });
    }

    // Generate communication questions via Gemini
    const { questions, timeLimit } = await generateQuestions("Software Developer", "JobMatch AI");

    const doc = {
      candidateId,
      questions,
      answers: [],
      score: null,
      feedback: null,
      status: "in_progress",
      createdAt: new Date(),
      completedAt: null,
    };

    const result = await db.collection(COMM_VER_COLLECTION).insertOne(doc);

    res.status(201).json({
      success: true,
      sessionId: result.insertedId.toString(),
      questions,
      timeLimit,
    });
  } catch (error) {
    console.error("Start Comm Verification Error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * POST /api/verification/communication/submit
 * Submits answers, evaluates, and updates isCommunicationVerified on user.
 * Body: { sessionId: string, answers: Array<{questionId, answer}> }
 */
async function submitCommVerification(req, res) {
  try {
    const db = getDB();
    const { sessionId, answers } = req.body;

    if (!sessionId || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: "sessionId and answers array are required" });
    }

    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid sessionId" });
    }

    const session = await db.collection(COMM_VER_COLLECTION).findOne({ _id: new ObjectId(sessionId) });

    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    if (session.status === "completed") {
      return res.status(400).json({ success: false, message: "Test already submitted" });
    }

    // Evaluate via Gemini
    const scores = await evaluateAnswers(session.questions, answers);
    const passed = scores.communicationScore >= PASS_THRESHOLD;
    const now = new Date();

    // Update session record
    await db.collection(COMM_VER_COLLECTION).updateOne(
      { _id: new ObjectId(sessionId) },
      {
        $set: {
          answers,
          score: scores.communicationScore,
          clarityScore: scores.clarityScore,
          toneScore: scores.toneScore,
          grammarScore: scores.grammarScore,
          structureScore: scores.structureScore,
          feedback: scores.feedback,
          result: passed ? "pass" : "fail",
          status: "completed",
          completedAt: now,
        },
      }
    );

    // Update user record
    let userUpdate = { lastCommunicationTestAt: now };
    if (passed) {
      userUpdate.isCommunicationVerified = true;
    } else {
      // 2-hour cooldown on fail
      userUpdate.nextCommunicationRetryAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    }

    await db.collection("users").updateOne(
      { firebaseUid: session.candidateId },
      { $set: userUpdate }
    );

    res.status(200).json({
      success: true,
      result: passed ? "pass" : "fail",
      score: scores.communicationScore,
      feedback: scores.feedback,
      isCommunicationVerified: passed,
    });
  } catch (error) {
    console.error("Submit Comm Verification Error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * GET /api/verification/communication/status/:uid
 * Returns current communication verification status for candidate.
 */
async function getCommVerificationStatus(req, res) {
  try {
    const db = getDB();
    const { uid } = req.params;

    const candidate = await db.collection("users").findOne({ firebaseUid: uid });
    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        isCommunicationVerified: candidate.isCommunicationVerified || false,
        nextCommunicationRetryAt: candidate.nextCommunicationRetryAt || null,
      },
    });
  } catch (error) {
    console.error("Comm Verification Status Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export {
  startCommVerification,
  submitCommVerification,
  getCommVerificationStatus,
};
