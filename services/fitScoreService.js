// services/fitScoreService.js
// ─────────────────────────────────────────────────────────────────────────────
// DB glue around the PURE fit engine (services/fitScore.js). This is the only
// place that reads users/find_jobs/skill_tests/communicationTests and turns
// raw documents into computeFitScore() input.
//
// The engine itself never touches the DB or the LLM. Semantic embeddings are
// strictly optional (services/embeddings.js returns null when unavailable and
// the score degrades gracefully to taxonomy-only matching).
//
// Public API:
//   computeFitForDocs({ user, job, vocabulary, assessment, useEmbeddings })
//   computeFitForUserAndJob({ firebaseUid, jobId, ... })
//   computeFitForApplication(application, db?)
//   toAiScoreSubdocument(score)   -> raw `applications.aiScore` shape (Date computedAt)
//   toApiAiScore(aiScoreDoc)      -> API shape (ISO computedAt)
//   recomputeAiScoresForCandidate(firebaseUid, { db })
//   scheduleCandidateAiScoreRecompute(firebaseUid)   <- fire-and-forget helper
// ─────────────────────────────────────────────────────────────────────────────

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { computeFitScore, FIT_MODEL_VERSION } from "./fitScore.js";
import {
  canonicalizeSkill,
  loadSkillVocabulary,
  normalizeCandidateSkills,
  normalizeJobSkills,
} from "./skillNormalize.js";
import { embed, areEmbeddingsAvailable } from "./embeddings.js";

/** Application statuses that are terminal — never recomputed. */
const TERMINAL_STATUSES = ["rejected", "hired"];

