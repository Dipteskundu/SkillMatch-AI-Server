// controllers/communication.controller.js

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { generateQuestions, evaluateAnswers } from "../services/gemini.service.js";
import { STATUS, COLLECTION } from "../models/communicationTest.model.js";
import { scheduleCandidateAiScoreRecompute } from "../services/fitScoreService.js";

/**
 * POST /api/communication/start
 * Start a new communication test session
 */
async function startTest(req, res) {
  try {
    const db = getDB();
    const { candidateId, jobId, jobTitle, company } = req.body;

    if (!candidateId || !jobId) {
      return res.status(400).json({
        success: false,
        message: "candidateId and jobId are required",
      });
    }

    if (!ObjectId.isValid(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid jobId format",
      });
    }

    const collection = db.collection(COLLECTION);

    // One attempt per job per candidate
    const existing = await collection.findOne({
      candidateId,
      jobId: new ObjectId(jobId),
      status: STATUS.COMPLETED,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already completed the communication test for this job",
        sessionId: existing._id.toString(),
      });
    }

    // Check for in-progress session
    const inProgress = await collection.findOne({
      candidateId,
      jobId: new ObjectId(jobId),
      status: STATUS.IN_PROGRESS,
    });

    if (inProgress) {
      return res.status(200).json({
        success: true,
        sessionId: inProgress._id.toString(),
        questions: inProgress.questions,
        timeLimit: 10,
      });
    }

    // Generate questions via Gemini
    const { questions, timeLimit } = await generateQuestions(
      jobTitle || "Professional",
      company || "Company"
    );

    const doc = {
      candidateId,
      jobId: new ObjectId(jobId),
      questions,
      answers: [],
      score: null,
      feedback: null,
      status: STATUS.IN_PROGRESS,
      createdAt: new Date(),
      completedAt: null,
    };

    const result = await collection.insertOne(doc);

    res.status(201).json({
      success: true,
      sessionId: result.insertedId.toString(),
      questions,
      timeLimit,
    });
  } catch (error) {
    console.error("Start Communication Test Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error while starting test",
    });
  }
}

/**
 * POST /api/communication/submit
 * Submit answers and get evaluation
 */
async function submitTest(req, res) {
  try {
    const db = getDB();
    const { sessionId, answers } = req.body;

    if (!sessionId || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "sessionId and answers array are required",
      });
    }

    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sessionId format",
      });
    }

    const collection = db.collection(COLLECTION);

    const session = await collection.findOne({
      _id: new ObjectId(sessionId),
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Test session not found",
      });
    }

    if (session.status === STATUS.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: "Test already submitted",
        score: session.score,
        feedback: session.feedback,
      });
    }

    // Evaluate via Gemini
    const scores = await evaluateAnswers(session.questions, answers);

    const now = new Date();

    await collection.updateOne(
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
          status: STATUS.COMPLETED,
          completedAt: now,
        },
      }
    );

    // Update application with communication score
    const applications = db.collection("applications");
    await applications.updateOne(
      {
        jobId: session.jobId,
        firebaseUid: session.candidateId,
      },
      {
        $set: {
          communicationScore: scores.communicationScore,
          communicationStatus: "completed",
          communicationFeedback: scores.feedback,
          updatedAt: now,
        },
      }
    );

    // A new communication score feeds the assessment component of the Hiring
    // Fit Score — refresh aiScore on the candidate's open applications
    // (best-effort, fire-and-forget).
    scheduleCandidateAiScoreRecompute(session.candidateId);

    res.status(200).json({
      success: true,
      score: scores.communicationScore,
      clarityScore: scores.clarityScore,
      toneScore: scores.toneScore,
      grammarScore: scores.grammarScore,
      structureScore: scores.structureScore,
      feedback: scores.feedback,
    });
  } catch (error) {
    console.error("Submit Communication Test Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error while submitting test",
    });
  }
}

/**
 * GET /api/communication/result/:sessionId
 * Get test result by session ID
 */
async function getResult(req, res) {
  try {
    const db = getDB();
    const { sessionId } = req.params;

    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sessionId format",
      });
    }

    const session = await db.collection(COLLECTION).findOne({
      _id: new ObjectId(sessionId),
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Test session not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        sessionId: session._id.toString(),
        score: session.score,
        clarityScore: session.clarityScore,
        toneScore: session.toneScore,
        grammarScore: session.grammarScore,
        structureScore: session.structureScore,
        feedback: session.feedback,
        status: session.status,
        completedAt: session.completedAt,
      },
    });
  } catch (error) {
    console.error("Get Result Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching result",
    });
  }
}

/**
 * GET /api/communication/session/:sessionId
 * Get session with questions (for in-progress test)
 */
async function getSession(req, res) {
  try {
    const db = getDB();
    const { sessionId } = req.params;

    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sessionId format",
      });
    }

    const session = await db.collection(COLLECTION).findOne({
      _id: new ObjectId(sessionId),
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    if (session.status === STATUS.COMPLETED) {
      return res.status(200).json({
        success: true,
        status: "completed",
        redirectToResult: true,
      });
    }

    res.status(200).json({
      success: true,
      sessionId: session._id.toString(),
      questions: session.questions,
      timeLimit: 10,
      status: session.status,
    });
  } catch (error) {
    console.error("Get Session Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

export { startTest, submitTest, getResult, getSession };
