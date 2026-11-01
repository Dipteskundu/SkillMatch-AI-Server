// services/interviewPrep.service.js
// AI mock interview prep: question generation, answer evaluation, session history.
// Reuses the shared Gemini fallback layer in gemini.service.js.

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { generateWithFallback } from "./gemini.service.js";
import { stripPIIFromText } from "./sanitizer.service.js";

const MAX_QUESTIONS = 6;

/**
 * Build interview prep input from the candidate's resume + most recent application.
 * Falls back to user profile skills when no resume exists.
 * @param {string} uid - firebaseUid
 * @returns {Promise<{skills: string[], targetRole: string, company: string, source: string}>}
 */
export async function getPrepInput(uid) {
  const db = getDB();

  const resume = await db.collection("resumes").findOne(
    { candidateId: uid },
    { sort: { createdAt: -1 }, projection: { extractedSkills: 1, extractedTechnologies: 1, extractedRoles: 1 } }
  );

  const latestApp = await db.collection("applications").findOne(
    { firebaseUid: uid },
    { sort: { createdAt: -1 }, projection: { jobTitle: 1, companyName: 1 } }
  );

  const user = await db.collection("users").findOne(
    { firebaseUid: uid },
    { projection: { skills: 1, title: 1, _id: 0 } }
  );

  const skills = Array.from(new Set([
    ...(resume?.extractedSkills || []),
    ...(resume?.extractedTechnologies || []),
    ...(user?.skills || []),
  ])).slice(0, 15);

  const targetRole = latestApp?.jobTitle || user?.title || resume?.extractedRoles?.[0] || "";

  return {
    skills,
    targetRole,
    company: latestApp?.companyName || "",
    // Report which source fed the questions so the UI can tell the user.
    source: resume ? (latestApp ? "resume+applied jobs" : "resume") : "profile",
  };
}

function parseJsonLoose(text) {
  let jsonStr = text;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  const firstBrace = jsonStr.indexOf("{");
  const firstBracket = jsonStr.indexOf("[");
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = jsonStr.lastIndexOf("]");
    if (lastBracket > firstBracket) jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
    return JSON.parse(jsonStr);
  }
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(jsonStr);
}

/**
 * Generate tailored interview questions for a candidate session.
 * @param {string} uid
 * @param {{targetRole?: string, skills?: string[], company?: string, difficulty?: string}} [override]
 * @returns {Promise<{sessionId: ObjectId, questions: Array<{id: string, text: string, type: string}>, meta: object}>}
 */
export async function startPrepSession(uid, override = {}) {
  const input = await getPrepInput(uid);
  const targetRole = override.targetRole || input.targetRole;
  const skills = override.skills?.length ? override.skills : input.skills;
  const company = override.company || input.company;
  const difficulty = ["easy", "medium", "hard"].includes(override.difficulty) ? override.difficulty : "medium";

  if (!targetRole || skills.length === 0) {
    const err = new Error("Add skills to your profile (or upload a resume) before starting interview prep.");
    err.status = 400;
    throw err;
  }

  const prompt = `You are a senior technical interviewer. Generate exactly ${MAX_QUESTIONS} interview questions for a "${targetRole}" position${company ? ` at "${company}"` : ""}.

Job difficulty: ${difficulty}.
Candidate's skills to base questions on: ${skills.join(", ")}.

Mix of question types:
1. Two technical questions about their listed skills
2. One behavioral (STAR-format friendly) question
3. One role-scenario question
4. One communication/culture question

Return ONLY a valid JSON array, each object: {"id": "q1", "text": "...", "type": "technical"|"behavioral"|"scenario"|"communication"}.
No markdown, no extra text.`;

  const { text } = await generateWithFallback(prompt);

  let questions;
  try {
    questions = parseJsonLoose(text);
  } catch {
    const err = new Error("AI returned an unreadable question set. Please retry.");
    err.status = 502;
    throw err;
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    const err = new Error("AI returned no questions. Please retry.");
    err.status = 502;
    throw err;
  }

  const cleanQuestions = questions.slice(0, MAX_QUESTIONS).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    text: stripPIIFromText(String(q.text || "")),
    type: q.type || "technical",
  }));

  const db = getDB();
  const session = {
    userId: uid,
    targetRole: stripPIIFromText(targetRole),
    company: stripPIIFromText(company),
    difficulty,
    inputSource: input.source,
    questions: cleanQuestions,
    answers: [],
    status: "in_progress",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { insertedId } = await db.collection("mock_interviews").insertOne(session);

  return { sessionId: insertedId, questions: cleanQuestions, meta: { targetRole, company, difficulty, source: input.source } };
}

