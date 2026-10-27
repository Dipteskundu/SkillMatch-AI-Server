// controllers/skillTestController.js
// Skill-test generate/submit flow (Phase 2 redesign).
//
// Security model (the answer key never leaves the server):
//  • Each question is stored as { ..., answerHash } where answerHash is a
//    salted SHA-256 of the correct option's 0-based index AFTER a per-attempt
//    server-side shuffle. The API-safe projection returns shuffled options
//    only — no correctAnswer / answerHash / salt is ever serialized.
//  • Submissions accept either the option text or its index; both are
//    resolved to an index against the shuffled options and graded via hash,
//    so "the answer is always B" hardcoding cannot work.
//  • The 10-minute limit is enforced server-side (30s grace) using startedAt
//    stamped at generate; the client countdown uses the returned expiresAt.
//  • Anti-replay: the result field is claimed atomically
//    (updateOne filter { result: "pending" }), so a second submit — even a
//    racing one — is rejected with 400.
//  • Every attempt writes an assessment_results document (score, per-skill
//    breakdown, durationSec, attempt) for completion/timeout analytics.
//
// Kept from the previous flow: pass threshold 60, verifiedSkills /
// isSkillVerified writes, 2h fail cooldown, Zod validation + rate limiting.

import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { getDB } from "../config/db.js";
import { generateSkillQuestions } from "../services/aiQuestionService.js";
import skillEvaluationService, {
  PASS_THRESHOLD,
  hashExpectedAnswer,
  shuffleOptions,
} from "../services/skillEvaluationService.js";
import { scheduleCandidateAiScoreRecompute } from "../services/fitScoreService.js";

const TIME_LIMIT_MINUTES = 10; // ≤ 10 minutes (Phase 2 research target)
const GRACE_SECONDS = 30; // clock/network slack before a submit is rejected
const FAIL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h retry cooldown after a fail

/**
 * Persist one assessment_results row per attempt (raw driver, like every other
 * controller — never blocks on a down Mongoose connection; the Mongoose model
 * in models/Assessment.js documents this shape). Analytics failures must never
 * fail a graded submit, so errors are logged only.
 * @returns {Promise<number>} 1-based attempt number (best effort)
 */
async function persistAttempt(resultsCollection, { candidateId, test, now, durationSec, result, score, perSkill, feedback }) {
  let attempt = 1;
  try {
    attempt = (await resultsCollection.countDocuments({ candidateId })) + 1;
    await resultsCollection.insertOne({
      candidateId,
      assessmentId: test._id, // the skill_tests document this attempt belongs to
      skills: Array.isArray(test.skills) ? test.skills : [],
      score,
      perSkill: Array.isArray(perSkill) ? perSkill : [],
      result,
      durationSec,
      feedback: feedback ?? null,
      attempt,
      startedAt: test.startedAt ? new Date(test.startedAt) : null,
      completedAt: now,
    });
  } catch (error) {
    console.warn("Failed to persist skill-test assessment result:", error?.message || error);
  }
  return attempt;
}

/**
 * Generate a new skill test
 * POST /api/skill-test/generate
 * Body: { candidateId: string, skills: string[] }
 * → 200 { success, data: { testId, skills, questions:[{id,index,prompt,options,skill,difficulty,type}],
 *                          timeLimitMinutes, remainingSec, expiresAt, passingScore } }
 */
