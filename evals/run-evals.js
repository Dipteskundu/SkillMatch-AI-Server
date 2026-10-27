#!/usr/bin/env node
// evals/run-evals.js
// ─────────────────────────────────────────────────────────────────────────────
// Golden-set evaluation harness for the SkillMatch backend.
//
// Usage:
//   npm run eval              OFFLINE mode (default): deterministic checks only —
//                             extraction golden-set integrity + normalization +
//                             conditional injection-guard behavior + fit-engine
//                             ranking/band expectations + schema validation.
//                             No LLM, no network, no DB → CI-safe.
//   npm run eval -- --live    LIVE mode: additionally runs the REAL services
//                             (aiSkillExtractionService, skillGapService)
//                             against the golden set and reports field-level
//                             precision/recall. Requires a working LLM provider
//                             (GEMINI_API_KEY and/or FALLBACK_API_KEY_OPEN_ROUTER).
//
// Exit code: 0 = all checks passed, 1 = regression (CI-able).
//
// Golden files (evals/golden/):
//   resume-extraction.jsonl  realistic synthetic resumes with expectedSkills /
//                            forbiddenSkills / expectedYearsMin-Max / injection flag
//   jd-matching.jsonl        job ↔ candidate pairs with expectRanking "A>B"
//                            or an expected match band (high/medium/low)
//
// NOTE: no secret is ever printed (the harness only prints skill names, scores
// and masked provider info).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

import { extractJSON } from "../services/llm.js";
import {
  getStarterVocabulary,
  canonicalizeSkill,
  normalizeJobSkills,
  normalizeCandidateSkills,
  normalizeKey,
} from "../services/skillNormalize.js";
import { computeFitScore } from "../services/fitScore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const GOLDEN_DIR = path.join(__dirname, "golden");

const LIVE = process.argv.includes("--live");
const MODE = LIVE ? "live" : "offline";
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

// Match bands for fit-engine totals (0-100).
const BAND_RANGES = Object.freeze({
  high: [70, 100],
  medium: [40, 69],
  low: [0, 39],
});

// Live-mode pass thresholds (regression gates → non-zero exit).
const LIVE_MIN_CASE_RECALL = 0.6; // per-resume fraction of expected skills found
const LIVE_MIN_CASE_PRECISION = 0.3; // per-resume fraction of predicted skills that are expected
const LIVE_MIN_MICRO_RECALL = 0.65; // aggregate across the whole golden set
const LIVE_MIN_CASE_PASS_RATE = 0.7; // fraction of resume cases that must pass

// ── Result collection / printing ─────────────────────────────────────────────

/** @type {{suite: string, id: string, status: "pass"|"fail"|"skip", detail: string}[]} */
const results = [];

function record(suite, id, status, detail = "") {
  results.push({ suite, id, status, detail });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "SKIP";
  console.log(`  [${tag}] ${id.padEnd(30)} ${detail}`);
}

function section(title) {
  console.log(`\n${title}`);
  console.log("─".repeat(Math.max(title.length, 60)));
}

function readJsonl(fileName) {
  const file = path.join(GOLDEN_DIR, fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`Golden file missing: evals/golden/${fileName}`);
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`evals/golden/${fileName}:${index + 1} — invalid JSON: ${err.message}`);
      }
    });
}

