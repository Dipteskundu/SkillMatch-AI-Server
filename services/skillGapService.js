// services/skillGapService.js
// Compares candidate skills with job skills and generates AI learning suggestions.
//
// Phase 2: matched/missing/adjacent + matchScore now come from the ONE unified
// fit engine (services/fitScore.js) with alias/adjacency normalization
// (services/skillNormalize.js) — no more exact-lowercase-string comparison.
// The Gemini learning-suggestions part is unchanged and still degrades to
// deterministic suggestions when the LLM is down (services/llm.js).

import { generateJSON } from "./llm.js";
import { computeFitScore } from "./fitScore.js";
import {
  loadSkillVocabulary,
  normalizeCandidateSkills,
  normalizeJobSkills,
} from "./skillNormalize.js";

/**
 * Compares candidate skills with job requirements and analyzes the gap.
 * @param {Array<string>} candidateSkills
 * @param {Array<string>} jobSkills       required skills (raw strings)
 * @param {Array<string>} [preferredSkills] nice-to-have skills (raw strings)
 * @returns {Promise<Object>} The skill gap analysis:
 *   { matchedSkills, missingSkills, adjacentSkills, matchScore, learningSuggestions }
 *   (matched/missing preserve the original job-skill casing for display;
 *    matchScore = the engine's skillMatch component, 0-100)
 */
async function analyzeSkillGap(candidateSkills = [], jobSkills = [], preferredSkills = []) {
  // 1. Normalize both sides via the canonical skill vocabulary
  const vocabulary = await loadSkillVocabulary();
  const candidate = normalizeCandidateSkills(candidateSkills, {}, vocabulary);
  const required = normalizeJobSkills(jobSkills, vocabulary);
  const preferred = normalizeJobSkills(preferredSkills || [], vocabulary);

  // 2. One unified score (skillMatch component is the "match score" here).
  const score = computeFitScore({
    candidate: { skills: candidate },
    job: { requiredSkills: required, preferredSkills: preferred },
    vocabulary,
  });

  // 3. Preserve the original-case job skill strings for display + suggestions.
  const canonicalToOriginal = new Map();
  for (const item of required) {
    if (!canonicalToOriginal.has(item.canonical)) canonicalToOriginal.set(item.canonical, item.name);
  }
  const originalOf = (canonical) => canonicalToOriginal.get(canonical)
    || required.find((r) => r.canonical === canonical)?.name
    || canonical;

  const matchedSkills = score.matchedSkills.map(originalOf);
  const missingSkills = score.missingSkills.map(originalOf);
  const adjacentSkills = score.adjacentSkills.map((a) => ({
    candidateSkill: a.candidateSkill,
    jobSkill: originalOf(a.jobSkill),
    credit: a.credit,
    ...(a.semantic ? { semantic: true } : {}),
  }));

  // matchScore: skillMatch only (this endpoint has always been about skills).
  // With no skills on either side the engine returns a neutral 50, never 100.
  const matchScore = score.breakdown.skillMatch;

  // 4. Generate Learning Suggestions (only if there are missing skills)
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

      const suggestions = await generateJSON({
        prompt,
        temperature: 0.4,
        maxOutputTokens: 2048,
        promptTag: "skillgap.suggestions",
      });

      learningSuggestions = Array.isArray(suggestions)
        ? suggestions.map((s) => String(s))
        : [];
    } catch (error) {
      console.error("Failed to generate learning suggestions from AI:", error);
      // Fallback suggestions
      learningSuggestions = missingSkills.map(skill => `Consider reviewing documentation and building a small project using ${skill}.`);
    }
  }

  return {
    matchedSkills,
    missingSkills,
    adjacentSkills,
    matchScore,
    learningSuggestions,
  };
}

export { analyzeSkillGap };