const generateTest = async (req, res) => {
  try {
    const { candidateId, skill, skills: reqSkills } = req.body;
    let skills = reqSkills;
    if (!skills && skill) skills = [skill];

    if (!candidateId || !skills || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ success: false, message: "candidateId and skills array are required" });
    }

    const db = getDB();
    const tests = db.collection("skill_tests");
    const users = db.collection("users");

    // Server-side cooldown: a failed attempt locks retests for 2h.
    const user = await users.findOne({ firebaseUid: candidateId });
    if (user?.nextAttemptTime && new Date(user.nextAttemptTime) > new Date()) {
      const nextAttemptAt = new Date(user.nextAttemptTime);
      return res.status(400).json({
        success: false,
        code: "COOLDOWN",
        cooldown: true,
        nextAttemptAt: nextAttemptAt.toISOString(),
        retryAfterSec: Math.ceil((nextAttemptAt.getTime() - Date.now()) / 1000),
        message: "You did not pass your most recent skill test. Please wait before taking another one.",
      });
    }

    const generated = await generateSkillQuestions(skills);

    // Per-attempt answer key: shuffle options, then store ONLY a salted hash
    // of the correct index (position in the shuffled array).
    const answerSalt = randomBytes(16).toString("hex");
    const questions = generated.map((q, i) => {
      const rawOptions = Array.isArray(q.options) ? q.options : [];
      const options = shuffleOptions(rawOptions);
      const correctIndex = options.findIndex(
        (opt) => String(opt).trim() === String(q.correctAnswer ?? "").trim(),
      );
      return {
        id: q.id || `q${i + 1}`,
        text: q.text || "",
        difficulty: q.difficulty === "Simple" ? "Simple" : "Medium",
        skill: q.skill || skills[0],
        type: "mcq",
        options,
        answerHash: hashExpectedAnswer(correctIndex === -1 ? 0 : correctIndex, answerSalt),
      };
    });

    const startedAt = new Date();
    const timeLimitMinutes = TIME_LIMIT_MINUTES;
    const expiresAt = new Date(startedAt.getTime() + timeLimitMinutes * 60_000);

    const newTest = {
      candidateId,
      skills,
      questions,
      answerSalt,
      timeLimitMinutes,
      startedAt,
      expiresAt,
      answers: [],
      score: null,
      result: "pending", // pending | pass | fail | expired
      createdAt: startedAt,
    };

    const result = await tests.insertOne(newTest);

    // API-safe projection: exact field whitelist — nothing answer-bearing.
    res.status(200).json({
      success: true,
      data: {
        testId: result.insertedId,
        skills,
        questions: questions.map((q, index) => ({
          id: q.id,
          index,
          prompt: q.text,
          options: q.options,
          skill: q.skill,
          difficulty: q.difficulty,
          type: q.type,
        })),
        timeLimitMinutes,
        remainingSec: timeLimitMinutes * 60,
        expiresAt: expiresAt.toISOString(),
        passingScore: PASS_THRESHOLD,
      },
    });
  } catch (error) {
    console.error("Error generating skill test:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to generate test" });
  }
};

/**
 * Submit answers for a skill test
 * POST /api/skill-test/submit
 * Body: { testId: string, candidateId: string, answers: Array<{questionId, answer}> }
 * (answer = option text or 0-based option index)
 * → 200 { success, data: { score, result, passed, passingScore, feedback, perSkill,
 *                          correctCount, totalQuestions, verifiedSkills, isSkillVerified,
 *                          attempt, nextAttemptAt } }
 */