function percent(n) {
  return `${Math.round(n * 100)}%`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Golden-set integrity (structure) ─────────────────────────────────────────

function checkStructure(resumes, jobCases) {
  section("[golden structure]");
  const seenResumeIds = new Set();
  const seenJobIds = new Set();

  for (const c of resumes) {
    const issues = [];
    if (!c.id) issues.push("missing id");
    else if (seenResumeIds.has(c.id)) issues.push(`duplicate id ${c.id}`);
    seenResumeIds.add(c.id);

    if (!c.resume || c.resume.trim().length < 80) issues.push("resume text too short");
    if (!Array.isArray(c.expectedSkills) || c.expectedSkills.length === 0) issues.push("expectedSkills empty");
    if (!Array.isArray(c.forbiddenSkills)) issues.push("forbiddenSkills not an array");

    const overlap = (c.expectedSkills || []).filter((s) => (c.forbiddenSkills || []).includes(s));
    if (overlap.length) issues.push(`expected ∩ forbidden overlap: ${overlap.join(", ")}`);

    if (c.expectedYearsMin !== undefined || c.expectedYearsMax !== undefined) {
      const min = c.expectedYearsMin;
      const max = c.expectedYearsMax;
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || min < 0) {
        issues.push(`bad years band ${min}..${max}`);
      }
    }
    record("golden-structure", c.id, issues.length ? "fail" : "pass",
      issues.length ? issues.join("; ") : `${c.expectedSkills.length} expected skills, ${c.forbiddenSkills.length} forbidden`);
  }

  for (const rec of jobCases) {
    const issues = [];
    if (!rec.id) issues.push("missing id");
    else if (seenJobIds.has(rec.id)) issues.push(`duplicate id ${rec.id}`);
    seenJobIds.add(rec.id);

    if (!rec.job?.title) issues.push("job.title missing");
    if (!Array.isArray(rec.job?.requiredSkills) || rec.job.requiredSkills.length === 0) {
      issues.push("job.requiredSkills empty");
    }
    if (!rec.candidateA) issues.push("candidateA missing");

    const labels = [rec.expectRanking, rec.expectedBand].filter(Boolean);
    if (labels.length !== 1) issues.push("exactly one of expectRanking / expectedBand required");
    if (rec.expectRanking && !/^A>B$|^B>A$/.test(rec.expectRanking)) issues.push(`bad expectRanking "${rec.expectRanking}"`);
    if (rec.expectedBand && !BAND_RANGES[rec.expectedBand]) issues.push(`bad expectedBand "${rec.expectedBand}"`);
    if (rec.expectRanking && !rec.candidateB) issues.push("expectRanking without candidateB");

    record("golden-structure", rec.id, issues.length ? "fail" : "pass",
      issues.length ? issues.join("; ") : `${rec.job.title} · ${rec.expectRanking || `band ${rec.expectedBand}`}`);
  }
}

// ── Offline extraction checks (ground truth + normalization) ─────────────────

function checkExtractionGolden(resumes, vocab) {
  section("[resume-extraction · offline] source grounding, forbidden leaks, canonicalization");
  for (const c of resumes) {
    const issues = [];
    const lowerText = c.resume.toLowerCase();

    // 1. Ground truth: every expected skill must actually be derivable from the text.
    for (const skill of c.expectedSkills) {
      if (!lowerText.includes(String(skill).toLowerCase())) {
        issues.push(`ground-truth missing in source: "${skill}"`);
      }
    }

    // 2. Forbidden skills must not leak into the SOURCE of clean resumes.
    //    (For injection cases the forbidden token legitimately appears inside the
    //    attack text — its detection is covered by the injection-guard suite and
    //    by live mode, which check the extracted OUTPUT instead.)
    if (!c.injection) {
      for (const forbidden of c.forbiddenSkills) {
        if (lowerText.includes(String(forbidden).toLowerCase())) {
          issues.push(`forbidden "${forbidden}" appears in source text`);
        }
      }
    }

    // 3. Normalization: expected skills must canonicalize through the starter
    //    vocabulary (otherwise live precision/recall would compare junk).
    for (const skill of c.expectedSkills) {
      if (!canonicalizeSkill(skill, vocab)) {
        issues.push(`not canonicalizable via skill vocabulary: "${skill}"`);
      }
    }

    record("resume-extraction", c.id, issues.length ? "fail" : "pass",
      issues.length
        ? issues.join("; ")
        : `${c.expectedSkills.length} grounded · ${c.forbiddenSkills.length} forbidden clean` +
          (c.expectedYearsMin !== undefined ? ` · years ${c.expectedYearsMin}-${c.expectedYearsMax}` : ""));
  }
}

