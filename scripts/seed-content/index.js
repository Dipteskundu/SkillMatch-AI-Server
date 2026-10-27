// scripts/seed-content/index.js — aggregates the hand-authored flagship paths.
// Pure data, no DB access: safe to import from tests (tests/seedContent.test.js).

import { reactPath } from "./react.js";
import { pythonPath } from "./python.js";
import { sqlPath } from "./sql.js";
import { systemDesignPath } from "./system-design.js";
import { communicationPath } from "./communication.js";

/** Technologies grouping the 5 flagship paths (catalog display order). */
export const SEED_TECHNOLOGIES = [
  { name: "Web Development", slug: "web-development", category: "web", order: 1 },
  { name: "Programming", slug: "programming", category: "programming", order: 2 },
  { name: "Software Engineering", slug: "software-engineering", category: "engineering", order: 3 },
  { name: "Career Skills", slug: "career-skills", category: "career", order: 4 },
];

/** The 5 flagship learning paths — real, hand-authored content (no LLM). */
export const SEED_PATHS = [
  reactPath,
  pythonPath,
  sqlPath,
  systemDesignPath,
  communicationPath,
];

/**
 * Canonical-skill entries the seed guarantees exist in the `skills`
 * collection (Phase 1's starter seed already covers React/Python/SQL/
 * Communication; System Design is new in Phase 4 — upserted either way).
 */
export const SEED_SKILLS = [
  {
    name: "React",
    slug: "react",
    aliases: ["reactjs", "react.js"],
    category: "framework",
    demand: 97,
    adjacency: ["javascript", "next-js", "typescript"],
  },
  {
    name: "Python",
    slug: "python",
    aliases: ["py"],
    category: "language",
    demand: 96,
    adjacency: ["pandas", "machine-learning", "django"],
  },
  {
    name: "SQL",
    slug: "sql",
    aliases: ["structured query language"],
    category: "language",
    demand: 94,
    adjacency: ["postgresql", "mysql", "data-analysis"],
  },
  {
    name: "System Design",
    slug: "system-design",
    aliases: ["system design interview", "system architecture", "software architecture", "distributed systems"],
    category: "design",
    demand: 85,
    adjacency: ["sql", "communication", "aws"],
  },
  {
    name: "Communication",
    slug: "communication",
    aliases: ["communication skills", "verbal communication"],
    category: "soft_skill",
    demand: 97,
    adjacency: ["teamwork", "presentation"],
  },
];
