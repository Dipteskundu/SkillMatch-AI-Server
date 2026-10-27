// tests/fitScore.test.js
// Pure unit tests for the unified Hiring Fit Score engine (services/fitScore.js).
// No DB, no network, no LLM — the engine is deterministic by design.
import { describe, it, expect } from "vitest";
import {
  computeFitScore,
  redistributeWeights,
  cosineSimilarity,
  educationRank,
  BASE_WEIGHTS,
  ADJACENT_SKILL_CREDIT,
  FIT_MODEL_VERSION,
} from "../services/fitScore.js";
import { getStarterVocabulary } from "../services/skillNormalize.js";

const vocabulary = getStarterVocabulary();

const NOW = new Date("2026-10-01T00:00:00.000Z");

/** Shorthand: normalized candidate skills from plain names (self-reported). */
function candSkills(...names) {
  return names.map((name) => ({ name, canonical: name.toLowerCase(), source: "self", verified: false }));
}

/** Shorthand: normalized required job skills. */
function reqSkills(...names) {
  return names.map((name) => ({ name, canonical: name.toLowerCase(), level: null, weight: null, matched: true }));
}

function prefSkills(...names) {
  return names.map((name) => ({ name, canonical: name.toLowerCase(), level: null, weight: null, matched: true }));
}