// ── Injection guard (conditional — services/injectionGuard.js may not exist) ─

const GUARD_EXPORT_NAMES = [
  "sanitizeUntrustedText",
  "detectPromptInjection",
  "scanForPromptInjection",
  "flagPromptInjection",
  "containsPromptInjection",
  "detectInjection",
  "flagInjection",
  "scanInjection",
  "analyzeInjection",
];

async function loadInjectionGuard() {
  const file = path.join(SERVER_ROOT, "services", "injectionGuard.js");
  if (!fs.existsSync(file)) return { status: "absent" };
  try {
    const mod = await import(pathToFileURL(file).href);
    const fn =
      GUARD_EXPORT_NAMES.map((name) => mod[name]).find((f) => typeof f === "function") ||
      (typeof mod.default === "function" ? mod.default : null);
    if (!fn) return { status: "unrecognized-api" };
    return { status: "ready", fn };
  } catch (err) {
    return { status: "import-error", error: err.message };
  }
}

function interpretGuardResult(result) {
  if (typeof result === "boolean") return result;
  if (result && typeof result === "object") {
    for (const key of ["flagged", "isInjection", "injection", "detected", "suspicious"]) {
      if (result[key] !== undefined) return Boolean(result[key]);
    }
  }
  return Boolean(result);
}

async function checkInjectionGuard(resumes) {
  section("[injection-guard] flagging behavior against golden injection cases");
  const guard = await loadInjectionGuard();

  if (guard.status !== "ready") {
    const why =
      guard.status === "absent"
        ? "services/injectionGuard.js not present yet"
        : guard.status === "import-error"
          ? `services/injectionGuard.js failed to import (${guard.error})`
          : `services/injectionGuard.js recognized but no detector export found (tried ${GUARD_EXPORT_NAMES.join(", ")}, default)`;
    record("injection-guard", "(all cases)", "skip",
      `${why} — injection-flagging checks deferred; they activate automatically once the guard lands`);
    return;
  }

  for (const c of resumes) {
    try {
      const flagged = interpretGuardResult(await guard.fn(c.resume));
      if (c.injection) {
        record("injection-guard", c.id, flagged ? "pass" : "fail",
          flagged ? "injection attempt detected" : "injection attempt NOT detected");
      } else {
        record("injection-guard", c.id, flagged ? "fail" : "pass",
          flagged ? "false positive on a clean resume" : "clean resume not flagged");
      }
    } catch (err) {
      record("injection-guard", c.id, "fail", `guard threw: ${err.message}`);
    }
  }
}

// ── Normalization checks (services/skillNormalize.js — pure, offline) ────────

function checkNormalization(vocab) {
  section("[skill-normalization] alias / dedupe / canonical behavior");
  const cases = [
    ["alias js → javascript", canonicalizeSkill("JS", vocab) === "javascript"],
    ["alias k8s → kubernetes", canonicalizeSkill("k8s", vocab) === "kubernetes"],
    ["alias reactjs → react", canonicalizeSkill("React.js", vocab) === "react"],
    ["platform alias ios → swift", canonicalizeSkill("iOS", vocab) === "swift"],
    ["unknown skill → null", canonicalizeSkill("Definitely Not A Skill 123", vocab) === null],
    [
      "job list dedupes JS/React/React.js",
      JSON.stringify(normalizeJobSkills(["JS", "React", "React.js"], vocab).map((s) => s.canonical)) ===
        JSON.stringify(["javascript", "react"]),
    ],
    [
      "candidate skills normalize with sources",
      (() => {
        const out = normalizeCandidateSkills(["JavaScript", "Figma"], { verifiedSkills: ["Figma"] }, vocab);
        const figma = out.find((s) => s.canonical === "figma");
        return out.length === 2 && figma?.verified === true && figma?.source === "assessment";
      })(),
    ],
    ["normalizeKey collapses whitespace", normalizeKey("  React   JS  ") === "react js"],
  ];
  for (const [name, ok] of cases) {
    record("normalization", name, ok ? "pass" : "fail", ok ? "" : "behavior changed — golden expectations broken");
  }
}

