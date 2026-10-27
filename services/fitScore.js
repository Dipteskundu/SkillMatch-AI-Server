// services/fitScore.js
// ─────────────────────────────────────────────────────────────────────────────
// THE unified Hiring Fit Score engine (PLAN §4 Tier-1 #1, proposal §10).
//
// Pure, deterministic, testable: NO database, NO network, NO LLM inside this
// module. All inputs are plain data (already normalized by
// services/skillNormalize.js); all randomness is banned — same inputs always
// produce the same output (except `computedAt`, which can be pinned via `now`).
//
// Public API:
//   computeFitScore({ candidate, job, vocabulary?, embeddings?, now? }) -> score
//   redistributeWeights(baseWeights, activeFactors) -> effective 0-100 weights
//   cosineSimilarity(a, b) -> -1..1
//   educationRank(text) -> 0..5
//   FIT_MODEL_VERSION, BASE_WEIGHTS, ADJACENT_SKILL_CREDIT, ...
//
// Model (proposal §10, components each 0-100):
//   skillMatch 45% · assessment 25% · experience 15% · education 10% · additional 5%
//
// Documented policies (NOT silent zeros):
//   • A factor that cannot be evaluated is `null` in the breakdown and its
//     weight is REDISTRIBUTED proportionally across the remaining factors
//     (see redistributeWeights). This applies to:
//       - education  … when the job states no education requirement.
//       - experience … when the job states no experience requirement.
//       - assessment … when the candidate has no assessment/verification data
//                      (`noAssessment: true` in the output).
//       - additional … when the candidate has no bonus-signal data at all.
//   • Skill matching is three-tier:
//       1. exact canonical match           -> full credit (1.0 × skill weight)
//       2. adjacent match (Skill graph)    -> ADJACENT_SKILL_CREDIT (0.6)
//       3. semantic match (embeddings,     -> 0.5 × cosine, only when
//          optional, off by default)          cosine > SEMANTIC_SIMILARITY_THRESHOLD
//     Missing skills always score 0 — a job category is NEVER auto-awarded
//     (fixes the old "no nice-to-have skills -> automatic 20/20" bug).
//   • skillMatch blends required (70%) and preferred/nice-to-have (30%) when
//     both exist. A job with preferred skills only uses the preferred
//     sub-score. A job with NO skills at all gets a neutral 50 (evidence
//     says so) — it can never silently yield 100.
//   • total = round(Σ component × effectiveWeight / 100) — integer 0-100.
// ─────────────────────────────────────────────────────────────────────────────

export const FIT_MODEL_VERSION = "fit-v1";

/** Base weights (proposal §10). Sum = 100. */
export const BASE_WEIGHTS = Object.freeze({
  skillMatch: 45,
  assessment: 25,
  experience: 15,
  education: 10,
  additional: 5,
});

export const FACTORS = Object.freeze([
  "skillMatch",
  "assessment",
  "experience",
  "education",
  "additional",
]);

/** Partial credit for a skill matched via the Skill.adjacency graph. */
export const ADJACENT_SKILL_CREDIT = 0.6;

/** Semantic (embedding) matching: only above this cosine similarity … */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.8;
/** … and then credit = SEMANTIC_CREDIT_FACTOR × cosine (0.5 at cosine 1.0). */
export const SEMANTIC_CREDIT_FACTOR = 0.5;

/** Required vs preferred blend inside skillMatch. */
export const REQUIRED_SKILL_SHARE = 0.7;
export const PREFERRED_SKILL_SHARE = 0.3;

/** Neutral (never full) score when a job lists no skills at all. */
export const NO_SKILLS_NEUTRAL_SCORE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────────

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Cosine similarity of two equal-length numeric vectors (-1..1, 0 on error). */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Education level rank from free text (0 = none/unknown, 5 = doctorate).
 * Used for both job requirement and candidate degrees.
 */
