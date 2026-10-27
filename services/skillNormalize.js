// services/skillNormalize.js
// ─────────────────────────────────────────────────────────────────────────────
// Maps free-text skill strings -> canonical skills using the `skills` collection
// (93-skill starter seed with aliases + adjacency, models/skillSeed.js).
//
// Resolution order (deterministic, offline, no LLM):
//   1. exact canonical name        "JavaScript" -> javascript
//   2. alias                       "js" / "k8s" -> javascript / kubernetes
//   3. containment (longest match) "React JS developer" -> react
//   4. fallback                    normalized original string (lowercased)
//
// The vocabulary (canonicals + aliases + adjacency) is loaded from MongoDB once
// and cached in `globalThis` with a TTL — no DB hit per request. When the DB is
// unreachable or the collection is empty, the built-in starter seed is used, so
// matching ALWAYS works offline (the LLM is never involved here).
//
// Public API:
//   loadSkillVocabulary({ ttlMs, forceRefresh }) -> vocabulary (cached)
//   buildVocabulary(skillDocs)                    -> vocabulary (pure)
//   getStarterVocabulary()                       -> vocabulary from skillSeed
//   clearVocabularyCache()
//   canonicalizeSkill(text, vocabulary)           -> canonical|null
//   normalizeJobSkills(rawList, vocabulary)       -> [{ name, canonical }]
//   normalizeCandidateSkills(rawList, opts, vocabulary) -> [{ name, canonical, source, verified }]
// ─────────────────────────────────────────────────────────────────────────────

import { getDB } from "../config/db.js";
import { STARTER_SKILLS, slugify } from "../models/skillSeed.js";

export const VOCABULARY_TTL_MS = 10 * 60 * 1000; // 10 minutes

const CACHE_KEY = "__skillMatchVocabularyCache";

/** Normalize a skill string for lookup: lowercase, trim, collapse whitespace. */
export function normalizeKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Build the in-memory vocabulary from raw `skills` collection documents.
 * Shape:
 *   { entries, canonical: {lowerName: entry}, aliasToCanonical: {key: lowerName},
 *     slugToCanonical: {slug: lowerName}, adjacency: {lowerName: [lowerNames]} }
 */
export function buildVocabulary(skillDocs = []) {
  const canonical = {};
  const aliasToCanonical = {};
  const slugToCanonical = {};
  const adjacency = {};

  for (const doc of skillDocs) {
    const name = String(doc?.name || "").trim();
    if (!name) continue;
    const key = normalizeKey(name);
    const slug = doc.slug || slugify(name);
    canonical[key] = {
      name,
      slug,
      category: doc.category || "general",
      demand: typeof doc.demand === "number" ? doc.demand : 0,
      aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
    };
    aliasToCanonical[key] = key;
    slugToCanonical[slug] = key;
  }

  // Second pass: aliases + adjacency (adjacency entries are slugs or names).
  let index = 0;
  for (const doc of skillDocs) {
    const name = String(doc?.name || "").trim();
    if (!name) continue;
    const key = normalizeKey(name);
    index += 1;

    for (const alias of Array.isArray(doc.aliases) ? doc.aliases : []) {
      const aliasKey = normalizeKey(alias);
      if (aliasKey && !(aliasKey in aliasToCanonical)) aliasToCanonical[aliasKey] = key;
    }

    const neighbors = [];
    for (const raw of Array.isArray(doc.adjacency) ? doc.adjacency : []) {
      const neighborSlug = typeof raw === "string" ? raw : raw?.slug;
      if (!neighborSlug) continue;
      const neighbor = slugToCanonical[normalizeKey(neighborSlug)] || slugToCanonical[neighborSlug];
      if (neighbor && neighbor !== key) neighbors.push(neighbor);
    }
    if (neighbors.length) adjacency[key] = neighbors;
  }

  return { entries: Object.values(canonical), canonical, aliasToCanonical, slugToCanonical, adjacency };
}

/** Vocabulary built from the bundled starter seed — never touches the DB. */
export function getStarterVocabulary() {
  if (!globalThis.__skillStarterVocabulary) {
    globalThis.__skillStarterVocabulary = buildVocabulary(
      STARTER_SKILLS.map(({ name, aliases, category, demand, adjacency }) => ({
        name,
        slug: slugify(name),
        aliases,
        category,
        demand,
        adjacency,
      })),
    );
  }
  return globalThis.__skillStarterVocabulary;
}

function cache() {
  if (!globalThis[CACHE_KEY]) globalThis[CACHE_KEY] = { vocabulary: null, expiresAt: 0 };
  return globalThis[CACHE_KEY];
}

export function clearVocabularyCache() {
  globalThis[CACHE_KEY] = { vocabulary: null, expiresAt: 0 };
}

/**
 * Load the skill vocabulary, cached in globalThis with a TTL.
 * Falls back to the starter seed when the DB has no skills collection / errors.
 */