// ── Fit engine ranking / bands (services/fitScore.js — pure, offline) ────────

function buildJobInput(job, vocab) {
  return {
    title: job.title || "",
    requiredSkills: normalizeJobSkills(job.requiredSkills || [], vocab),
    preferredSkills: normalizeJobSkills(job.niceToHaveSkills || job.preferredSkills || [], vocab),
    requiredExperience: Number.isFinite(job.experienceMin)
      ? { min: job.experienceMin, max: Number.isFinite(job.experienceMax) ? job.experienceMax : null }
      : null,
    requiredEducation:
      typeof job.education === "string" && job.education.trim() ? job.education.trim() : null,
  };
}

function buildCandidateInput(candidate, vocab) {
  const canon = (s) => canonicalizeSkill(s, vocab) || normalizeKey(s);
  return {
    skills: normalizeCandidateSkills(candidate.skills || [], { verifiedSkills: candidate.verifiedSkills || [] }, vocab),
    experienceYears: Number.isFinite(candidate.yearsOfExperience) ? candidate.yearsOfExperience : 0,
    experienceRoles: [],
    education: candidate.education ? [candidate.education] : [],
    certifications: [],
    assessment: {
      verifiedSkills: (candidate.verifiedSkills || []).map(canon).filter(Boolean),
      testScore: Number.isFinite(candidate.testScore) ? candidate.testScore : null,
      communicationScore: null,
    },
    bonus: {},
  };
}

function scorePair(rec, vocab) {
  const jobInput = buildJobInput(rec.job, vocab);
  const scoreA = computeFitScore({
    candidate: buildCandidateInput(rec.candidateA, vocab),
    job: jobInput,
    vocabulary: vocab,
    now: FIXED_NOW,
  });
  const scoreB = rec.candidateB
    ? computeFitScore({
        candidate: buildCandidateInput(rec.candidateB, vocab),
        job: jobInput,
        vocabulary: vocab,
        now: FIXED_NOW,
      })
    : null;
  return { scoreA, scoreB };
}

/** Returns null when the expectation holds, else a human-readable reason. */
function evaluateFitExpectation(rec, scores) {
  if (rec.expectRanking) {
    const [winner, loser] = rec.expectRanking.split(">");
    const winnerTotal = winner === "A" ? scores.scoreA.total : scores.scoreB.total;
    const loserTotal = loser === "A" ? scores.scoreA.total : scores.scoreB.total;
    if (winnerTotal > loserTotal) return null;
    return `expected ${rec.expectRanking} but ${winner}=${winnerTotal} ≤ ${loser}=${loserTotal}`;
  }
  if (rec.expectedBand) {
    const [lo, hi] = BAND_RANGES[rec.expectedBand];
    const total = scores.scoreA.total;
    if (total >= lo && total <= hi) return null;
    return `expected ${rec.expectedBand} band (${lo}-${hi}) but total=${total}`;
  }
  return "no expectation label";
}

function checkFitEngine(jobCases, vocab) {
  section("[jd-matching · offline] fit-engine ranking / band expectations (deterministic)");
  for (const rec of jobCases) {
    const scores = scorePair(rec, vocab);
    const reason = evaluateFitExpectation(rec, scores);
    const detail = rec.expectRanking
      ? `A=${scores.scoreA.total} B=${scores.scoreB.total} (expected ${rec.expectRanking})`
      : `total=${scores.scoreA.total} (expected band ${rec.expectedBand})`;
    record("fit-engine", rec.id, reason ? "fail" : "pass", reason ? `${reason} · ${detail}` : detail);
  }
}

