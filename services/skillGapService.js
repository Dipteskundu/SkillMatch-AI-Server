// services/skillGapService.js
// Compares candidate skills with job skills and generates AI learning suggestions

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Model priority list
const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001"
];

function getModel(modelName) {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.4,
    },
  });
}

function parseRetryDelay(err) {
  const msg = String(err?.message || err);
  const match = msg.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.min(parseFloat(match[1]) || 60, 120);
  return 60;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

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
      const text = result.response.text();
      
      if (text && text.trim()) {
        return { text: text.trim(), modelUsed: modelName };
      }
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes("404") || msg.includes("503")) continue;
      if (msg.includes("429") || msg.includes("quota")) {
        lastWas429 = true;
        continue;
      }
      throw err;
    }
  }

  if (lastWas429 && retryCount < 1) {
    const delay = Math.min(parseRetryDelay(lastError), 90);
    await sleep(delay);
    return generateWithFallback(prompt, retryCount + 1);
  }

  throw lastError || new Error("All Gemini models failed.");
}

/**
 * Compares candidate skills with job requirements and analyzes the gap.
 * @param {Array<string>} candidateSkills 
 * @param {Array<string>} jobSkills 
 * @returns {Promise<Object>} The skill gap analysis
 */
async function analyzeSkillGap(candidateSkills = [], jobSkills = []) {
  // 1. Identify matches and missing skills (case insensitive)
  const candidateLower = candidateSkills.map(s => s.toLowerCase().trim());
  const jobLower = jobSkills.map(s => s.toLowerCase().trim());

  const matchedSkills = [];
  const missingSkills = [];

  for (let i = 0; i < jobLower.length; i++) {
    const js = jobLower[i];
    if (candidateLower.includes(js)) {
      matchedSkills.push(jobSkills[i]); // Preserve original case
    } else {
      missingSkills.push(jobSkills[i]);
    }
  }

  // 2. Calculate Match Score
  const matchScore = jobSkills.length === 0 ? 100 : Math.round((matchedSkills.length / jobSkills.length) * 100);

  // 3. Generate Learning Suggestions (only if there are missing skills)
  let learningSuggestions = [];
  
  if (missingSkills.length > 0) {
    try {
      const prompt = `A software engineering candidate applied for a job but is missing the following required skills:
${missingSkills.join(", ")}

Please suggest 3-5 simple, actionable learning steps or small projects to help them improve these specific skills. 
Return ONLY a valid JSON array of strings. Do NOT include markdown blocks.
Example format:
[
  "Build a blog project with Next.js to learn server-side rendering",
  "Practice TypeScript by converting a small React project",
  "Take a crash course on Docker containers"
]
`;

      const { text } = await generateWithFallback(prompt);
      
      let jsonStr = text;
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();

      const firstBracket = jsonStr.indexOf('[');
      const lastBracket = jsonStr.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
      }

      learningSuggestions = JSON.parse(jsonStr);
      if (!Array.isArray(learningSuggestions)) {
        learningSuggestions = [];
      }
    } catch (error) {
      // output removed
      // Fallback suggestions
      learningSuggestions = missingSkills.map(skill => `Consider reviewing documentation and building a small project using ${skill}.`);
    }
  }

  return {
    matchedSkills,
    missingSkills,
    matchScore,
    learningSuggestions
  };
}

export { analyzeSkillGap };
