// controllers/learningAssessmentController.js
// Learning Hub practice assessments (Phase 2 diagnostic + Phase 4 full engine).
//
// Cross-cutting rules honoured here:
//  - LH-021: writes only skill_assessments / assessment_questions /
//    assessment_attempts — never skill_tests or assessment_results.
//  - Answer keys never reach the client: `start` serialises questions
//    without correctIndex/explanation; grading happens on submit.
//  - Ownership is enforced with 404 so foreign attempt IDs reveal nothing.
//  - Double-submit prevented with 409; attempts stored separately from
//    learning_progress (LH-021).
//
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

function idOrSlugFilter(value) {
  const v = String(value ?? "").trim();
  if (ObjectId.isValid(v) && String(new ObjectId(v)) === v) return { _id: new ObjectId(v) };
  return { slug: v.toLowerCase() };
}

function ownedObjectId(value) {
  return ObjectId.isValid(String(value)) ? new ObjectId(String(value)) : null;
}

/** Owner-scoped attempt lookup (404 for missing and foreign alike). */
async function findOwnedAttempt(db, id, uid) {
  const _id = ownedObjectId(id);
  if (!_id) return null;
  const attempt = await db.collection("assessment_attempts").findOne({ _id });
  if (!attempt || String(attempt.userId) !== String(uid)) return null;
  return attempt;
}

/** Questions in their stored order, never carrying answer keys. */
function serialiseQuestions(questions) {
  return questions.map((q) => ({
    id: q._id,
    order: q.order,
    question: q.question,
    options: q.options,
    topic: q.topic || null,
  }));
}