export function educationRank(text) {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return 0;
  if (/\b(ph\.?\s?d|doctorate|doctoral)\b/.test(s)) return 5;
  if (/\b(master|mba|m\.?\s?sc|m\.?\s?a\b|magister|msc)\b/.test(s)) return 4;
  if (/\b(bachelor|b\.?\s?tech|b\.?\s?sc|b\.?\s?a\b|beng|undergrad)\b/.test(s)) return 3;
  if (/\b(associate|diploma)\b/.test(s)) return 2;
  if (/\b(high\s?school|secondary|hsc|ssc|12th)\b/.test(s)) return 1;
  return 0;
}

const EDUCATION_RANK_LABELS = ["none", "high school", "associate", "bachelor", "master", "doctorate"];

/**
 * Effective weights after redistributing every inactive (null) factor's weight
 * proportionally across the active factors. Inactive factors get weight 0
 * (visible in the output — their share went to the others). Largest-remainder
 * rounding: the returned integers always sum to exactly 100 when at least one
 * factor is active.
 */
export function redistributeWeights(baseWeights = BASE_WEIGHTS, activeFactors = FACTORS) {
  const active = (Array.isArray(activeFactors) && activeFactors.length ? activeFactors : FACTORS)
    .filter((f) => baseWeights[f] > 0);
  const baseTotal = active.reduce((sum, f) => sum + baseWeights[f], 0);

  const weights = {};
  for (const factor of FACTORS) weights[factor] = 0;
  if (baseTotal === 0) return weights;

  // Raw proportional shares, then largest-remainder rounding to sum 100.
  const shares = active.map((f) => ({ f, raw: (baseWeights[f] / baseTotal) * 100 }));
  let assigned = 0;
  for (const share of shares) {
    weights[share.f] = Math.floor(share.raw);
    assigned += weights[share.f];
  }
  const remainder = 100 - assigned;
  shares
    .sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)))
    .slice(0, remainder)
    .forEach((share) => { weights[share.f] += 1; });
  return weights;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStr(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function lowerKey(value) {
  return toStr(value).toLowerCase().trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill matching (three tiers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build adjacency lookup from the normalized vocabulary
 * ({ adjacency: { [canonical]: [canonical, ...] } }) into a bidirectional Set map.
 */
function buildAdjacencyMap(vocabulary) {
  const map = new Map(); // canonical -> Set<canonical>
  const add = (from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    if (from !== to) map.get(from).add(to);
  };
  const raw = vocabulary?.adjacency || {};
  for (const [key, neighbors] of Object.entries(raw)) {
    const from = lowerKey(key);
    for (const neighbor of asArray(neighbors)) {
      const to = lowerKey(neighbor);
      if (!from || !to) continue;
      add(from, to);
      add(to, from); // the seeded graph is directional; treat it as bidirectional
    }
  }
  return map;
}

/**
 * Find the best match for one job skill among candidate skills.
 * @returns {{ credit: number, candidateSkill: string|null, type: "exact"|"adjacent"|"semantic"|"missing" }}
 */
function matchJobSkill(jobSkill, candidateByCanonical, adjacencyMap, embeddings) {
  const target = lowerKey(jobSkill?.canonical || jobSkill?.name);
  if (!target) return { credit: 0, candidateSkill: null, type: "missing" };

  // Tier 1: exact canonical match (aliases already resolved upstream).
  if (candidateByCanonical.has(target)) {
    return { credit: 1, candidateSkill: target, type: "exact" };
  }

  // Tier 2: adjacency graph (bidirectional).
  const neighbors = adjacencyMap.get(target);
  if (neighbors) {
    for (const candidateCanonical of candidateByCanonical.keys()) {
      if (neighbors.has(candidateCanonical)) {
        return { credit: ADJACENT_SKILL_CREDIT, candidateSkill: candidateCanonical, type: "adjacent" };
      }
    }
  }

  // Tier 3 (optional): embedding cosine over candidate skills (the exact
  // tier already failed for this job skill, so every candidate skill counts).
  if (embeddings?.job?.[target]) {
    const jobVector = embeddings.job[target];
    let best = null;
    for (const [candidateCanonical, candidateVector] of Object.entries(embeddings.candidate || {})) {
      const similarity = cosineSimilarity(jobVector, candidateVector);
      if (similarity > SEMANTIC_SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
        best = { candidateCanonical, similarity };
      }
    }
    if (best) {
      return {
        credit: round2(SEMANTIC_CREDIT_FACTOR * best.similarity),
        candidateSkill: best.candidateCanonical,
        type: "semantic",
      };
    }
  }

  return { credit: 0, candidateSkill: null, type: "missing" };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Score a list of normalized job skills (required or preferred).
 * @returns {{ earnedWeight, totalWeight, matches: [], exact: [], missing: [] }}
 */
function scoreSkillList(jobSkills, candidateByCanonical, adjacencyMap, embeddings) {
  let earnedWeight = 0;
  let totalWeight = 0;
  const matches = [];
  const exact = [];
  const missing = [];

  for (const jobSkill of asArray(jobSkills)) {
    const name = lowerKey(jobSkill?.canonical || jobSkill?.name);
    if (!name) continue;
    const weight = Number(jobSkill?.weight) > 0 ? Number(jobSkill.weight) : 1;
    totalWeight += weight;

    const match = matchJobSkill(jobSkill, candidateByCanonical, adjacencyMap, embeddings);
    earnedWeight += weight * match.credit;
    matches.push({ jobSkill: name, ...match });
    if (match.type === "exact") exact.push(name);
    else if (match.credit === 0) missing.push(name);
  }

  return { earnedWeight, totalWeight, matches, exact, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component scorers (each returns { value: 0-100 | null, evidence, notes })
// ─────────────────────────────────────────────────────────────────────────────

function scoreSkillMatch(candidate, job, adjacencyMap, embeddings) {
  const required = scoreSkillList(job.requiredSkills, candidateByCanonical(candidate), adjacencyMap, embeddings);
  const preferred = scoreSkillList(job.preferredSkills, candidateByCanonical(candidate), adjacencyMap, embeddings);

  const hasRequired = required.totalWeight > 0;
  const hasPreferred = preferred.totalWeight > 0;

  const evidence = [];
  let value;

  if (hasRequired && hasPreferred) {
    const requiredScore = (required.earnedWeight / required.totalWeight) * 100;
    const preferredScore = (preferred.earnedWeight / preferred.totalWeight) * 100;
    value = REQUIRED_SKILL_SHARE * requiredScore + PREFERRED_SKILL_SHARE * preferredScore;
    evidence.push({
      factor: "skillMatch",
      label: "Required skills",
      detail: `${required.exact.length} of ${countSkills(job.requiredSkills)} matched` + describePartial(required),
      source: "profile",
    });
    evidence.push({
      factor: "skillMatch",
      label: "Nice-to-have skills",
      detail: `${preferred.exact.length} of ${countSkills(job.preferredSkills)} matched` + describePartial(preferred),
      source: "profile",
    });
  } else if (hasRequired) {
    value = (required.earnedWeight / required.totalWeight) * 100;
    evidence.push({
      factor: "skillMatch",
      label: "Required skills",
      detail: `${required.exact.length} of ${countSkills(job.requiredSkills)} matched` + describePartial(required),
      source: "profile",
    });
  } else if (hasPreferred) {
    value = (preferred.earnedWeight / preferred.totalWeight) * 100;
    evidence.push({
      factor: "skillMatch",
      label: "Nice-to-have skills",
      detail: `${preferred.exact.length} of ${countSkills(job.preferredSkills)} matched` + describePartial(preferred),
      source: "profile",
    });
    evidence.push({
      factor: "skillMatch",
      label: "No required skills",
      detail: "This job lists no required skills — the nice-to-have sub-score is used.",
      source: "job",
    });
  } else {
    // No skills listed on the job at all: neutral, never full marks.
    value = NO_SKILLS_NEUTRAL_SCORE;
    evidence.push({
      factor: "skillMatch",
      label: "Skills match",
      detail: "Job lists no skills — neutral score applied (never a free 100).",
      source: "job",
    });
  }

  const adjacentSkills = [...required.matches, ...preferred.matches]
    .filter((m) => m.type === "adjacent" || m.type === "semantic")
    .map((m) => ({
      candidateSkill: m.candidateSkill,
      jobSkill: m.jobSkill,
      credit: round2(m.credit),
      ...(m.type === "semantic" ? { semantic: true } : {}),
    }));

  return {
    value: clamp01(Math.round(value)),
    evidence,
    matchedSkills: required.exact,
    adjacentSkills,
    missingSkills: required.missing,
  };
}

function countSkills(list) {
  return asArray(list).filter((s) => lowerKey(s?.canonical || s?.name)).length;
}

function describePartial(result) {
  const adjacent = result.matches.filter((m) => m.type === "adjacent").length;
  const semantic = result.matches.filter((m) => m.type === "semantic").length;
  const parts = [];
  if (adjacent) parts.push(`${adjacent} adjacent`);
  if (semantic) parts.push(`${semantic} semantic`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

let canonicalCache = new WeakMap();
function candidateByCanonical(candidate) {
  let map = canonicalCache.get(candidate);
  if (map) return map;
  map = new Map();
  for (const skill of asArray(candidate?.skills)) {
    const key = lowerKey(skill?.canonical || skill?.name);
    if (key && !map.has(key)) map.set(key, skill);
  }
  canonicalCache.set(candidate, map);
  return map;
}

function scoreAssessment(candidate, job) {
  const assessment = candidate?.assessment || {};
  const verifiedSkills = asArray(assessment.verifiedSkills).map(lowerKey).filter(Boolean);
  const testScore = Number.isFinite(Number(assessment.testScore)) && assessment.testScore !== null && assessment.testScore !== undefined && assessment.testScore !== ""
    ? clamp01(Number(assessment.testScore))
    : null;
  const communicationScore = Number.isFinite(Number(assessment.communicationScore)) && assessment.communicationScore !== null && assessment.communicationScore !== undefined && assessment.communicationScore !== ""
    ? clamp01(Number(assessment.communicationScore))
    : null;

  const jobSkillSet = new Set(
    [...asArray(job.requiredSkills), ...asArray(job.preferredSkills)]
      .map((s) => lowerKey(s?.canonical || s?.name))
      .filter(Boolean),
  );

  const signals = [];
  const evidence = [];

  if (verifiedSkills.length > 0 && jobSkillSet.size > 0) {
    let covered = 0;
    for (const canonical of jobSkillSet) if (verifiedSkills.includes(canonical)) covered += 1;
    const coverage = Math.round((covered / jobSkillSet.size) * 100);
    signals.push(coverage);
    const verifiedNames = [...jobSkillSet].filter((s) => verifiedSkills.includes(s));
    evidence.push({
      factor: "assessment",
      label: "Verified skills",
      detail: verifiedNames.length
        ? `Verified: ${verifiedNames.join(", ")} (${covered}/${jobSkillSet.size} job skills)`
        : `${verifiedSkills.length} verified skill(s) on profile, none required by this job`,
      source: "assessment",
    });
  } else if (verifiedSkills.length > 0) {
    // Candidate has verified skills but the job lists none — still a signal.
    signals.push(100);
    evidence.push({
      factor: "assessment",
      label: "Verified skills",
      detail: `${verifiedSkills.length} skill(s) verified by assessment`,
      source: "assessment",
    });
  }

  if (testScore !== null) {
    signals.push(testScore);
    evidence.push({
      factor: "assessment",
      label: "Skill test",
      detail: `Latest skill-test score: ${Math.round(testScore)}/100`,
      source: "assessment",
    });
  }

  if (communicationScore !== null) {
    signals.push(communicationScore);
    evidence.push({
      factor: "assessment",
      label: "Communication assessment",
      detail: `Communication score: ${Math.round(communicationScore)}/100`,
      source: "assessment",
    });
  }

  if (signals.length === 0) {
    return {
      value: null,
      noAssessment: true,
      evidence: [{
        factor: "assessment",
        label: "Assessment",
        detail: "No assessment or verified skills yet — weight redistributed. Take a skill test to boost your score.",
        source: "assessment",
      }],
    };
  }

  const average = signals.reduce((a, b) => a + b, 0) / signals.length;
  return { value: clamp01(Math.round(average)), noAssessment: false, evidence };
}

function scoreExperience(candidate, job) {
  const required = job?.requiredExperience;
  if (!required || !Number.isFinite(Number(required.min))) {
    return {
      value: null,
      evidence: [{
        factor: "experience",
        label: "Experience",
        detail: "This job states no experience requirement — weight redistributed.",
        source: "job",
      }],
    };
  }

  const min = Math.max(0, Number(required.min) || 0);
  const max = Number.isFinite(Number(required.max)) ? Number(required.max) : null;
  const years = Number.isFinite(Number(candidate?.experienceYears)) ? Math.max(0, Number(candidate.experienceYears)) : 0;
  const provided = Number.isFinite(Number(candidate?.experienceYears));

  const rangeLabel = max !== null ? `${min}–${max}` : `${min}+`;
  let value;
  if (years >= min) {
    // Meeting (or exceeding) the requirement is a full pass; overqualification
    // never lowers fit.
    value = 100;
  } else if (min <= 0) {
    value = 100;
  } else {
    // Piecewise: linear 0 → 100 between 0 and the required minimum.
    value = (years / min) * 100;
  }

  return {
    value: clamp01(Math.round(value)),
    evidence: [{
      factor: "experience",
      label: "Experience",
      detail: provided
        ? `${years} year(s) on profile vs ${rangeLabel} required`
        : `No experience on profile (counted as 0) vs ${rangeLabel} required`,
      source: provided ? "profile" : "job",
    }],
  };
}

function scoreEducation(candidate, job) {
  const requiredRaw = job?.requiredEducation;
  const requiredText = typeof requiredRaw === "string" ? requiredRaw : requiredRaw?.level || requiredRaw?.degree || "";
  if (!toStr(requiredText).trim()) {
    return {
      value: null,
      evidence: [{
        factor: "education",
        label: "Education",
        detail: "This job states no education requirement — weight redistributed.",
        source: "job",
      }],
    };
  }

  const requiredRank = educationRank(requiredText);
  let best = { rank: 0, label: "" };
  for (const entry of asArray(candidate?.education)) {
    const text = typeof entry === "string" ? entry : entry?.degree || entry?.degreeName || entry?.qualification || "";
    const rank = educationRank(text);
    if (rank > best.rank) best = { rank, label: toStr(text).trim() || EDUCATION_RANK_LABELS[rank] };
  }

  const met = requiredRank === 0 || best.rank >= requiredRank;
  return {
    value: met ? 100 : 0,
    evidence: [{
      factor: "education",
      label: "Education",
      detail: met
        ? `Requires ${toStr(requiredText).trim()}; profile shows "${best.label || EDUCATION_RANK_LABELS[best.rank]}"`
        : `Requires ${toStr(requiredText).trim()}; profile shows "${best.label || "none"}"`,
      source: "profile",
    }],
  };
}

function scoreAdditional(candidate, job) {
  const certifications = asArray(candidate?.certifications);
  const bonus = candidate?.bonus || {};
  const hasGithub = Boolean(bonus.github);
  const hasPortfolio = Boolean(bonus.portfolio);
  const projectCount = Number(bonus.projectCount) || 0;

  if (certifications.length === 0 && !hasGithub && !hasPortfolio && projectCount <= 0) {
    return {
      value: null,
      evidence: [{
        factor: "additional",
        label: "Additional signals",
        detail: "No certifications, portfolio or projects on profile — weight redistributed.",
        source: "profile",
      }],
    };
  }

  const jobSkillSet = new Set(
    [...asArray(job?.requiredSkills), ...asArray(job?.preferredSkills)]
      .map((s) => lowerKey(s?.canonical || s?.name))
      .filter(Boolean),
  );

  let relevant = 0;
  for (const cert of certifications) {
    const key = lowerKey(typeof cert === "string" ? cert : cert?.canonical || cert?.name);
    if (key && jobSkillSet.has(key)) relevant += 1;
  }

  const certPoints = Math.min(60, relevant * 30) + Math.min(20, (certifications.length - relevant) * 10);
  const proofPoints = (hasGithub ? 10 : 0) + (hasPortfolio ? 10 : 0);
  const projectPoints = Math.min(20, projectCount * 20);
  const value = clamp01(certPoints + proofPoints + projectPoints);

  const parts = [];
  if (certifications.length) parts.push(`${certifications.length} certification(s)${relevant ? ` (${relevant} relevant)` : ""}`);
  if (hasGithub) parts.push("GitHub linked");
  if (hasPortfolio) parts.push("portfolio linked");
  if (projectCount > 0) parts.push(`${projectCount} project(s)`);

  return {
    value: clamp01(Math.round(value)),
    evidence: [{
      factor: "additional",
      label: "Additional signals",
      detail: parts.join(" · "),
      source: "profile",
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the Hiring Fit Score.
 *
 * @param {Object} input
 * @param {Object} input.candidate  Normalized candidate:
 *   { skills:[{name,canonical,source,verified}], experienceYears, experienceRoles,
 *     education:[string|{degree}], certifications:[string|{name,canonical}],
 *     assessment:{verifiedSkills:[canonical],testScore,communicationScore},
 *     bonus:{github,portfolio,projectCount} }
 * @param {Object} input.job  Normalized job:
 *   { requiredSkills:[{name,canonical,level,weight}], preferredSkills:[{name,canonical}],
 *     requiredExperience:{min,max}|null, requiredEducation:string|null, title }
 * @param {Object} [input.vocabulary] Normalized skill vocabulary ({ adjacency } used here).
 * @param {Object} [input.embeddings] Optional { job:{canonical:vector}, candidate:{canonical:vector} }.
 * @param {Date|string} [input.now]  Pin the computedAt timestamp (tests).
 * @returns {Object} THE API CONTRACT (see module header / PLAN §4).
 */
export function computeFitScore({ candidate = {}, job = {}, vocabulary = null, embeddings = null, now = undefined } = {}) {
  const adjacencyMap = buildAdjacencyMap(vocabulary);

  const skillMatch = scoreSkillMatch(candidate, job, adjacencyMap, embeddings);
  const assessment = scoreAssessment(candidate, job);
  const experience = scoreExperience(candidate, job);
  const education = scoreEducation(candidate, job);
  const additional = scoreAdditional(candidate, job);

  const breakdown = {
    skillMatch: skillMatch.value,
    assessment: assessment.value,
    experience: experience.value,
    education: education.value,
    additional: additional.value,
  };

  const activeFactors = FACTORS.filter((f) => breakdown[f] !== null);
  const weights = redistributeWeights(BASE_WEIGHTS, activeFactors);

  let total = 0;
  for (const factor of activeFactors) {
    total += (breakdown[factor] * weights[factor]) / 100;
  }

  const evidence = [
    ...skillMatch.evidence,
    ...assessment.evidence,
    ...experience.evidence,
    ...education.evidence,
    ...additional.evidence,
  ];

  const computedAt = (now === undefined ? new Date() : now instanceof Date ? now : new Date(now)).toISOString();

  return {
    total: clamp01(Math.round(total)),
    breakdown,
    weights,
    evidence,
    matchedSkills: skillMatch.matchedSkills,
    adjacentSkills: skillMatch.adjacentSkills,
    missingSkills: skillMatch.missingSkills,
    noAssessment: Boolean(assessment.noAssessment),
    modelVersion: FIT_MODEL_VERSION,
    computedAt,
  };
}

export default computeFitScore;