// ── Schema validation (what generateJSON enforces on every LLM answer) ───────

function checkSchemas() {
  section("[schema validation] extraction contract + extractJSON robustness");

  const extractionSchema = z.object({
    skills: z.array(z.string()),
    experience_years: z.number(),
    technologies: z.array(z.string()),
    role_titles: z.array(z.string()),
  });

  const good = {
    skills: ["Frontend Development"],
    experience_years: 5,
    technologies: ["React", "Node.js"],
    role_titles: ["Software Engineer"],
  };

  const checks = [
    [
      "valid extraction object passes",
      extractionSchema.safeParse(good).success,
    ],
    [
      "fenced JSON is extracted then validated",
      (() => {
        const parsed = extractJSON('```json\n' + JSON.stringify(good) + "\n```");
        return extractionSchema.safeParse(parsed).success;
      })(),
    ],
    [
      "prose-wrapped JSON is extracted then validated",
      (() => {
        const parsed = extractJSON(`Here you go: ${JSON.stringify(good)} — enjoy!`);
        return extractionSchema.safeParse(parsed).success;
      })(),
    ],
    [
      "non-array skills rejected",
      !extractionSchema.safeParse({ ...good, skills: "React" }).success,
    ],
    [
      "string experience_years rejected",
      !extractionSchema.safeParse({ ...good, experience_years: "five" }).success,
    ],
    [
      "missing technologies field rejected",
      (() => {
        const { technologies, ...rest } = good;
        return !extractionSchema.safeParse(rest).success;
      })(),
    ],
    [
      "non-JSON model output throws SyntaxError",
      (() => {
        try {
          extractJSON("I could not produce JSON.");
          return false;
        } catch (err) {
          return err instanceof SyntaxError;
        }
      })(),
    ],
  ];

  for (const [name, ok] of checks) {
    record("schema-validation", name, ok ? "pass" : "fail", ok ? "" : "contract regression");
  }
}

// ── LIVE mode: real extraction + matching services ───────────────────────────

function normalizeForCompare(values, vocab) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((v) => canonicalizeSkill(String(v), vocab) || normalizeKey(v))
      .filter(Boolean),
  );
}