export async function loadSkillVocabulary({ ttlMs = VOCABULARY_TTL_MS, forceRefresh = false } = {}) {
  const entry = cache();
  if (!forceRefresh && entry.vocabulary && Date.now() < entry.expiresAt) {
    return entry.vocabulary;
  }

  let vocabulary = null;
  try {
    const db = getDB();
    const docs = await db
      .collection("skills")
      .find({}, { projection: { name: 1, slug: 1, aliases: 1, category: 1, demand: 1, adjacency: 1 } })
      .toArray();
    if (Array.isArray(docs) && docs.length > 0) {
      vocabulary = buildVocabulary(docs);
    }
  } catch (error) {
    console.warn("skillNormalize: could not load skills collection, using starter vocabulary:", error?.message || error);
  }

  if (!vocabulary) vocabulary = getStarterVocabulary();

  entry.vocabulary = vocabulary;
  entry.expiresAt = Date.now() + ttlMs;
  return vocabulary;
}

/**
 * Resolve one free-text skill to its canonical lowercase name.
 * @returns {string|null} canonical name, or null when nothing matches.
 */
export function canonicalizeSkill(text, vocabulary) {
  const key = normalizeKey(text);
  if (!key) return null;

  const canonical = vocabulary?.canonical || {};
  const aliasToCanonical = vocabulary?.aliasToCanonical || {};

  // 1-2. exact canonical / alias
  if (aliasToCanonical[key]) return aliasToCanonical[key];
  if (canonical[key]) return key;

  // Light cleanup for phrases like "amazon web services (aws)" or "js developer".
  const paren = key.replace(/\(([^)]*)\)/g, " $1 ").replace(/\s+/g, " ").trim();
  if (paren !== key) {
    if (aliasToCanonical[paren]) return aliasToCanonical[paren];
    if (canonical[paren]) return paren;
  }

  // 3. containment — prefer the LONGEST canonical/alias contained in the text
  //    (so "javascript" wins over "java" inside "javascript frameworks").
  let best = null;
  const consider = (haystack, target) => {
    if (!target || target.length < 3) return;
    if (haystack.includes(target) && (!best || target.length > best.length)) best = target;
  };
  for (const candidateKey of Object.keys(canonical)) consider(key, candidateKey);
  if (!best) {
    for (const aliasKey of Object.keys(aliasToCanonical)) consider(key, aliasKey);
  }
  // …and the reverse containment: text is contained in a canonical name
  //    (e.g. "amazon web services" typed with extra words, "k8s cluster").
  if (!best && key.length >= 3) {
    for (const candidateKey of Object.keys(canonical)) {
      if (candidateKey.length >= 3 && candidateKey.includes(key) && (!best || candidateKey.length > best.length)) {
        best = candidateKey;
      }
    }
  }

  if (best) return aliasToCanonical[best] || best;
  return null;
}

/**
 * Normalize a job's skill list. Items may be plain strings or
 * { name, level, weight } objects (models/Job.js shape).
 * @returns {Array<{ name: string, canonical: string, level: any, weight: number|null, matched: boolean }>}
 */
export function normalizeJobSkills(rawList = [], vocabulary) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(rawList) ? rawList : []) {
    const name = typeof item === "string" ? item : String(item?.name || item?.skill || "").trim();
    if (!name) continue;
    const canonical = canonicalizeSkill(name, vocabulary) || normalizeKey(name);
    if (seen.has(canonical)) continue; // dedupe (e.g. "JS" and "JavaScript")
    seen.add(canonical);
    out.push({
      name,
      canonical,
      level: typeof item === "object" && item ? item.level ?? null : null,
      weight: typeof item === "object" && item && Number(item.weight) > 0 ? Number(item.weight) : null,
      matched: Boolean(canonicalizeSkill(name, vocabulary)),
    });
  }
  return out;
}

/**
 * Normalize a candidate's skills. Items may be plain strings or
 * { name, source, verified } objects (models/Candidate PLAN §5 shape).
 * Verified skills are merged in (source: "assessment", verified: true).
 * @returns {Array<{ name: string, canonical: string, source: string, verified: boolean }>}
 */
export function normalizeCandidateSkills(rawList = [], { verifiedSkills = [] } = {}, vocabulary) {
  const out = [];
  const seen = new Set();

  const verifiedSet = new Set(
    (Array.isArray(verifiedSkills) ? verifiedSkills : [])
      .map((s) => canonicalizeSkill(typeof s === "string" ? s : s?.name, vocabulary) || normalizeKey(s))
      .filter(Boolean),
  );

  const push = (name, source, verified) => {
    const canonical = canonicalizeSkill(name, vocabulary) || normalizeKey(name);
    if (!canonical || seen.has(canonical)) return;
    seen.add(canonical);
    out.push({
      name: String(name).trim() || canonical,
      canonical,
      source: source || "self",
      verified: Boolean(verified),
    });
  };

  for (const item of Array.isArray(rawList) ? rawList : []) {
    if (typeof item === "string") {
      push(item, verifiedSet.has(canonicalizeSkill(item, vocabulary) || normalizeKey(item)) ? "assessment" : "self",
        verifiedSet.has(canonicalizeSkill(item, vocabulary) || normalizeKey(item)));
    } else if (item && (item.name || item.skill)) {
      const name = item.name || item.skill;
      const canonical = canonicalizeSkill(name, vocabulary) || normalizeKey(name);
      const verified = Boolean(item.verified) || verifiedSet.has(canonical);
      push(name, item.source || (verified ? "assessment" : "self"), verified);
    }
  }

  // Verified skills that are not on the profile list still count as skills.
  for (const canonical of verifiedSet) {
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push({ name: canonical, canonical, source: "assessment", verified: true });
    }
  }

  return out;
}
