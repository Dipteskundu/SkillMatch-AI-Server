// services/resumePipeline.js
// ─────────────────────────────────────────────────────────────────────────────
// The resume-extraction pipeline, shared by the async job worker
// (`resume.extract`) and the backward-compatible sync upload path.
//
// Stages:
//   1. Parse the file bytes -> raw text (pdf-parse / mammoth / utf8).
//   2. Prompt-injection guard (services/injectionGuard.js): sanitize + fence;
//      instruction-override patterns are FLAGGED, not dropped — flagged
//      resumes are still extracted, but stored with
//      extractionStatus: "suspicious" + the matched pattern ids.
//   3. LLM extraction (services/aiSkillExtractionService.js) with evidence
//      quotes; falls back to keyword extraction when the AI is unavailable.
//   4. Skill normalization (services/skillNormalize.js): raw + canonical
//      (alias-resolved) names are both stored.
//   5. Optional embedding of the canonical skill set (services/embeddings.js;
//      skipped when it returns null).
//   6. Merge skills into the candidate's `users` doc (same merge as before).
//   7. Persist everything on the `resumes` doc
//      (extractionStatus, injectionFlags, normalizedSkills, processedAt, …).
//
// Public API:
//   runResumePipeline({ resumeId, candidateId, file }) -> outcome
//   resumeExtractHandler(payload, ctx)                 -> job result summary
// ─────────────────────────────────────────────────────────────────────────────

import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";
import { extractTextFromResume } from "./resumeParserService.js";
import { extractSkillsFromResume } from "./aiSkillExtractionService.js";
import { sanitizeUntrustedText } from "./injectionGuard.js";
import { loadSkillVocabulary, canonicalizeSkill, normalizeKey } from "./skillNormalize.js";
import { embed } from "./embeddings.js";
import { scheduleCandidateAiScoreRecompute } from "./fitScoreService.js";

function uniqStrings(items) {
  return Array.from(
    new Set((Array.isArray(items) ? items : []).map((v) => String(v || "").trim()).filter(Boolean)),
  );
}

/** Job payloads carry resumeId as a string; the raw driver stores an ObjectId. */
function coerceResumeId(value) {
  if (!value) return value;
  if (typeof value === "string" && ObjectId.isValid(value)) return new ObjectId(value);
  return value;
}

/** Keyword fallback used when the LLM is unavailable (same list as before). */
function extractFallbackFromText(text) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const knownTech = [
    "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "MongoDB",
    "PostgreSQL", "MySQL", "Firebase", "Python", "Java", "C++", "C", "Tailwind CSS",
    "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Redux", "HTML", "CSS",
  ];
  const technologies = knownTech.filter((t) => lower.includes(t.toLowerCase()));

  return {
    skills: technologies,
    experience_years: 0,
    technologies,
    role_titles: [],
    evidence: {},
  };
}