async function runLiveExtraction(resumes, vocab) {
  section("[resume-extraction · live] field-level precision / recall (real LLM)");
  const { extractSkillsFromResume } = await import("../services/aiSkillExtractionService.js");

  let tp = 0;
  let predictedTotal = 0;
  let expectedTotal = 0;
  let forbiddenViolations = 0;
  let yearsChecked = 0;
  let yearsOk = 0;
  let passed = 0;

  for (const c of resumes) {
    let out;
    try {
      out = await extractSkillsFromResume(c.resume);
    } catch (err) {
      record("live-extraction", c.id, "fail", `service threw: ${err.message}`);
      continue;
    }

    const predicted = normalizeForCompare(
      [...(out.skills || []), ...(out.technologies || []), ...(out.role_titles || [])],
      vocab,
    );
    const expected = normalizeForCompare(c.expectedSkills, vocab);
    const forbidden = normalizeForCompare(c.forbiddenSkills, vocab);

    const hits = [...predicted].filter((p) => forbidden.has(p));
    const truePositives = [...predicted].filter((p) => expected.has(p)).length;

    const precision = predicted.size > 0 ? truePositives / predicted.size : 0;
    const recall = expected.size > 0 ? truePositives / expected.size : 0;

    predictedTotal += predicted.size;
    expectedTotal += expected.size;
    tp += truePositives;
    forbiddenViolations += hits.length;

    let yearsNote = "years n/a";
    let yearsPass = true;
    if (Number.isFinite(c.expectedYearsMin)) {
      yearsChecked += 1;
      const years = Number(out.experience_years);
      yearsPass = Number.isFinite(years) && years >= c.expectedYearsMin && years <= c.expectedYearsMax;
      if (yearsPass) yearsOk += 1;
      yearsNote = `years=${Number.isFinite(years) ? years : "n/a"} (want ${c.expectedYearsMin}-${c.expectedYearsMax})`;
    }

    const issues = [];
    if (hits.length) issues.push(`forbidden leaked: ${hits.join(", ")}`);
    if (recall < LIVE_MIN_CASE_RECALL) issues.push(`recall ${round2(recall)} < ${LIVE_MIN_CASE_RECALL}`);
    if (predicted.size > 0 && precision < LIVE_MIN_CASE_PRECISION) {
      issues.push(`precision ${round2(precision)} < ${LIVE_MIN_CASE_PRECISION}`);
    }
    if (!yearsPass) issues.push(yearsNote);

    if (!issues.length) passed += 1;
    record("live-extraction", c.id, issues.length ? "fail" : "pass",
      `P=${round2(precision)} R=${round2(recall)} tp=${truePositives}/${expected.size} ${yearsNote}` +
      (issues.length ? ` — ${issues.join("; ")}` : ""));
  }

  const microRecall = expectedTotal > 0 ? tp / expectedTotal : 0;
  const microPrecision = predictedTotal > 0 ? tp / predictedTotal : 0;
  const casePassRate = resumes.length > 0 ? passed / resumes.length : 0;

  record("live-extraction (aggregate)", "micro-precision", microPrecision >= LIVE_MIN_CASE_PRECISION ? "pass" : "fail",
    `${round2(microPrecision)} (min ${LIVE_MIN_CASE_PRECISION})`);
  record("live-extraction (aggregate)", "micro-recall", microRecall >= LIVE_MIN_MICRO_RECALL ? "pass" : "fail",
    `${round2(microRecall)} (min ${LIVE_MIN_MICRO_RECALL})`);
  record("live-extraction (aggregate)", "case-pass-rate", casePassRate >= LIVE_MIN_CASE_PASS_RATE ? "pass" : "fail",
    `${percent(casePassRate)} (${passed}/${resumes.length}, min ${percent(LIVE_MIN_CASE_PASS_RATE)})`);
  record("live-extraction (aggregate)", "forbidden-violations", forbiddenViolations === 0 ? "pass" : "fail",
    `${forbiddenViolations} forbidden skill(s) leaked into outputs`);
  if (yearsChecked > 0) {
    record("live-extraction (aggregate)", "years-in-range", yearsOk === yearsChecked ? "pass" : "fail",
      `${yearsOk}/${yearsChecked} within expected band`);
  }

  return { microPrecision, microRecall, casePassRate, forbiddenViolations };
}

