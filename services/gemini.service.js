// services/gemini.service.js
// AI layer for generating questions and evaluating communication answers.
// All Gemini access goes through services/llm.js (single client, fallback
// chain, quota retry, structured logging). Prompts/temperatures preserved.

import { generateJSON } from "./llm.js";

const TIME_LIMIT_MINUTES = 10;
const QUESTION_COUNT = 5;

/**
 * Generate communication assessment questions for a job role
 * @param {string} jobTitle - e.g. "Frontend Developer"
 * @param {string} company - Company name
 * @returns {Promise<{questions: Array<{id: string, text: string, type: string}>, timeLimit: number}>}
 */
async function generateQuestions(jobTitle = "Professional", company = "Company") {
  const prompt = `You are an expert HR assessor. Generate exactly ${QUESTION_COUNT} communication assessment questions for a "${jobTitle}" role at "${company}".

Include variety:
1. Professional email writing (e.g. follow-up, clarification request)
2. Conflict resolution scenario
3. Teamwork/collaboration scenario
4. Explaining technical issue to non-technical client
5. Brief professional response to a stakeholder

Return ONLY a valid JSON array. Each object must have: "id" (string), "text" (string), "type" (string).
Example format:
[
  {"id": "q1", "text": "Write a professional email to...", "type": "email"},
  {"id": "q2", "text": "A teammate disagrees with your approach...", "type": "conflict"},
  {"id": "q3", "text": "Your team needs to deliver a project...", "type": "teamwork"},
  {"id": "q4", "text": "A client does not understand why...", "type": "client_explanation"},
  {"id": "q5", "text": "Your manager asks for a status update...", "type": "professional"}
]

Return ONLY the JSON array, no markdown, no extra text.`;

  const questions = await generateJSON({
    prompt,
    temperature: 0.7,
    maxOutputTokens: 8192,
    promptTag: "comm.questions",
  });

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Invalid question format from AI");
  }

  return {
    questions: questions.slice(0, QUESTION_COUNT).map((q, i) => ({
      id: q.id || `q${i + 1}`,
      text: q.text || "",
      type: q.type || "general",
    })),
    timeLimit: TIME_LIMIT_MINUTES,
  };
}

/**
 * Evaluate candidate answers and return scores + feedback
 * @param {Array<{id: string, text: string}>} questions
 * @param {Array<{questionId: string, answer: string}>} answers
 * @returns {Promise<{clarityScore: number, toneScore: number, grammarScore: number, structureScore: number, communicationScore: number, feedback: string}>}
 */
async function evaluateAnswers(questions, answers) {
  const qaPairs = questions.map((q) => {
    const ans = answers.find((a) => a.questionId === q.id);
    return { question: q.text, answer: ans?.answer || "(No answer provided)" };
  });

  const prompt = `You are an expert communication assessor. Evaluate these candidate responses for a job application.

Review ALL responses together and provide a SINGLE overall evaluation with these scores:
- clarity (0-100): How clear and understandable are the responses overall?
- professional tone (0-100): How professional is the tone across all responses?
- grammar (0-100): Grammar quality across all responses
- structure (0-100): How well-structured are the responses?
- communication effectiveness (0-100): Overall communication effectiveness

Then provide brief overall feedback (2-3 sentences) about the candidate's communication skills.

IMPORTANT: Return ONLY ONE JSON object with the overall scores, NOT an array.

Return ONLY valid JSON in this EXACT format:
{
  "clarityScore": 85,
  "toneScore": 90,
  "grammarScore": 80,
  "structureScore": 85,
  "communicationScore": 84,
  "feedback": "Strong professional tone and clear explanations. Improve grammar consistency in longer responses."
}

Questions and answers:
${JSON.stringify(qaPairs, null, 2)}

Return ONLY the single JSON object, no markdown, no extra text, no arrays.`;

  const parsed = await generateJSON({
    prompt,
    temperature: 0.7,
    maxOutputTokens: 8192,
    promptTag: "comm.evaluate",
  });

  const scores = {
    clarityScore: Math.min(100, Math.max(0, Number(parsed.clarityScore) || 0)),
    toneScore: Math.min(100, Math.max(0, Number(parsed.toneScore) || 0)),
    grammarScore: Math.min(100, Math.max(0, Number(parsed.grammarScore) || 0)),
    structureScore: Math.min(100, Math.max(0, Number(parsed.structureScore) || 0)),
    communicationScore: Math.min(100, Math.max(0, Number(parsed.communicationScore) || 0)),
    feedback: String(parsed.feedback || "Evaluation completed."),
  };

  return scores;
}

export {
  generateQuestions,
  evaluateAnswers,
  TIME_LIMIT_MINUTES,
  QUESTION_COUNT,
};