/** Cap on texts we send to the embedding API per score (safety valve). */
const MAX_EMBEDDING_TEXTS = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Doc → engine input mapping (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Map a find_jobs document's experience requirement to {min,max}|null. */
export function experienceRangeFromJob(job) {
  const min = Number(job?.experienceMin);
  const max = Number(job?.experienceMax);
  if (Number.isFinite(min)) return { min, max: Number.isFinite(max) ? max : null };

  const level = String(job?.experienceLevel || "").toLowerCase().trim();
  if (!level) return null;
  if (/intern/.test(level)) return { min: 0, max: 1 };
  if (/junior|entry|graduate|fresher/.test(level)) return { min: 0, max: 2 };
  if (/mid|intermediate/.test(level)) return { min: 2, max: 5 };
  if (/lead|principal|staff|head|director|architect|manager/.test(level)) return { min: 8, max: null };
  if (/senior|sr\.?/.test(level)) return { min: 5, max: 9 };
  return null;
}

/** Map a find_jobs document's education requirement to a string|null. */
export function educationRequirementFromJob(job) {
  const raw = job?.education ?? job?.educationRequired ?? null;
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object") return raw.level || raw.degree || raw.qualification || null;
  return null;
}

/** Total years of experience from a user document (resume extraction aware). */
export function experienceYearsFromUser(user) {
  const explicit = Number(user?.yearsOfExperience);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const roles = Array.isArray(user?.experience) ? user?.experience : [];
  const summed = roles.reduce((sum, role) => sum + (Number(role?.years) || 0), 0);
  if (summed > 0) return Math.round(summed * 10) / 10;
  return roles.length > 0 ? roles.length : 0; // one year per role as a weak fallback
}

/**
 * Map a raw user document to the engine's candidate input.
 * `assessment` = { verifiedSkills:[], testScore, communicationScore } (already
 * gathered by loadAssessmentContext — kept as a parameter so this stays pure).
 */
export function mapUserToCandidate(user, { verifiedSkills = [], testScore = null, communicationScore = null, vocabulary = null } = {}) {
  const canon = (s) => canonicalizeSkill(s, vocabulary) || String(s ?? "").toLowerCase().trim();
  return {
    skills: normalizeCandidateSkills(user?.skills || [], { verifiedSkills: user?.verifiedSkills || [] }, vocabulary),
    experienceYears: experienceYearsFromUser(user),
    experienceRoles: (Array.isArray(user?.experience) ? user.experience : []).map((r) => r?.title || "").filter(Boolean),
    education: Array.isArray(user?.education) ? user.education : [],
    certifications: Array.isArray(user?.certificates) ? user.certificates : [],
    assessment: {
      verifiedSkills: (Array.isArray(user?.verifiedSkills) ? user.verifiedSkills : verifiedSkills).map(canon).filter(Boolean),
      testScore,
      communicationScore,
    },
    bonus: {
      github: Boolean(user?.github),
      portfolio: Boolean(user?.portfolioUrl),
      projectCount: Array.isArray(user?.projects) ? user.projects.length : 0,
    },
  };
}

/** Map a raw find_jobs document to the engine's job input. */
export function mapJobToEngineInput(job, vocabulary) {
  return {
    title: job?.title || "",
    requiredSkills: normalizeJobSkills(job?.skills || [], vocabulary),
    preferredSkills: normalizeJobSkills(job?.niceToHaveSkills || job?.preferredSkills || [], vocabulary),
    requiredExperience: experienceRangeFromJob(job),
    requiredEducation: educationRequirementFromJob(job),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assessment context (extra DB reads, best-effort)
// ─────────────────────────────────────────────────────────────────────────────

async function loadAssessmentContext(db, firebaseUid, application = null) {
  const context = { testScore: null, communicationScore: null };
  if (!db || !firebaseUid) return context;

  try {
    const latestTest = await db.collection("skill_tests")
      .findOne(
        { candidateId: firebaseUid, result: { $in: ["pass", "fail"] } },
        { sort: { completedAt: -1 } },
      );
    if (latestTest && Number.isFinite(Number(latestTest.score))) {
      context.testScore = Number(latestTest.score);
    }
  } catch (error) {
    console.warn("fitScoreService: skill_tests lookup failed:", error?.message || error);
  }

  const applicationScore = Number(application?.communicationScore);
  if (Number.isFinite(applicationScore) && application?.communicationScore !== null && application?.communicationScore !== undefined) {
    context.communicationScore = applicationScore;
  } else {
    try {
      const latest = await db.collection("communicationTests")
        .findOne({ candidateId: firebaseUid, status: "completed" }, { sort: { completedAt: -1 } });
      if (latest && Number.isFinite(Number(latest.score))) {
        context.communicationScore = Number(latest.score);
      }
    } catch (error) {
      console.warn("fitScoreService: communicationTests lookup failed:", error?.message || error);
    }
  }

  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional embeddings (graceful no-op when unavailable)
// ─────────────────────────────────────────────────────────────────────────────

async function buildEmbeddings(jobInput, candidateInput, vocabulary) {
  if (!areEmbeddingsAvailable()) return null;
  try {
    const display = (canonical) => vocabulary?.canonical?.[canonical]?.name || canonical;
    const jobTexts = jobInput.requiredSkills.concat(jobInput.preferredSkills).map((s) => s.canonical);
    const candidateTexts = candidateInput.skills.map((s) => s.canonical);
    const texts = [...new Set([...jobTexts, ...candidateTexts])].slice(0, MAX_EMBEDDING_TEXTS);
    if (texts.length === 0) return null;

    const vectors = await embed(texts.map(display));
    if (!vectors || vectors.length !== texts.length) return null;

    const job = {};
    const candidate = {};
    texts.forEach((canonical, i) => {
      if (jobTexts.includes(canonical)) job[canonical] = vectors[i];
      if (candidateTexts.includes(canonical)) candidate[canonical] = vectors[i];
    });
    return { job, candidate };
  } catch (error) {
    console.warn("fitScoreService: embeddings skipped:", error?.message || error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main compute entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a fit score from already-loaded raw docs. No LLM required.
 * @param {Object} input
 * @param {Object} input.user        raw users document
 * @param {Object} input.job         raw find_jobs document
 * @param {Object} [input.vocabulary] pre-loaded vocabulary (else starter/DB)
 * @param {Object} [input.assessment] { testScore, communicationScore }
 * @param {boolean} [input.useEmbeddings] attempt semantic matching (default false)
 */
export async function computeFitForDocs({ user, job, vocabulary = null, assessment = null, useEmbeddings = false } = {}) {
  const vocab = vocabulary || await loadSkillVocabulary();
  const candidate = mapUserToCandidate(user || {}, { ...(assessment || {}), vocabulary: vocab });
  const jobInput = mapJobToEngineInput(job || {}, vocab);

  let embeddings = null;
  if (useEmbeddings) {
    embeddings = await buildEmbeddings(jobInput, candidate, vocab);
  }

  return computeFitScore({ candidate, job: jobInput, vocabulary: vocab, embeddings });
}

/** Compute a fit score for a firebaseUid + jobId (loads docs from the DB). */
export async function computeFitForUserAndJob({ firebaseUid, jobId, db: providedDb = null, vocabulary = null, useEmbeddings = false } = {}) {
  const db = providedDb || getDB();
  const [user, job] = await Promise.all([
    db.collection("users").findOne({ firebaseUid }),
    db.collection("find_jobs").findOne({ _id: jobId instanceof ObjectId ? jobId : new ObjectId(String(jobId)) }),
  ]);
  const assessment = await loadAssessmentContext(db, firebaseUid, null);
  return computeFitForDocs({ user, job, vocabulary, assessment, useEmbeddings });
}

/** Compute the fit score for one application document (fresh assessment data). */
export async function computeFitForApplication(application, db = null) {
  if (!application) return null;
  const database = db || getDB();
  const [user, job] = await Promise.all([
    database.collection("users").findOne({ firebaseUid: application.firebaseUid }),
    database.collection("find_jobs").findOne({ _id: application.jobId }),
  ]);
  if (!user || !job) return null;
  const assessment = await loadAssessmentContext(database, application.firebaseUid, application);
  return computeFitForDocs({ user, job, assessment });
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage / API shape conversion
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a score object to the raw `applications.aiScore` subdocument. */
export function toAiScoreSubdocument(score) {
  if (!score) return null;
  return {
    total: score.total,
    breakdown: { ...score.breakdown },
    weights: { ...score.weights },
    evidence: (score.evidence || []).map((e) => ({
      factor: e.factor ?? "",
      // `quote` kept for the original Mongoose schema / legacy readers.
      quote: e.detail ?? "",
      label: e.label ?? "",
      detail: e.detail ?? "",
      source: e.source ?? "",
    })),
    matchedSkills: score.matchedSkills || [],
    adjacentSkills: score.adjacentSkills || [],
    missingSkills: score.missingSkills || [],
    noAssessment: Boolean(score.noAssessment),
    modelVersion: score.modelVersion || FIT_MODEL_VERSION,
    computedAt: score.computedAt ? new Date(score.computedAt) : new Date(),
  };
}

/** Convert a stored aiScore subdocument back to the API contract (ISO date). */
export function toApiAiScore(aiScoreDoc) {
  if (!aiScoreDoc) return null;
  return {
    ...aiScoreDoc,
    computedAt: aiScoreDoc.computedAt
      ? (aiScoreDoc.computedAt instanceof Date ? aiScoreDoc.computedAt.toISOString() : new Date(aiScoreDoc.computedAt).toISOString())
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recompute plumbing
// ─────────────────────────────────────────────────────────────────────────────

/** Recompute + store aiScore for one application. Best-effort; returns the score. */
export async function recomputeApplicationAiScore(application, db = null) {
  const database = db || getDB();
  const score = await computeFitForApplication(application, database);
  if (!score) return null;
  await database.collection("applications").updateOne(
    { _id: application._id },
    { $set: { aiScore: toAiScoreSubdocument(score), updatedAt: new Date() } },
  );
  return score;
}

/**
 * Recompute aiScore for every OPEN (non-terminal) application of a candidate.
 * Used when assessments complete or profile/resume skills change.
 */
export async function recomputeAiScoresForCandidate(firebaseUid, { db: providedDb = null } = {}) {
  const db = providedDb || getDB();
  const applications = await db.collection("applications")
    .find({ firebaseUid, status: { $nin: TERMINAL_STATUSES } })
    .toArray();

  let updated = 0;
  for (const application of applications) {
    try {
      const score = await recomputeApplicationAiScore(application, db);
      if (score) updated += 1;
    } catch (error) {
      console.error("fitScoreService: recompute failed for application", String(application._id), error?.message || error);
    }
  }
  return { considered: applications.length, updated };
}

/**
 * Fire-and-forget recompute (same pattern as the setImmediate notification
 * fan-outs). Errors are logged, never thrown into the request path.
 */
export function scheduleCandidateAiScoreRecompute(firebaseUid) {
  if (!firebaseUid) return;
  setImmediate(async () => {
    try {
      await recomputeAiScoresForCandidate(firebaseUid);
    } catch (error) {
      console.error("fitScoreService: scheduled aiScore recompute error:", error?.message || error);
    }
  });
}