function score({ candidate = {}, job = {}, embeddings = null } = {}) {
  return computeFitScore({ candidate, job, vocabulary, embeddings, now: NOW });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill tiers: exact / adjacent / missing
// ─────────────────────────────────────────────────────────────────────────────

describe("skill matching — three tiers", () => {
  it("gives full credit for an exact canonical match", () => {
    const result = score({
      candidate: { skills: candSkills("javascript") },
      job: { requiredSkills: reqSkills("javascript") },
    });
    expect(result.breakdown.skillMatch).toBe(100);
    expect(result.matchedSkills).toEqual(["javascript"]);
    expect(result.missingSkills).toEqual([]);
    expect(result.adjacentSkills).toEqual([]);
  });

  it("gives partial credit (0.6) via the adjacency graph", () => {
    // Seed adjacency: react <-> javascript
    const result = score({
      candidate: { skills: candSkills("javascript") },
      job: { requiredSkills: reqSkills("react") },
    });
    expect(result.breakdown.skillMatch).toBe(Math.round(ADJACENT_SKILL_CREDIT * 100));
    expect(result.matchedSkills).toEqual([]);
    expect(result.missingSkills).toEqual([]);
    expect(result.adjacentSkills).toEqual([
      { candidateSkill: "javascript", jobSkill: "react", credit: ADJACENT_SKILL_CREDIT },
    ]);
  });

  it("scores zero for a missing skill — never auto-awarded", () => {
    const result = score({
      candidate: { skills: candSkills("javascript") },
      job: { requiredSkills: reqSkills("kubernetes") },
    });
    expect(result.breakdown.skillMatch).toBe(0);
    expect(result.missingSkills).toEqual(["kubernetes"]);
  });

  it("blends exact + adjacent + missing across required skills", () => {
    const result = score({
      // "excel" shares no adjacency with react/kubernetes in the starter seed
      candidate: { skills: candSkills("javascript", "excel") },
      job: { requiredSkills: reqSkills("javascript", "react", "kubernetes") },
    });
    // (1.0 + 0.6 + 0) / 3 = 53.33 -> 53
    expect(result.breakdown.skillMatch).toBe(53);
    expect(result.matchedSkills).toEqual(["javascript"]);
    expect(result.adjacentSkills).toEqual([
      { candidateSkill: "javascript", jobSkill: "react", credit: ADJACENT_SKILL_CREDIT },
    ]);
    expect(result.missingSkills).toEqual(["kubernetes"]);
  });

  it("respects per-skill weights when provided", () => {
    const result = score({
      candidate: { skills: candSkills("javascript") },
      job: {
        requiredSkills: [
          { name: "javascript", canonical: "javascript", weight: 3 },
          { name: "kubernetes", canonical: "kubernetes", weight: 1 },
        ],
      },
    });
    // (3×1.0 + 1×0) / 4 = 75
    expect(result.breakdown.skillMatch).toBe(75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preferred / nice-to-have skills (the old "20/20 auto-award" bug)
// ─────────────────────────────────────────────────────────────────────────────

describe("skill matching — preferred skills", () => {
  it("does NOT auto-award full points when the job has no nice-to-have matches", () => {
    const result = score({
      candidate: { skills: candSkills("react") },
      job: { requiredSkills: reqSkills("react"), preferredSkills: prefSkills("figma") },
    });
    // 0.7×100 (required) + 0.3×0 (unmatched nice-to-have) = 70 — NOT 100.
    expect(result.breakdown.skillMatch).toBe(70);
  });

  it("blends required 70% + preferred 30% when both exist", () => {
    const result = score({
      candidate: { skills: candSkills("react", "figma") },
      job: { requiredSkills: reqSkills("react"), preferredSkills: prefSkills("figma") },
    });
    expect(result.breakdown.skillMatch).toBe(100);
  });

  it("uses the preferred sub-score alone when the job lists no required skills", () => {
    const result = score({
      candidate: { skills: candSkills("react") },
      job: { preferredSkills: prefSkills("figma") },
    });
    expect(result.breakdown.skillMatch).toBe(0); // missing preferred = 0, never free
  });

  it("never yields 100 when the job lists NO skills at all (neutral 50)", () => {
    const result = score({
      candidate: { skills: candSkills("react", "aws") },
      job: {},
    });
    expect(result.breakdown.skillMatch).toBe(50);
    expect(result.total).toBeLessThan(100);
    const evidence = result.evidence.find((e) => e.factor === "skillMatch");
    expect(evidence.detail.toLowerCase()).toContain("neutral");
  });

  it("empty required skills with preferred skills present is never 100", () => {
    const result = score({
      candidate: { skills: candSkills("react") },
      job: { requiredSkills: [], preferredSkills: prefSkills("figma", "sketch") },
    });
    expect(result.breakdown.skillMatch).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weights + redistribution
// ─────────────────────────────────────────────────────────────────────────────

describe("weights", () => {
  it("redistributes the education weight when the job requires no education", () => {
    const result = score({
      candidate: {
        skills: candSkills("javascript"),
        assessment: { verifiedSkills: [], testScore: 80, communicationScore: null },
        bonus: { github: true, portfolio: false, projectCount: 0 }, // keeps `additional` active
      },
      job: { requiredSkills: reqSkills("javascript"), requiredExperience: { min: 2 } },
    });
    expect(result.breakdown.education).toBeNull();
    expect(result.weights.education).toBe(0);
    // skillMatch/assessment/experience/additional keep 45:25:15:5, scaled to 100.
    expect(result.weights.skillMatch).toBe(50); // 45/90
    expect(Object.values(result.weights).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("redistributes the assessment weight when no assessment exists (noAssessment flag)", () => {
    const result = score({
      candidate: { skills: candSkills("javascript") },
      job: { requiredSkills: reqSkills("javascript"), requiredExperience: { min: 2 }, requiredEducation: "bachelor" },
    });
    expect(result.breakdown.assessment).toBeNull();
    expect(result.noAssessment).toBe(true);
    expect(result.weights.assessment).toBe(0);
    expect(Object.values(result.weights).reduce((a, b) => a + b, 0)).toBe(100);
    const evidence = result.evidence.find((e) => e.factor === "assessment");
    expect(evidence.detail.toLowerCase()).toContain("redistributed");
  });

  it("weights always sum to exactly 100 (mixed nulls)", () => {
    const result = score({
      candidate: { skills: candSkills("javascript") }, // no assessment, no education, no certs
      job: { requiredSkills: reqSkills("javascript") }, // no experience requirement
    });
    expect(Object.values(result.weights).reduce((a, b) => a + b, 0)).toBe(100);
    // Only skillMatch is active -> it absorbs everything.
    expect(result.weights.skillMatch).toBe(100);
    expect(result.total).toBe(result.breakdown.skillMatch);
  });

  it("redistributeWeights returns base weights when everything is active", () => {
    const weights = redistributeWeights(BASE_WEIGHTS, Object.keys(BASE_WEIGHTS));
    expect(weights).toEqual(BASE_WEIGHTS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assessment / experience / education / additional
// ─────────────────────────────────────────────────────────────────────────────

describe("assessment component", () => {
  it("averages available signals (verified coverage + test + communication)", () => {
    const result = score({
      candidate: {
        skills: candSkills("javascript"),
        assessment: { verifiedSkills: ["javascript"], testScore: 80, communicationScore: 60 },
      },
      job: { requiredSkills: reqSkills("javascript") },
    });
    // verified coverage 100, test 80, communication 60 -> avg 80
    expect(result.breakdown.assessment).toBe(80);
    expect(result.noAssessment).toBe(false);
  });

  it("scores null + noAssessment when the candidate has no assessment data", () => {
    const result = score({
      candidate: { skills: candSkills("javascript"), assessment: { verifiedSkills: [] } },
      job: { requiredSkills: reqSkills("javascript"), requiredExperience: { min: 1 }, requiredEducation: "bachelor" },
    });
    expect(result.breakdown.assessment).toBeNull();
    expect(result.noAssessment).toBe(true);
  });
});

describe("experience component", () => {
  it("full credit when the requirement is met", () => {
    const result = score({
      candidate: { skills: [], experienceYears: 5 },
      job: { requiredExperience: { min: 3, max: 6 } },
    });
    expect(result.breakdown.experience).toBe(100);
  });

  it("partial credit when close to the requirement", () => {
    const result = score({
      candidate: { skills: [], experienceYears: 2 },
      job: { requiredExperience: { min: 4 } },
    });
    expect(result.breakdown.experience).toBe(50);
  });

  it("low credit when far under", () => {
    const result = score({
      candidate: { skills: [], experienceYears: 0 },
      job: { requiredExperience: { min: 5 } },
    });
    expect(result.breakdown.experience).toBe(0);
  });

  it("is null (redistributed) when the job states no requirement", () => {
    const result = score({
      candidate: { skills: [], experienceYears: 10 },
      job: {},
    });
    expect(result.breakdown.experience).toBeNull();
  });
});

describe("education component", () => {
  it("is only evaluated when the job requires education", () => {
    const met = score({
      candidate: { skills: [], education: ["Bachelor of Science in CS"] },
      job: { requiredEducation: "bachelor" },
    });
    expect(met.breakdown.education).toBe(100);

    const notMet = score({
      candidate: { skills: [], education: ["High School Diploma"] },
      job: { requiredEducation: "bachelor" },
    });
    expect(notMet.breakdown.education).toBe(0);
  });

  it("maps degree levels deterministically", () => {
    expect(educationRank("High School")).toBe(1);
    expect(educationRank("Associate Degree")).toBe(2);
    expect(educationRank("B.Tech")).toBe(3);
    expect(educationRank("Master of Science")).toBe(4);
    expect(educationRank("Ph.D")).toBe(5);
    expect(educationRank("")).toBe(0);
  });
});

describe("additional component", () => {
  it("is null (redistributed) when the candidate has no bonus signals at all", () => {
    const result = score({
      candidate: { skills: [], certifications: [], bonus: { github: false, portfolio: false, projectCount: 0 } },
      job: {},
    });
    expect(result.breakdown.additional).toBeNull();
  });

  it("rewards relevant certifications and proof links", () => {
    const result = score({
      candidate: {
        skills: [],
        certifications: [{ name: "AWS Certified Developer", canonical: "aws" }],
        bonus: { github: true, portfolio: false, projectCount: 1 },
      },
      job: { requiredSkills: reqSkills("aws") },
    });
    // 30 (relevant cert) + 10 (github) + 20 (project) = 60
    expect(result.breakdown.additional).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output contract
// ─────────────────────────────────────────────────────────────────────────────

describe("output contract", () => {
  const result = score({
    candidate: {
      skills: candSkills("javascript"),
      experienceYears: 2,
      education: ["Bachelor's degree"],
      certifications: [],
      assessment: { verifiedSkills: ["javascript"], testScore: null, communicationScore: null },
      bonus: { github: false, portfolio: false, projectCount: 0 },
    },
    job: {
      requiredSkills: reqSkills("javascript", "kubernetes"),
      preferredSkills: prefSkills("figma"),
      requiredExperience: { min: 3 },
    },
  });

  it("always includes every factor in evidence", () => {
    expect(result.evidence.length).toBeGreaterThan(0);
    const factors = new Set(result.evidence.map((e) => e.factor));
    for (const factor of ["skillMatch", "assessment", "experience", "education", "additional"]) {
      expect(factors.has(factor)).toBe(true);
      const entry = result.evidence.find((e) => e.factor === factor);
      expect(typeof entry.label).toBe("string");
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(typeof entry.source).toBe("string");
    }
  });

  it("returns an integer total in [0,100] that matches the weighted breakdown", () => {
    expect(Number.isInteger(result.total)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    let expected = 0;
    for (const factor of ["skillMatch", "assessment", "experience", "education", "additional"]) {
      if (result.breakdown[factor] !== null) {
        expected += (result.breakdown[factor] * result.weights[factor]) / 100;
      }
    }
    expect(result.total).toBe(Math.round(expected));
  });

  it("carries the model version and a computedAt timestamp", () => {
    expect(result.modelVersion).toBe(FIT_MODEL_VERSION);
    expect(result.computedAt).toBe(NOW.toISOString());
  });

  it("is deterministic (same input, same output)", () => {
    const again = score({
      candidate: {
        skills: candSkills("javascript"),
        experienceYears: 2,
        education: ["Bachelor's degree"],
        certifications: [],
        assessment: { verifiedSkills: ["javascript"], testScore: null, communicationScore: null },
        bonus: { github: false, portfolio: false, projectCount: 0 },
      },
      job: {
        requiredSkills: reqSkills("javascript", "kubernetes"),
        preferredSkills: prefSkills("figma"),
        requiredExperience: { min: 3 },
      },
    });
    expect(again).toEqual(result);
  });

  it("never crashes on completely empty input", () => {
    const empty = computeFitScore({});
    expect(empty.total).toBe(50); // neutral skillMatch, everything else redistributed
    expect(empty.evidence.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Optional semantic (embedding) tier
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic matching (optional embeddings)", () => {
  // figma and rails share no taxonomy link in the starter vocabulary.
  const embeddings = {
    job: { figma: [1, 0] },
    candidate: { rails: [0.9, Math.sqrt(1 - 0.81)] }, // cosine = 0.9
  };

  it("adds credit = 0.5 × similarity when similarity > 0.8", () => {
    const sim = cosineSimilarity(embeddings.job.figma, embeddings.candidate.rails);
    expect(sim).toBeCloseTo(0.9, 5);

    const result = score({
      candidate: { skills: candSkills("rails") },
      job: { requiredSkills: reqSkills("figma") },
      embeddings,
    });
    expect(result.breakdown.skillMatch).toBe(Math.round(0.5 * sim * 100)); // 45
    expect(result.adjacentSkills).toEqual([
      { candidateSkill: "rails", jobSkill: "figma", credit: Math.round(0.5 * sim * 100) / 100, semantic: true },
    ]);
  });

  it("ignores similarity at or below the threshold", () => {
    const weak = {
      job: { figma: [1, 0] },
      candidate: { rails: [0.5, Math.sqrt(1 - 0.25)] }, // cosine = 0.5
    };
    const result = score({
      candidate: { skills: candSkills("rails") },
      job: { requiredSkills: reqSkills("figma") },
      embeddings: weak,
    });
    expect(result.breakdown.skillMatch).toBe(0);
    expect(result.missingSkills).toEqual(["figma"]);
  });

  it("exact taxonomy matches still win over semantic matches", () => {
    const result = score({
      candidate: { skills: candSkills("figma") },
      job: { requiredSkills: reqSkills("figma") },
      embeddings,
    });
    expect(result.breakdown.skillMatch).toBe(100);
    expect(result.adjacentSkills).toEqual([]);
  });
});

describe("cosineSimilarity", () => {
  it("handles degenerate inputs safely", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
  });
});