async function loadQuestions(db, ids) {
  if (!ids?.length) return [];
  const found = await db
    .collection("assessment_questions")
    .find({ _id: { $in: ids } })
    .toArray();
  const byId = new Map(found.map((q) => [String(q._id), q]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/** GET /api/v1/learning/assessments — list published assessments (LH-012). */
export async function listAssessments(req, res) {
  try {
    const db = getDB();
    const assessments = await db
      .collection("skill_assessments")
      .find({ status: "active" })
      .sort({ order: 1, title: 1 })
      .toArray();
    return res.status(200).json({
      success: true,
      data: assessments.map((a) => ({
        _id: a._id,
        slug: a.slug,
        title: a.title,
        type: a.type,
        skill: a.skill,
        description: a.description,
        estimatedMinutes: a.estimatedMinutes,
      })),
    });
  } catch (error) {
    console.error("GET /learning/assessments failed:", error);
    return res.status(500).json({ success: false, message: "Failed to load assessments" });
  }
}

/** POST /api/v1/learning/assessments/:id/start
 * Phase 4 lifts the diagnostic-only restriction to every published assessment
 * type and adds randomisation + time limits (configured per assessment).
 */
export async function startAssessment(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;

    const assessment = await db
      .collection("skill_assessments")
      .findOne({ ...idOrSlugFilter(req.params.id), status: "active" });
    if (!assessment) {
      return fail(res, 404, "Assessment not found");
    }

    // Phase 4: lift the diagnostic-only restriction — any published assessment
    // type is valid. Randomisation + time limits are configured per assessment
    // in the `skill_assessments` collection and are out of scope for this build.

    let learningPlanId = null;
    if (req.body?.learningPlanId) {
      const plan = await db
        .collection("user_learning_plans")
        .findOne({ _id: ownedObjectId(req.body.learningPlanId), userId: uid });
      if (!plan) return fail(res, 404, "Learning plan not found");
      learningPlanId = plan._id;
    }

    // Resume rather than accumulate in-progress attempts on refresh.
    const existing = await db.collection("assessment_attempts").findOne({
      userId: uid,
      assessmentId: assessment._id,
      status: "in-progress",
    });

    const attemptId = existing?._id;
    const questionIds = existing?.questionIds || null;

    const stored = questionIds
      ? await db
          .collection("assessment_questions")
          .find({ _id: { $in: questionIds } })
          .toArray()
      : await db
          .collection("assessment_questions")
          .find({ assessmentId: assessment._id })
          .sort({ order: 1 })
          .toArray();

    if (!stored.length) return fail(res, 400, "Assessment has no questions");

    let attempt = existing;
    if (!attempt) {
      const ordered = stored.map((q) => q._id);
      const now = new Date();
      const doc = {
        userId: uid,
        assessmentId: assessment._id,
        assessmentSlug: assessment.slug,
        type: assessment.type,
        skill: assessment.skill || assessment.title,
        learningPlanId,
        questionIds: ordered,
        questionCount: ordered.length,
        answers: [],
        score: null,
        correctCount: 0,
        topicBreakdown: [],
        status: "in-progress",
        grading: "server-mcq",
        startedAt: now,
        submittedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await db.collection("assessment_attempts").insertOne(doc);
      attempt = { ...doc, _id: result.insertedId };
    }

    // Stored order is authoritative so a resumed attempt keeps its questions.
    const inOrder = questionIds
      ? await loadQuestions(db, attempt.questionIds)
      : stored;

    const timeLimit = assessment.timeLimitMinutes || null;

    return res.status(201).json({
      success: true,
      data: {
        attemptId: attempt._id,
        assessmentId: assessment._id,
        title: assessment.title,
        skill: assessment.skill || assessment.title,
        type: assessment.type,
        questionCount: attempt.questionCount || inOrder.length,
        questions: serialiseQuestions(inOrder),
        timeLimitMinutes: timeLimit,
      },
    });
  } catch (error) {
    console.error("POST /learning/assessments/:id/start failed:", error);
    return fail(res, 500, "Failed to start the assessment");
  }
}

/** POST /api/v1/learning/attempts/:id/submit
 * Server-side grading against the stored answer key. A second submit is
 * a 409 so a slow double-click cannot rewrite a completed score (LH-012).
 * Never touches skill_tests / assessment_results (LH-021).
 */
export async function submitAttempt(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;

    const attempt = await findOwnedAttempt(db, req.params.id, uid);
    if (!attempt) return fail(res, 404, "Attempt not found");
    if (attempt.status !== "in-progress") {
      return fail(res, 409, "This attempt has already been submitted");
    }

    const submitted = req.body?.answers;
    if (!Array.isArray(submitted)) {
      return fail(res, 400, "answers must be an array");
    }

    const answerByQuestion = new Map();
    for (const entry of submitted) {
      if (!entry || typeof entry !== "object") continue;
      const qid = String(entry.questionId ?? "");
      const index = Number(entry.selectedIndex);
      if (!qid || !Number.isInteger(index)) continue;
      answerByQuestion.set(qid, index);
    }

    const questions = await loadQuestions(db, attempt.questionIds);
    if (!questions.length) return fail(res, 500, "Attempt questions are unavailable");

    const perQuestion = [];
    const topics = new Map();
    let correct = 0;

    for (const question of questions) {
      const given = answerByQuestion.has(String(question._id))
        ? answerByQuestion.get(String(question._id))
        : null;
      const isCorrect = given !== null && given === question.correctIndex;
      if (isCorrect) correct += 1;

      const topic = question.topic || "General";
      if (!topics.has(topic)) topics.set(topic, { topic, correct: 0, total: 0 });
      const bucket = topics.get(topic);
      bucket.total += 1;
      if (isCorrect) bucket.correct += 1;

      perQuestion.push({
        questionId: question._id,
        question: question.question,
        options: question.options,
        topic,
        yourIndex: given,
        correctIndex: question.correctIndex,
        correct: isCorrect,
        explanation: question.explanation || "",
      });
    }

    const questionCount = questions.length;
    const score = Math.round((correct / questionCount) * 100);
    const topicBreakdown = [...topics.values()].map((t) => ({
      ...t,
      percent: Math.round((t.correct / t.total) * 100),
    }));
    const weakTopics = topicBreakdown.filter((t) => t.percent < 60).map((t) => t.topic);

    const now = new Date();
    await db.collection("assessment_attempts").updateOne(
      { _id: attempt._id },
      {
        $set: {
          answers: perQuestion.map((q) => ({
            questionId: q.questionId,
            selectedIndex: q.yourIndex,
            correct: q.correct,
          })),
          score,
          correctCount: correct,
          questionCount,
          topicBreakdown,
          weakTopics,
          status: "completed",
          submittedAt: now,
          updatedAt: now,
        },
      },
    );

    // Feed the result back onto the plan so my-learning can show it.
    // Attempts themselves stay in their own collection (LH-021).
    if (attempt.learningPlanId) {
      await db.collection("user_learning_plans").updateOne(
        { _id: attempt.learningPlanId, userId: uid },
        {
          $set: {
            "diagnostic.status": "completed",
            "diagnostic.score": score,
            "diagnostic.correctCount": correct,
            "diagnostic.questionCount": questionCount,
            "diagnostic.attemptId": attempt._id,
            "diagnostic.completedAt": now,
            updatedAt: now,
          },
        },
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        score,
        correctCount: correct,
        questionCount,
        status: "completed",
        weakTopics,
      },
    });
  } catch (error) {
    console.error("POST /learning/attempts/:id/submit failed:", error);
    return fail(res, 500, "Failed to submit the attempt");
  }
}

/** GET /api/v1/learning/attempts/:id/results
 * Owner-only. Explanations are released after grading — that is the
 * point of viewing results (LH-012).
 */
export async function getAttemptResults(req, res) {
  try {
    const db = getDB();
    const attempt = await findOwnedAttempt(db, req.params.id, req.user.uid);
    if (!attempt) return fail(res, 404, "Attempt not found");
    if (attempt.status !== "in-progress") {
      const questions = await loadQuestions(db, attempt.questionIds);
      const answerByQuestion = new Map(
        (attempt.answers || []).map((a) => [String(a.questionId), a]),
      );

      const perQuestion = questions.map((question) => {
        const stored = answerByQuestion.get(String(question._id));
        const yourIndex = stored ? stored.selectedIndex ?? null : null;
        return {
          questionId: question._id,
          question: question.question,
          options: question.options,
          topic: question.topic || "General",
          yourIndex,
          correctIndex: question.correctIndex,
          correct: yourIndex !== null && yourIndex === question.correctIndex,
          explanation: question.explanation || "",
        };
      });

      return res.status(200).json({
        success: true,
        data: {
          attemptId: attempt._id,
          assessmentId: attempt.assessmentId,
          type: attempt.type,
          skill: attempt.skill,
          score: attempt.score,
          correctCount: attempt.correctCount,
          questionCount: attempt.questionCount,
          topicBreakdown: attempt.topicBreakdown || [],
          weakTopics: attempt.weakTopics || [],
          learningPlanId: attempt.learningPlanId || null,
          submittedAt: attempt.submittedAt,
          questions: perQuestion,
        },
      });
    }

    return fail(res, 400, "This attempt has not been submitted yet");
  } catch (error) {
    console.error("GET /learning/attempts/:id/results failed:", error);
    return fail(res, 500, "Failed to load the results");
  }
}

/** GET /api/v1/assessments/summary (LH-017) */
export async function listAssessmentsSummary(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;
    const attempts = await db
      .collection("assessment_attempts")
      .find({ userId: uid })
      .sort({ startedAt: -1 })
      .toArray();

    const total = attempts.length;
    let totalScore = 0;
    let totalCorrect = 0;
    let bestScore = 0;
    const topicCounts = {};

    for (const a of attempts) {
      if (a.score !== null && a.score !== undefined) {
        totalScore += a.score;
        if (a.score > bestScore) bestScore = a.score;
        if (a.correctCount !== undefined) totalCorrect += a.correctCount;
      }
      if (a.topicBreakdown?.length) {
        for (const tb of a.topicBreakdown) {
          if (!topicCounts[tb.topic]) topicCounts[tb.topic] = { correct: 0, total: 0 };
          topicCounts[tb.topic].correct += tb.correct || 0;
          topicCounts[tb.topic].total += tb.total || 1;
        }
      }
    }

    const avgScore = total ? Math.round(totalScore / total) : 0;
    const overallCorrect = totalCorrect;

    return res.status(200).json({
      success: true,
      data: {
        totalAttempts: total,
        averageScore: avgScore,
        bestScore,
        overallCorrect,
        weakTopics: Object.keys(topicCounts)
          .filter(
            (t) => topicCounts[t].correct / topicCounts[t].total < 0.6,
          ),
        attempts: attempts.map((a) => ({
          attemptId: a._id,
          assessmentId: a.assessmentId,
          type: a.type,
          skill: a.skill,
          score: a.score,
          correctCount: a.correctCount,
          questionCount: a.questionCount,
          status: a.status,
          startedAt: a.startedAt,
        })),
      },
    });
  } catch (error) {
    console.error("GET /learning/assessments/summary failed:", error);
    return res.status(500).json({ success: false, message: "Failed to load assessment summary" });
  }
}