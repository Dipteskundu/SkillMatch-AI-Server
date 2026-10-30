// services/gemini.service.js
// AI layer for generating questions and evaluating communication answers
// Using the official Google Generative AI SDK (@google/generative-ai)
// Documentation: https://ai.google.dev/gemini-api/docs/get-started/node

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.warn("GEMINI_API_KEY not set. Communication test AI features will fail.");
}

// Initialize the Google Generative AI client
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Model priority list. Every entry verified against generateContent for
// this key: the previous 2.x list was retired server-side and 404'd on
// every call, which silently broke all AI features in this service.
const MODEL_PRIORITY = [
  "gemini-3.6-flash",           // Current stable Flash
  "gemini-3.5-flash",           // Previous stable Flash
  "gemini-3.5-flash-lite",      // Lighter/cheaper fallback
  "gemini-3.1-flash-lite",      // Oldest still-live lite
];

const TIME_LIMIT_MINUTES = 10;
const QUESTION_COUNT = 5;

/**
 * Get a generative model instance with configuration
 */
function getModel(modelName) {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  });
}

/**
 * Parse retry delay (seconds) from 429 error message
 */
function parseRetryDelay(err) {
  const msg = String(err?.message || err);
  const match = msg.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.min(parseFloat(match[1]) || 60, 120);
  return 60;
}

/**
 * Sleep for given seconds
 */
function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Call generateContent with model fallback on errors
 * Implements retry logic and model fallback for reliability
 */
async function generateWithFallback(prompt, retryCount = 0) {
  if (!genAI) {
    throw new Error("Gemini API not configured. Set GEMINI_API_KEY in .env");
  }

  let lastError = null;
  let lastWas429 = false;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = getModel(modelName);
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      if (text && text.trim()) {
        console.log(`✓ Successfully used model: ${modelName}`);
        return { text: text.trim(), modelUsed: modelName };
      }
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err).toLowerCase();
      const is404 = msg.includes("404") || msg.includes("not found");
      const is503 = msg.includes("503") || msg.includes("unavailable");
      const is429 = msg.includes("429") || msg.includes("too many requests") || msg.includes("quota exceeded");

      if (is404 || is503) {
        console.warn(`⚠ Model ${modelName} failed (${is404 ? "404" : "503"}), trying fallback...`);
        continue;
      }
      if (is429) {
        lastWas429 = true;
        console.warn(`⚠ Model ${modelName} quota exceeded (429), trying next model...`);
        continue;
      }
      // For other errors, throw immediately
      throw err;
    }
  }

  // All models failed; if 429, retry once after delay
  if (lastWas429 && retryCount < 1) {
    const delay = Math.min(parseRetryDelay(lastError), 90);
    console.warn(`⚠ All models hit quota. Retrying in ${delay}s...`);
    await sleep(delay);
    return generateWithFallback(prompt, retryCount + 1);
  }

  const quotaMsg = lastError?.message?.includes("quota") || lastError?.message?.includes("429")
    ? "Gemini API quota exceeded. Please wait a few minutes or check your plan at https://ai.google.dev/gemini-api/docs/rate-limits"
    : "All Gemini models failed. Try updating GEMINI_API_KEY or check your internet connection.";
  throw lastError || new Error(quotaMsg);
}

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

  const { text } = await generateWithFallback(prompt);

  // Parse JSON from response (handle markdown code blocks if present)
  let jsonStr = text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1].trim();

  const questions = JSON.parse(jsonStr);
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

  const { text } = await generateWithFallback(prompt);

  // Parse JSON from response - handle various formats
  let jsonStr = text;
  
  // Remove markdown code blocks if present
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  // Remove any leading/trailing text that's not part of the JSON
  // Find the first { and last }
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseError) {
    console.error("JSON Parse Error. Raw response:", text);
    console.error("Extracted JSON string:", jsonStr);
    throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
  }

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
  generateWithFallback,
  generateQuestions,
  evaluateAnswers,
  TIME_LIMIT_MINUTES,
  QUESTION_COUNT,
};
