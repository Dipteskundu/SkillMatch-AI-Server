// services/aiSkillExtractionService.js
// Service to extract skills and experience from resume text using Gemini AI.
// Gemini access goes through services/llm.js (single client + fallback chain).
//
// Hardening (Phase 3):
//   • The prompt is built by services/injectionGuard.js — instructions and the
//     output schema live OUTSIDE <untrusted_document> delimiters, and the
//     delimited resume text is explicitly declared untrusted data.
//   • The model must return an `evidence` map (skill -> short verbatim quote)
//     for every extracted skill/technology.
//   • Injection flags detected by the guard are surfaced on the result so the
//     pipeline can store them on the resume document.
//
// Public API:
//   extractSkillsFromResume(resumeText, opts?) -> {
//     skills, experience_years, technologies, role_titles,
//     evidence, injectionFlags, suspicious
//   }

import { generateJSON } from "./llm.js";
import { sanitizeUntrustedText, buildExtractionPrompt } from "./injectionGuard.js";

// Duck-typed check (not `instanceof`): several test suites replace
// services/llm.js with a partial mock, so we must not rely on importing the
// LLMOutputError class — a missing named export would break their linking.
function isLlmOutputError(error) {
  return Boolean(error) && error.name === "LLMOutputError";
}

function uniqStrings(items) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    ),
  );
}

function parseQuotedItems(segment = "") {
  const out = [];
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(segment)) !== null) {
    out.push(match[1]);
  }
  return uniqStrings(out);
}

function salvageFromMalformedJson(rawText) {
  const skillsSeg = rawText.match(/"skills"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
  const techSeg = rawText.match(/"technologies"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
  const roleSeg = rawText.match(/"role_titles"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
  const yearsRaw = rawText.match(/"experience_years"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];

  return {
    skills: parseQuotedItems(skillsSeg),
    technologies: parseQuotedItems(techSeg),
    role_titles: parseQuotedItems(roleSeg),
    experience_years: Number(yearsRaw) || 0,
  };
}

function extractTechFallback(resumeText) {
  const knownTech = [
    "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "MongoDB",
    "PostgreSQL", "MySQL", "Firebase", "Python", "Java", "C++", "C", "Tailwind CSS",
    "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Redux", "HTML", "CSS",
  ];
  const lower = String(resumeText || "").toLowerCase();
  return knownTech.filter((t) => lower.includes(t.toLowerCase()));
}

/** Keep only string keys -> short string quotes; cap each quote length. */
function sanitizeEvidence(raw, maxQuote = 240) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key || "").trim();
    const v = String(value || "").trim();
    if (!k || !v) continue;
    out[k] = v.length > maxQuote ? `${v.slice(0, maxQuote)}…` : v;
  }
  return out;
}

/**
 * Extracts structured data (skills, experience, etc.) from raw resume text using AI.
 *
 * @param {string} resumeText - The raw text extracted from the resume
 * @param {Object} [opts]
 * @param {string} [opts.schemaDescription] - Override the output JSON schema description
 * @returns {Promise<Object>} The extracted skills profile (+ evidence + injection flags)
 */
async function extractSkillsFromResume(resumeText, { schemaDescription } = {}) {
  if (!resumeText || resumeText.trim() === '') {
    throw new Error('No resume text provided for extraction');
  }

  // Sanitize + fence the untrusted text once; the prompt builder keeps
  // instructions/schema OUTSIDE the delimiters.
  const guard = sanitizeUntrustedText(resumeText);
  const prompt = buildExtractionPrompt(guard.text, schemaDescription);

  let extractedData;
  try {
    extractedData = await generateJSON({
      prompt,
      temperature: 0.1, // Low temperature for more deterministic JSON extraction
      maxOutputTokens: 2048,
      promptTag: "resume.extraction",
    });
  } catch (error) {
    // Salvage whatever we can from malformed output; propagate real API/config errors.
    if (!isLlmOutputError(error)) throw error;
    console.error("Failed to parse Skill Extraction JSON:", error.message);
    const salvaged = salvageFromMalformedJson(String(error.raw || ""));
    const fallbackTech = extractTechFallback(resumeText);
    const mergedTech = uniqStrings([...(salvaged.technologies || []), ...fallbackTech]);

    return {
      skills: uniqStrings(salvaged.skills),
      experience_years: Number(salvaged.experience_years) || 0,
      technologies: mergedTech,
      role_titles: uniqStrings(salvaged.role_titles),
      evidence: {},
      injectionFlags: guard.flags,
      suspicious: guard.suspicious,
    };
  }

  // Normalize and ensure arrays exist
  return {
    skills: uniqStrings(extractedData.skills),
    experience_years: Number(extractedData.experience_years) || 0,
    technologies: uniqStrings(extractedData.technologies),
    role_titles: uniqStrings(extractedData.role_titles),
    evidence: sanitizeEvidence(extractedData.evidence),
    injectionFlags: guard.flags,
    suspicious: guard.suspicious,
  };
}

export { extractSkillsFromResume };