async function runLiveMatching(jobCases, vocab) {
  section("[jd-matching · live] real service path (fit engine + LLM suggestions)");
  const { analyzeSkillGap } = await import("../services/skillGapService.js");

  for (const rec of jobCases) {
    try {
      const offline = scorePair(rec, vocab);
      const gapA = await analyzeSkillGap(
        (rec.candidateA.skills || []).map(String),
        (rec.job.requiredSkills || []).map(String),
        (rec.job.niceToHaveSkills || []).map(String),
      );
      const issues = [];

      // Service matchScore = engine skillMatch component (deterministic).
      if (Math.abs(gapA.matchScore - offline.scoreA.breakdown.skillMatch) > 1) {
        issues.push(`matchScore ${gapA.matchScore} ≠ engine ${offline.scoreA.breakdown.skillMatch}`);
      }

      let extra = `A.matchScore=${gapA.matchScore} suggestions=${gapA.learningSuggestions.length}`;

      if (rec.expectRanking) {
        const gapB = await analyzeSkillGap(
          (rec.candidateB.skills || []).map(String),
          (rec.job.requiredSkills || []).map(String),
          (rec.job.niceToHaveSkills || []).map(String),
        );
        const [winner, loser] = rec.expectRanking.split(">");
        const winnerScore = winner === "A" ? gapA.matchScore : gapB.matchScore;
        const loserScore = loser === "A" ? gapA.matchScore : gapB.matchScore;
        if (!(winnerScore > loserScore)) {
          issues.push(`service ranking ${rec.expectRanking} violated (A=${gapA.matchScore} B=${gapB.matchScore})`);
        }
        extra = `A=${gapA.matchScore} B=${gapB.matchScore} (expected ${rec.expectRanking})`;
      }

      record("live-matching", rec.id, issues.length ? "fail" : "pass",
        issues.length ? `${issues.join("; ")} · ${extra}` : extra);
    } catch (err) {
      record("live-matching", rec.id, "fail", `service threw: ${err.message}`);
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

function printSummary() {
  section(`summary (${MODE} mode)`);

  const suites = new Map();
  for (const r of results) {
    if (!suites.has(r.suite)) suites.set(r.suite, { pass: 0, fail: 0, skip: 0 });
    suites.get(r.suite)[r.status] += 1;
  }

  const nameWidth = Math.max(24, ...[...suites.keys()].map((s) => s.length));
  console.log(`${"suite".padEnd(nameWidth)}  pass  fail  skip`);
  console.log(`${"─".repeat(nameWidth)}  ----  ----  ----`);
  for (const [name, counts] of suites) {
    console.log(
      `${name.padEnd(nameWidth)}  ${String(counts.pass).padStart(4)}  ${String(counts.fail).padStart(4)}  ${String(counts.skip).padStart(4)}`,
    );
  }

  const totals = { pass: 0, fail: 0, skip: 0 };
  for (const counts of suites.values()) {
    totals.pass += counts.pass;
    totals.fail += counts.fail;
    totals.skip += counts.skip;
  }
  console.log(
    `${"TOTAL".padEnd(nameWidth)}  ${String(totals.pass).padStart(4)}  ${String(totals.fail).padStart(4)}  ${String(totals.skip).padStart(4)}`,
  );
  return totals;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`SkillMatch AI — golden-set eval (${MODE} mode, no secrets printed)`);

  const resumes = readJsonl("resume-extraction.jsonl");
  const jobCases = readJsonl("jd-matching.jsonl");
  const vocab = getStarterVocabulary();

  checkStructure(resumes, jobCases);
  checkExtractionGolden(resumes, vocab);
  await checkInjectionGuard(resumes);
  checkNormalization(vocab);
  checkFitEngine(jobCases, vocab);
  checkSchemas();

  if (LIVE) {
    await import(pathToFileURL(path.join(SERVER_ROOT, "config", "dotenv.js")).href);
    const llm = await import("../services/llm.js");
    if (!llm.isLLMAvailable()) {
      record("live-extraction (setup)", "llm-availability", "fail",
        "no LLM provider configured — set GEMINI_API_KEY and/or FALLBACK_API_KEY_OPEN_ROUTER in .env");
    } else {
      const stats = llm.getProviderStats();
      console.log(
        `\nLive run — mode=${stats.mode} gemini=${stats.gemini.configured ? "key✓" : "no-key"}` +
          ` openrouter=${stats.openrouter.configured ? `${stats.openrouter.models.length} models ${stats.openrouter.keyMasked}` : "disabled"}`,
      );
      await runLiveExtraction(resumes, vocab);
      await runLiveMatching(jobCases, vocab);
    }
  }

  const totals = printSummary();

  if (totals.fail > 0) {
    console.error(`\n✗ ${totals.fail} check(s) FAILED — regression detected.`);
    process.exit(1);
  }
  console.log(`\n✓ All checks passed${totals.skip ? ` (${totals.skip} skipped)` : ""}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ eval harness error: ${err.stack || err.message}`);
  process.exit(1);
});