/** Raw driver may return a BSON Binary for the stored file buffer. */
function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value._bsontype === "Binary" && value.buffer) return Buffer.from(value.buffer);
  if (value.buffer && (Buffer.isBuffer(value.buffer) || ArrayBuffer.isView(value.buffer))) {
    return Buffer.from(value.buffer);
  }
  if (value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/**
 * Map raw extracted skills/technologies to canonical names (alias-resolved,
 * deduped). Unmatched strings fall back to the normalized raw name.
 */
function normalizeSkillNames(rawSkills, vocabulary) {
  const out = [];
  const seen = new Set();
  for (const name of rawSkills) {
    const canonical = canonicalizeSkill(name, vocabulary) || normalizeKey(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/**
 * Run the full pipeline for one resume.
 *
 * @param {Object} args
 * @param {string|Object} [args.resumeId] existing resumes doc id (async path)
 * @param {string} args.candidateId firebaseUid of the candidate
 * @param {Object} [args.file] multer-style file { buffer, originalname, mimetype, size }
 *   — provided on the sync upload path (async path loads bytes from the doc)
 * @returns {Promise<Object>} outcome {
 *   resumeId, status: "done"|"suspicious"|"failed", warning?, error?,
 *   skills, technologies, experience_years, role_titles, evidence,
 *   injectionFlags, normalizedSkills, skillEmbedding?
 * }
 */
async function runResumePipeline({ resumeId, candidateId, file }) {
  const db = getDB();
  const resumesCollection = db.collection("resumes");
  const usersCollection = db.collection("users");

  // Resolve the resume doc + file bytes.
  let doc = null;
  if (resumeId) {
    resumeId = coerceResumeId(resumeId);
    doc = await resumesCollection.findOne({ _id: resumeId });
    if (!doc) throw new Error(`Resume ${resumeId} not found`);
    if (!file) {
      const buffer = toBuffer(doc.fileBuffer);
      if (!buffer) throw new Error(`Resume ${resumeId} has no stored file data`);
      file = {
        buffer,
        originalname: doc.originalName,
        mimetype: doc.mimeType,
        size: doc.size,
      };
    }
  }
  const originalName = file?.originalname || doc?.originalName || "";
  const mimeType = file?.mimetype || doc?.mimeType || "";

  // 1. Parse.
  let extractedText;
  try {
    extractedText = await extractTextFromResume(file);
  } catch (parseError) {
    const error = parseError?.message || String(parseError);
    if (doc || resumeId) {
      await resumesCollection
        .updateOne(
          { _id: doc?._id ?? resumeId },
          {
            $set: {
              extractionStatus: "failed",
              error,
              processedAt: new Date(),
              updatedAt: new Date(),
            },
            $unset: { fileBuffer: "" },
          },
        )
        .catch(() => {});
    }
    return {
      resumeId: doc?._id ?? resumeId ?? null,
      candidateId,
      status: "failed",
      error,
      skills: [],
      technologies: [],
      experience_years: 0,
      role_titles: [],
      evidence: {},
      injectionFlags: [],
      normalizedSkills: [],
      originalName,
      mimeType,
    };
  }

  // 2+3. Guard + AI extraction (the service fences the prompt itself and
  // returns the guard's flags on every path, including salvage).
  const guard = sanitizeUntrustedText(extractedText);
  let extractedData;
  let warning = "";
  try {
    extractedData = await extractSkillsFromResume(extractedText);
  } catch (aiError) {
    console.error("AI extraction failed, using fallback extraction:", aiError?.message || aiError);
    extractedData = extractFallbackFromText(extractedText);
    warning = "AI extraction was unavailable, so basic keyword extraction was used.";
  }

  const skills = uniqStrings(extractedData.skills);
  const technologies = uniqStrings(extractedData.technologies);
  const role_titles = uniqStrings(extractedData.role_titles);
  const experience_years = Number(extractedData.experience_years) || 0;
  const evidence = extractedData.evidence && typeof extractedData.evidence === "object"
    ? extractedData.evidence
    : {};
  // Flags are detected on the RAW text by the guard above (authoritative even
  // when the LLM fell back).
  const injectionFlags = guard.flags;
  const suspicious = guard.suspicious;

  // 4. Normalize: store both raw and canonical (alias-resolved) names.
  const vocabulary = await loadSkillVocabulary();
  const normalizedSkills = normalizeSkillNames([...skills, ...technologies], vocabulary);

  // 5. Optional embedding of the canonical skill set (null -> skipped).
  let skillEmbedding = null;
  if (normalizedSkills.length > 0) {
    try {
      const vectors = await embed([normalizedSkills.join(", ")]);
      if (Array.isArray(vectors) && Array.isArray(vectors[0])) skillEmbedding = vectors[0];
    } catch (embedError) {
      console.warn("resumePipeline: embedding skipped:", embedError?.message || embedError);
    }
  }

  // 6. Merge skills into the candidate profile (same merge as before).
  const candidate = await usersCollection.findOne({ firebaseUid: candidateId });
  const existingSkills = Array.isArray(candidate?.skills) ? candidate.skills : [];
  const combinedSkills = Array.from(new Set([...existingSkills, ...skills, ...technologies]));
  await usersCollection.updateOne(
    { firebaseUid: candidateId },
    {
      $set: {
        resumeUploaded: true,
        skills: combinedSkills,
        yearsOfExperience: experience_years,
        updatedAt: new Date(),
      },
    },
  );

  // Refresh Hiring Fit Scores on open applications (best-effort).
  scheduleCandidateAiScoreRecompute(candidateId);

  // 7. Persist the resume doc.
  const extractionStatus = suspicious ? "suspicious" : "done";
  const resumeDoc = {
    candidateId,
    originalName,
    mimeType,
    size: file?.size ?? doc?.size ?? 0,
    extractedText,
    extractedSkills: skills,
    extractedExperience: experience_years,
    extractedTechnologies: technologies,
    extractedRoles: role_titles,
    skillEvidence: evidence,
    normalizedSkills,
    injectionFlags,
    extractionStatus,
    processedAt: new Date(),
    updatedAt: new Date(),
  };
  if (skillEmbedding) resumeDoc.skillEmbedding = skillEmbedding;

  let storedId = doc?._id ?? null;
  if (doc || resumeId) {
    await resumesCollection.updateOne(
      { _id: doc?._id ?? resumeId },
      { $set: resumeDoc, $unset: { fileBuffer: "" } }, // bytes leave the DB once parsed
    );
    storedId = doc?._id ?? resumeId;
  } else {
    resumeDoc.createdAt = new Date();
    const { insertedId } = await resumesCollection.insertOne(resumeDoc);
    storedId = insertedId;
  }

  return {
    resumeId: storedId,
    candidateId,
    status: extractionStatus,
    warning: warning || undefined,
    skills,
    technologies,
    experience_years,
    role_titles,
    evidence,
    injectionFlags,
    normalizedSkills,
    skillEmbedding: skillEmbedding || undefined,
    originalName,
    mimeType,
  };
}

/**
 * `resume.extract` job worker. Payload: { resumeId, candidateId }.
 * The resume doc must already exist with a `fileBuffer` (written at upload).
 */
async function resumeExtractHandler(payload) {
  const resumeId = payload?.resumeId;
  const candidateId = payload?.candidateId;
  if (!resumeId || !candidateId) {
    throw new Error("resume.extract payload requires resumeId and candidateId");
  }

  const outcome = await runResumePipeline({ resumeId, candidateId });

  // Surface a failed pipeline to the queue (retried once, then marked failed).
  if (outcome.status === "failed") {
    throw new Error(outcome.error || "Resume extraction failed");
  }

  return {
    resumeId: String(outcome.resumeId),
    status: outcome.status,
    skills: outcome.skills.length,
    technologies: outcome.technologies.length,
    normalizedSkills: outcome.normalizedSkills.length,
    suspicious: outcome.status === "suspicious",
  };
}

export { runResumePipeline, resumeExtractHandler };
