// services/skillEvaluationService.js
// Deterministic grading for skill-test MCQs, with answer-key hygiene so the
// key NEVER leaves the server (Phase 2 security redesign):
//
//   GENERATE (controller)                        SUBMIT (controller)
//   ─────────────────────                        ─────────────────────
//   shuffleOptions(options) ──► per-attempt      resolveSubmittedIndex ──►
//   answerHash = sha256(`${salt}:idx:${i}`)      (option text OR 0-based
//     stored in skill_tests doc only)              index → index)
//                                                        │
//                                                        ▼
//                              evaluateSkillAnswers: sha256(`${salt}:idx:${n}`)
//                              === question.answerHash → correct / incorrect
//
// Clients receive the shuffled options only. Grading compares salted hashes of
// the option INDEX, so it is robust to whitespace/casing in option text and to
// per-attempt shuffling. Legacy test documents generated before this redesign
// (which still carry a plaintext `correctAnswer` in the DB) keep grading via
// normalized text comparison — that field is never serialized into responses.
//
// Scoring stays fair and predictable: pass threshold 60, per-skill breakdown
// for the result screen / analytics.

import { createHash, randomInt } from "node:crypto";

/** Minimum score (0-100) to pass a skill test. */
const PASS_THRESHOLD = 60;

/** Normalize an answer for comparison: trim, lowercase, collapse whitespace. */
function normalizeAnswer(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Lowercase hex SHA-256 of a string. */
function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * The stored form of a correct answer: salted SHA-256 of the correct option's
 * 0-based index (in the SHUFFLED options array the client received).
 */
function hashExpectedAnswer(optionIndex, salt) {
  return sha256Hex(`${salt}:idx:${optionIndex}`);
}

/** Unbiased Fisher–Yates shuffle (crypto.randomInt) returning a new array. */
function shuffleOptions(options) {
  const arr = Array.isArray(options) ? [...options] : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Resolve a submitted answer to an option index against the stored (shuffled)
 * options. Accepts either the option text (normalized match) or a 0-based
 * index as a number/numeric string. Text wins on ambiguity (e.g. an option
 * whose text is literally "1"). Returns -1 when nothing matches.
 */
function resolveSubmittedIndex(submitted, options) {
  const raw = normalizeAnswer(submitted);
  if (!raw || !Array.isArray(options) || options.length === 0) return -1;

  const textIdx = options.findIndex((opt) => normalizeAnswer(opt) === raw);
  if (textIdx !== -1) return textIdx;

  if (/^\d+$/.test(raw)) {
    const idx = Number(raw);
    if (idx >= 0 && idx < options.length) return idx;
  }
  return -1;
}

/**
 * Evaluate MCQ answers deterministically against the stored answer key.
 *
 * @param {string[]} skillsArray skills this test covers
 * @param {Array<{id: string, skill?: string, options: string[], answerHash?: string, correctAnswer?: string}>} questions
 *   questions as stored in the skill_tests document (answerHash for current
 *   documents, plaintext correctAnswer only for legacy in-flight documents)
 * @param {Array<{questionId: string, answer: string}>} answers submitted answers
 *   (option text or 0-based option index)
 * @param {string} salt per-test answer salt (test.answerSalt)
 */
async function evaluateSkillAnswers(skillsArray, questions, answers, salt = "") {
  const answerMap = new Map(
    (Array.isArray(answers) ? answers : []).map((a) => [a.questionId, String(a.answer ?? "")]),
  );
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const totalQuestions = safeQuestions.length || 1;

  const perSkillMap = new Map(); // skill -> { skill, correct, total }
  let correctCount = 0;

  for (const q of safeQuestions) {
    const options = Array.isArray(q.options) ? q.options : [];
    const given = answerMap.get(q.id) ?? "";
    let isCorrect = false;

    if (q.answerHash) {
      // Current format: hash of the correct option's index in the shuffled list.
      const idx = resolveSubmittedIndex(given, options);
      if (idx !== -1) {
        isCorrect = sha256Hex(`${salt}:idx:${idx}`) === q.answerHash;
      }
    } else if (q.correctAnswer) {
      // Legacy format (pre-redesign documents, in flight): compare normalized
      // text; a numeric answer is resolved to the option text at that index.
      let submittedText = given;
      const optionsIdx = resolveSubmittedIndex(given, options);
      if (/^\d+$/.test(normalizeAnswer(given)) && optionsIdx !== -1) {
        submittedText = options[optionsIdx];
      }
      const expected = normalizeAnswer(q.correctAnswer);
      const actual = normalizeAnswer(submittedText);
      isCorrect = Boolean(expected && actual && expected === actual);
    }

    const skillKey = String(q.skill || "General");
    if (!perSkillMap.has(skillKey)) {
      perSkillMap.set(skillKey, { skill: skillKey, correct: 0, total: 0 });
    }
    const bucket = perSkillMap.get(skillKey);
    bucket.total += 1;
    if (isCorrect) {
      correctCount += 1;
      bucket.correct += 1;
    }
  }

  const score = Math.round((correctCount / totalQuestions) * 100);
  const perSkill = [...perSkillMap.values()].map((s) => ({
    ...s,
    score: s.total ? Math.round((s.correct / s.total) * 100) : 0,
  }));

  const skillsList = Array.isArray(skillsArray) ? skillsArray.join(", ") : String(skillsArray || "skills");
  const feedback =
    score >= 80
      ? `Great work. You answered ${correctCount}/${safeQuestions.length} correctly across ${skillsList}.`
      : score >= 60
        ? `Good effort. You answered ${correctCount}/${safeQuestions.length} correctly. Review missed basics and retry to improve.`
        : `You answered ${correctCount}/${safeQuestions.length} correctly. Focus on fundamentals for ${skillsList} and try again.`;

  return {
    score,
    feedback,
    passed: score >= PASS_THRESHOLD,
    correctCount,
    totalQuestions: safeQuestions.length,
    perSkill,
  };
}

export {
  PASS_THRESHOLD,
  normalizeAnswer,
  sha256Hex,
  hashExpectedAnswer,
  shuffleOptions,
  resolveSubmittedIndex,
  evaluateSkillAnswers,
};
export default { evaluateSkillAnswers, PASS_THRESHOLD };
