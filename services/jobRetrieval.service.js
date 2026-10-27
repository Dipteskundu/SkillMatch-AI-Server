// services/jobRetrieval.service.js
// ─────────────────────────────────────────────────────────────────────────────
// Cheap server-side retrieval for the career agent (PLAN §4.6 — grounded RAG
// over jobs + own profile with citations). No vectors, no embeddings:
//
//   1. tokenize the question (stopwords dropped),
//   2. canonicalize skill terms via services/skillNormalize.js (works offline
//      through the cached starter vocabulary when the skills collection is
//      unreachable),
//   3. pre-filter approved jobs in Mongo with ONE escaped alternation regex,
//   4. score the candidates in-process (skill hits > title hits > description
//      hits) and keep the top-k with a relevance floor.
//
// Deterministic, regex-injection safe (every term is escaped), and cheap. The
// same scores feed the `sources` array of POST /api/chatbot/ask.
//
// Public API:
//   tokenizeQuestion(question)              -> string[]  (lowercased terms)
//   scoreJobDocuments(jobs, terms, vocab)    -> [{ job, score }]  desc order
//   retrieveRelevantJobs(question, { topK }) -> [{ ...job, relevance }]
//   DEFAULT_TOP_K
// ─────────────────────────────────────────────────────────────────────────────

import { getDB } from "../config/db.js";
import { escapeRegExp } from "../lib/schemas.js";
import {
  canonicalizeSkill,
  loadSkillVocabulary,
  normalizeJobSkills,
  normalizeKey,
} from "./skillNormalize.js";

export const DEFAULT_TOP_K = 5;

const PROBE_LIMIT = 200; // max candidates pulled from Mongo before scoring
const MIN_SCORE = 4; // relevance floor: title-hit(3) + desc-hit(1), or one skill hit(5)
const MAX_TERMS = 12; // keep the pre-filter regex small
const MAX_TOKENS = 16;

// Generic question/board words that match nearly every job description.
// Dropping them stops "Which jobs need React skills?" from scoring every job
// that contains the word "skills" in its description.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "get", "got", "had", "has",
  "have", "he", "her", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "just", "me", "mine", "many", "match", "matches", "matching", "more",
  "most", "much", "my", "need", "needs", "of", "on", "or", "our", "out",
  "over", "please", "should", "show", "so", "some", "tell", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "to", "too", "under", "up", "us", "very", "want", "wants", "was", "we",
  "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your", "job", "jobs", "role", "roles", "position",
  "positions", "opening", "openings", "hiring", "hire", "apply", "applies",
  "looking", "find", "search", "skill", "skills", "good", "best", "top",
]);

/**
 * Lowercase + split the question into meaningful tokens (deduped, capped).
 * @returns {string[]}
 */
export function tokenizeQuestion(question) {
  const raw = String(question ?? "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/);
  const out = [];
  for (const piece of raw) {
    const token = piece.replace(/^[.+#]+|[.+#]+$/g, "");
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    if (!out.includes(token)) out.push(token);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/** Resolve tokens (and bigrams) to canonical skill names via skillNormalize. */
function extractSkillTerms(tokens, vocabulary) {
  const candidates = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  const terms = [];
  for (const candidate of candidates) {
    const canonical = canonicalizeSkill(candidate, vocabulary);
    if (canonical && !terms.includes(canonical)) terms.push(canonical);
  }
  return terms;
}

/**
 * Score jobs against the question terms. Returns hits sorted by score (desc),
 * ties broken by title — deterministic. Matches below MIN_SCORE are dropped.
 * @param {Array<object>} jobs          raw find_jobs documents
 * @param {{tokens: string[], skillTerms: string[], phrase: string}} terms
 * @param {object} vocabulary           skillNormalize vocabulary
 */
export function scoreJobDocuments(jobs, terms, vocabulary) {
  const { tokens = [], skillTerms = [], phrase = "" } = terms || {};
  const scored = [];

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const title = normalizeKey(job?.title);
    const description = normalizeKey(job?.description);
    const jobSkills = normalizeJobSkills(
      [
        ...(Array.isArray(job?.skills) ? job.skills : []),
        ...(Array.isArray(job?.niceToHaveSkills) ? job.niceToHaveSkills : []),
        ...(Array.isArray(job?.requiredSkills) ? job.requiredSkills : []),
        ...(Array.isArray(job?.preferredSkills) ? job.preferredSkills : []),
      ],
      vocabulary,
    );
    const jobSkillKeys = new Set();
    for (const skill of jobSkills) {
      jobSkillKeys.add(skill.canonical);
      jobSkillKeys.add(normalizeKey(skill.name));
    }

    let score = 0;
    for (const term of skillTerms) {
      if (jobSkillKeys.has(term)) score += 5; // a canonical skill hit is the strongest signal
    }
    for (const token of tokens) {
      if (title.includes(token)) score += 3;
      if (jobSkillKeys.has(token)) score += 3;
      if (description.includes(token)) score += 1;
    }
    if (phrase.length >= 4 && title.includes(phrase)) score += 4;

    if (score >= MIN_SCORE) scored.push({ job, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.job?.title || "").localeCompare(String(b.job?.title || "")),
  );
  return scored;
}

/**
 * Retrieve the top-k approved jobs relevant to a free-form question.
 * Never throws — retrieval failure degrades to "no grounding" (empty array).
 * @param {string} question
 * @param {{topK?: number}} [opts]
 * @returns {Promise<Array<object>>} `[{ ...job, relevance }]`, most relevant first
 */
export async function retrieveRelevantJobs(question, { topK = DEFAULT_TOP_K } = {}) {
  try {
    const tokens = tokenizeQuestion(question);
    if (!tokens.length) return [];

    const vocabulary = await loadSkillVocabulary();
    const skillTerms = extractSkillTerms(tokens, vocabulary);

    // Pre-filter terms: longest first (most specific), escaped, capped.
    const terms = [...new Set([...skillTerms, ...tokens])]
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_TERMS);
    if (!terms.length) return [];

    const regex = new RegExp(terms.map(escapeRegExp).join("|"), "i");

    const db = getDB();
    const cursor = db
      .collection("find_jobs")
      .find(
        {
          status: "approved",
          $or: [
            { title: regex },
            { description: regex },
            { skills: regex },
            { niceToHaveSkills: regex },
            { requiredSkills: { $elemMatch: { name: regex } } },
          ],
        },
        {
          projection: {
            title: 1,
            company: 1,
            location: 1,
            description: 1,
            skills: 1,
            niceToHaveSkills: 1,
            requiredSkills: 1,
            preferredSkills: 1,
          },
        },
      )
      .limit(PROBE_LIMIT);
    const docs = await cursor.toArray();

    const scored = scoreJobDocuments(
      docs,
      { tokens, skillTerms, phrase: normalizeKey(question) },
      vocabulary,
    );
    return scored.slice(0, topK).map(({ job, score }) => ({ ...job, relevance: score }));
  } catch (error) {
    console.warn("jobRetrieval: retrieval failed (continuing ungrounded):", error?.message || error);
    return [];
  }
}