/**
 * Submit answers for a session and get an AI evaluation report.
 * @param {string} uid
 * @param {string} sessionId
 * @param {Array<{questionId: string, answer: string}>} answers
 */
export async function submitAnswers(uid, sessionId, answers) {
  const db = getDB();
  let session;
  try {
    session = await db.collection("mock_interviews").findOne({ _id: new ObjectId(sessionId), userId: uid });
  } catch {
    throw Object.assign(new Error("Invalid session id"), { status: 400 });
  }
  if (!session) throw Object.assign(new Error("Mock interview session not found"), { status: 404 });
  if (session.status === "completed") throw Object.assign(new Error("This session is already completed"), { status: 409 });
  if (!Array.isArray(answers) || answers.length === 0) {
    throw Object.assign(new Error("Answers array is required"), { status: 400 });
  }

  const qaPairs = session.questions.map((q) => {
    const a = answers.find((x) => x.questionId === q.id);
    return { question: q.text, type: q.type, answer: (a?.answer || "").slice(0, 4000) };
  });

  const prompt = `You are an interview coach. Evaluate these mock interview answers for a "${session.targetRole}" role.

Score each dimension 0-100:
- clarity: how clear and direct the answers are
- relevance: how well answers address the question
- structure: use of frameworks (e.g. STAR for behavioral)
- depth: technical detail appropriate to the role

Also give per-question one-line feedback and 3 concrete improvement tips.

Return ONLY a valid JSON object:
{"clarity": 80, "relevance": 75, "structure": 70, "depth": 65,
 "questionFeedback": [{"id": "q1", "feedback": "..."}],
 "tips": ["tip1", "tip2", "tip3"]}
No markdown, no extra text.

Questions and answers:
${JSON.stringify(qaPairs, null, 2)}`;

  const { text } = await generateWithFallback(prompt);

  let evaluation;
  try {
    evaluation = parseJsonLoose(text);
  } catch {
    throw Object.assign(new Error("AI evaluation was unreadable. Please retry."), { status: 502 });
  }

  const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0));
  const report = {
    clarity: clamp(evaluation.clarity),
    relevance: clamp(evaluation.relevance),
    structure: clamp(evaluation.structure),
    depth: clamp(evaluation.depth),
    questionFeedback: Array.isArray(evaluation.questionFeedback)
      ? evaluation.questionFeedback.slice(0, session.questions.length).map((f, i) => ({
          id: f.id || session.questions[i]?.id || `q${i + 1}`,
          feedback: stripPIIFromText(String(f.feedback || "")).slice(0, 1000),
        }))
      : [],
    tips: Array.isArray(evaluation.tips)
      ? evaluation.tips.slice(0, 3).map((t) => stripPIIFromText(String(t)).slice(0, 500))
      : [],
    evaluatedAt: new Date(),
  };

  await db.collection("mock_interviews").updateOne(
    { _id: session._id },
    {
      $set: {
        answers: qaPairs.map(({ question, answer }) => ({ question, answer })),
        report,
        status: "completed",
        updatedAt: new Date(),
      },
    }
  );

  return { sessionId, report };
}

/**
 * List the user's past mock interview sessions (for progress tracking).
 */
export async function listSessions(uid) {
  const db = getDB();
  const sessions = await db
    .collection("mock_interviews")
    .find({ userId: uid })
    .sort({ createdAt: -1 })
    .limit(20)
    .project({
      targetRole: 1, company: 1, difficulty: 1, status: 1,
      createdAt: 1, "report.clarity": 1, "report.relevance": 1,
      "report.structure": 1, "report.depth": 1,
    })
    .toArray();
  return sessions;
}

/**
 * Get one full session (questions, answers, report) — owner only.
 */
export async function getSession(uid, sessionId) {
  const db = getDB();
  let session;
  try {
    session = await db.collection("mock_interviews").findOne({ _id: new ObjectId(sessionId), userId: uid });
  } catch {
    throw Object.assign(new Error("Invalid session id"), { status: 400 });
  }
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  return session;
}
