// services/aiQuestionService.js

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
];

function getModel(modelName) {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
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
      const response = result.response;
      const text = response.text();
      
      if (text && text.trim()) {
        console.log(`✓ Successfully used model: ${modelName} for questions`);
        return { text: text.trim(), modelUsed: modelName };
      }
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err).toLowerCase();
      const is404 = msg.includes("404") || msg.includes("not found");
      const is503 = msg.includes("503") || msg.includes("unavailable");
      const is429 = msg.includes("429") || msg.includes("too many requests") || msg.includes("quota exceeded");

      if (is404 || is503) {
        continue;
      }
      if (is429) {
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

  throw lastError || new Error("All Gemini models failed. Try updating GEMINI_API_KEY or check your internet connection.");
}

/**
 * Generate beginner-friendly MCQ questions for up to 3 skills (3 per skill)
 */
async function generateSkillQuestions(skillsArray) {
  const skills = Array.isArray(skillsArray) ? skillsArray.slice(0, 3) : [skillsArray];
  if (skills.length === 0) throw new Error("At least one skill is required");
  const skillsList = skills.join(", ");

  const prompt = `Generate beginner-friendly multiple choice technical questions for the following skills: ${skillsList}.

Requirements:
- For EACH skill, generate exactly 3 questions.
- Total questions should be exactly ${skills.length * 3}.
- Keep all questions EASY to MODERATE level for entry-level candidates.
- Use simple English and practical basics.
- NO trick questions.
- Keep questions short.
- Return ONLY a valid JSON array. Each object must have:
  - "id" (string)
  - "text" (string)
  - "difficulty" (string, use "Simple" or "Medium" only)
  - "skill" (string)
  - "options" (array of exactly 4 short strings)
  - "correctAnswer" (string, must exactly match one item from options)

Example JSON format:
[
  {
    "id": "q1",
    "text": "What is the main purpose of a React component?",
    "difficulty": "Simple",
    "skill": "React",
    "options": ["Store files", "Build reusable UI parts", "Compile JavaScript", "Manage DNS"],
    "correctAnswer": "Build reusable UI parts"
  }
]

Return ONLY the JSON array, no markdown, no extra text.`;

  const { text } = await generateWithFallback(prompt);

  // Parse JSON
  let jsonStr = text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1].trim();

  try {
    const questions = JSON.parse(jsonStr);
    if (!Array.isArray(questions)) {
      throw new Error("Invalid question format from AI");
    }
    return questions.map((q, i) => {
      const options = Array.isArray(q.options)
        ? q.options
            .map((opt) => String(opt || "").trim())
            .filter(Boolean)
            .slice(0, 4)
        : [];

      const normalizedDifficulty =
        String(q.difficulty || "").toLowerCase() === "simple" ? "Simple" : "Medium";

      const fallbackOptions = ["Option A", "Option B", "Option C", "Option D"];
      const finalOptions = options.length === 4 ? options : fallbackOptions;
      const givenCorrect = String(q.correctAnswer || "").trim();
      const correctAnswer = finalOptions.includes(givenCorrect) ? givenCorrect : finalOptions[0];

      return {
        id: q.id || `q${i + 1}`,
        text: q.text || "",
        difficulty: normalizedDifficulty,
        skill: q.skill || skills[0],
        options: finalOptions,
        correctAnswer,
      };
    });
  } catch (error) {
    console.error("Failed to parse Skill Questions JSON", error);
    throw new Error("Failed to parse questions from AI");
  }
}

export { generateSkillQuestions };
