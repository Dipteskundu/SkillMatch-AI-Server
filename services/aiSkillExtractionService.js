// services/aiSkillExtractionService.js
// Service to extract skills and experience from resume text using Gemini AI

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Model priority list - same as other AI services
const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
];

const TECH_KEYWORDS = [
  "javascript",
  "typescript",
  "react",
  "next.js",
  "node.js",
  "express",
  "mongodb",
  "mysql",
  "postgresql",
  "python",
  "java",
  "c++",
  "c#",
  "firebase",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "tailwind",
  "html",
  "css",
  "git",
];

function fallbackExtractFromText(resumeText = "") {
  const lowerText = String(resumeText).toLowerCase();

  const technologies = TECH_KEYWORDS.filter((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  ).map((keyword) => keyword.replace(/\b\w/g, (char) => char.toUpperCase()));

  const roleCandidates = [
    "software engineer",
    "frontend developer",
    "backend developer",
    "full stack developer",
    "data analyst",
    "data scientist",
    "devops engineer",
    "qa engineer",
    "product manager",
  ];

  const role_titles = roleCandidates
    .filter((role) => lowerText.includes(role))
    .map((role) => role.replace(/\b\w/g, (char) => char.toUpperCase()));

  let experience_years = 0;
  const yearsMatch = lowerText.match(/(\d{1,2})\s*\+?\s*(years|yrs)/i);
  if (yearsMatch) {
    experience_years = Number(yearsMatch[1]) || 0;
  }

  return {
    skills: technologies,
    experience_years,
    technologies,
    role_titles,
  };
}

function getModel(modelName) {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.1, // Low temperature for more deterministic JSON extraction
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
        console.log(
          `✓ Successfully used model: ${modelName} for skill extraction`,
        );
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

  throw (
    lastError ||
    new Error(
      "All Gemini models failed. Try updating GEMINI_API_KEY or check your internet connection.",
    )
  );
}

/**
 * Extracts structured data (skills, experience, etc.) from raw resume text using AI.
 *
 * @param {string} resumeText - The raw text extracted from the resume
 * @returns {Promise<Object>} The extracted skills profile
 */
async function extractSkillsFromResume(resumeText) {
  if (!resumeText || resumeText.trim() === "") {
    throw new Error("No resume text provided for extraction");
  }

  const prompt = `You are an expert technical recruiter and resume parser.
Extract technical skills, tools, technologies, overall years of experience, and role titles from the following resume text.

Return ONLY a valid JSON object. Do NOT include markdown blocks, explanations, or any other text.
The JSON must follow this EXACT format:
{
  "skills": ["Array of general technical skills (e.g., Frontend Development, Backend Architecture)"],
  "experience_years": <number representing total years of experience, or 0 if not found>,
  "technologies": ["Array of specific tools, languages, and frameworks (e.g., React, JavaScript, Node.js, MongoDB)"],
  "role_titles": ["Array of job titles found in the experience section"]
}

Resume Text:
"""
${resumeText.substring(0, 15000)} /* Truncate to avoid exceeding token limits if it's unreasonably long */
"""
`;

  let text = "";
  try {
    const result = await generateWithFallback(prompt);
    text = result.text;
  } catch (error) {
    console.warn(
      "AI extraction unavailable, using fallback extraction:",
      error?.message || error,
    );
    return fallbackExtractFromText(resumeText);
  }

  // Parse JSON handling potential markdown wrappers
  let jsonStr = text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1].trim();

  // Clean up any stray text outside JSON brackets
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  try {
    const extractedData = JSON.parse(jsonStr);

    // Normalize and ensure arrays exist
    return {
      skills: Array.isArray(extractedData.skills) ? extractedData.skills : [],
      experience_years: Number(extractedData.experience_years) || 0,
      technologies: Array.isArray(extractedData.technologies)
        ? extractedData.technologies
        : [],
      role_titles: Array.isArray(extractedData.role_titles)
        ? extractedData.role_titles
        : [],
    };
  } catch (error) {
    console.error("Failed to parse Skill Extraction JSON:", text);
    return fallbackExtractFromText(resumeText);
  }
}

export { extractSkillsFromResume };