const submitTest = async (req, res) => {
  try {
    const { testId, candidateId, answers } = req.body;
    if (!testId || !candidateId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    const db = getDB();
    const tests = db.collection("skill_tests");
    const users = db.collection("users");
    const results = db.collection("assessment_results");

    // Fetch the test (scoped to the owning candidate).
    const test = await tests.findOne({ _id: new ObjectId(testId), candidateId });
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }

    // Anti-replay: each attempt can be graded exactly once.
    if (test.result === "expired") {
      return res.status(400).json({
        success: false,
        code: "TEST_EXPIRED",
        expired: true,
        message: "Time is up — this test has expired. Start a new test when you are ready.",
      });
    }
    if (test.result !== "pending") {
      return res.status(400).json({
        success: false,
        code: "ALREADY_SUBMITTED",
        message: "Test already submitted",
      });
    }

    const now = new Date();
    const startedAt = test.startedAt ? new Date(test.startedAt) : new Date(test.createdAt);
    const timeLimitMinutes = Number(test.timeLimitMinutes) || TIME_LIMIT_MINUTES;
    const deadlineMs = startedAt.getTime() + timeLimitMinutes * 60_000 + GRACE_SECONDS * 1000;

    // Server-side time limit (10 min + 30s grace).
    if (now.getTime() > deadlineMs) {
      const claim = await tests.updateOne(
        { _id: new ObjectId(testId), result: "pending" },
        { $set: { result: "expired", expiredAt: now } },
      );
      if (!claim.modifiedCount) {
        return res.status(400).json({ success: false, code: "ALREADY_SUBMITTED", message: "Test already submitted" });
      }
      // Record the timed-out attempt for analytics. No fail-cooldown is applied
      // for expiry — the candidate can restart immediately.
      await persistAttempt(results, {
        candidateId,
        test,
        now,
        durationSec: timeLimitMinutes * 60,
        result: "expired",
        score: null,
        perSkill: [],
        feedback: null,
      });
      return res.status(400).json({
        success: false,
        code: "TEST_EXPIRED",
        expired: true,
        message: `Time is up — the ${timeLimitMinutes}-minute limit has passed. Start a new test when you are ready.`,
      });
    }

    // The user must exist before we consume the attempt.
    const user = await users.findOne({ firebaseUid: candidateId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Evaluate answers against the stored hash key (out-of-band knowledge only).
    const { evaluateSkillAnswers } = skillEvaluationService;
    const evaluation = await evaluateSkillAnswers(test.skills, test.questions, answers, test.answerSalt);

    const isPass = evaluation.passed;
    const finalResult = isPass ? "pass" : "fail";
    const durationSec = Math.max(
      0,
      Math.min(Math.round((now.getTime() - startedAt.getTime()) / 1000), timeLimitMinutes * 60 + GRACE_SECONDS),
    );

    // Grade exactly once: only a still-pending test may flip to pass/fail.
    const claim = await tests.updateOne(
      { _id: new ObjectId(testId), result: "pending" },
      {
        $set: {
          answers,
          score: evaluation.score,
          feedback: evaluation.feedback,
          result: finalResult,
          durationSec,
          completedAt: now,
        },
      },
    );
    if (!claim.modifiedCount) {
      return res.status(400).json({ success: false, code: "ALREADY_SUBMITTED", message: "Test already submitted" });
    }

    // Update user record depending on result
    let verifiedSkills = Array.isArray(user.verifiedSkills) ? [...user.verifiedSkills] : [];
    let isSkillVerified = user.isSkillVerified || false;
    let updateFields = {};
    let nextAttemptAt = null;

    if (isPass) {
      test.skills.forEach((ts) => {
        if (!verifiedSkills.includes(ts)) {
          verifiedSkills.push(ts);
        }
      });
      // One-time unlock: once candidate passes a skill test, mark skill verification as complete.
      isSkillVerified = true;

      updateFields = {
        verifiedSkills,
        isSkillVerified,
        lastTestAttempt: now,
      };
    } else {
      // Cooldown for 2 hours if failed
      nextAttemptAt = new Date(now.getTime() + FAIL_COOLDOWN_MS);
      updateFields = {
        lastTestAttempt: now,
        nextAttemptTime: nextAttemptAt,
      };
    }

    await users.updateOne(
      { firebaseUid: candidateId },
      { $set: updateFields }
    );

    // Passing a skill test changes verifiedSkills → refresh the Hiring Fit
    // Score (aiScore) on the candidate's open applications — best-effort.
    if (isPass) {
      scheduleCandidateAiScoreRecompute(candidateId);
    }

    const attempt = await persistAttempt(results, {
      candidateId,
      test,
      now,
      durationSec,
      result: finalResult,
      score: evaluation.score,
      perSkill: evaluation.perSkill,
      feedback: evaluation.feedback,
    });

    res.status(200).json({
      success: true,
      data: {
        score: evaluation.score,
        result: finalResult,
        passed: isPass,
        passingScore: PASS_THRESHOLD,
        feedback: evaluation.feedback,
        perSkill: evaluation.perSkill,
        correctCount: evaluation.correctCount,
        totalQuestions: evaluation.totalQuestions,
        verifiedSkills,
        isSkillVerified,
        attempt,
        nextAttemptAt: nextAttemptAt ? nextAttemptAt.toISOString() : null,
      },
    });
  } catch (error) {
    console.error("Error submitting skill test:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to submit test" });
  }
};

export { generateTest, submitTest };
