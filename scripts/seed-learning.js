// scripts/seed-learning.js
// Idempotent seed for the SkillForge Learning Hub (Phase 4):
//   4 technologies + 5 PUBLISHED flagship learning paths (React, Python, SQL,
//   System Design, Communication) with real hand-authored lesson content and
//   5-question quizzes (salted answer hashes computed at seed time), plus the
//   matching `skills` vocabulary entries.
//
// Usage: npm run seed:learning
// Upserts by slug — safe to re-run (content refreshes to the hand-authored copy,
// version history is preserved and a new seed version is appended).

import "../config/dotenv.js";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../config/env.js";
import "../models/index.js"; // registers Technology / LearningPath / Skill
import { Technology, LearningPath, Skill } from "../models/index.js";
import { hashExpectedAnswer } from "../services/skillEvaluationService.js";
import { SEED_TECHNOLOGIES, SEED_PATHS, SEED_SKILLS } from "./seed-content/index.js";

const CONNECT_TIMEOUT_MS = 12000;
const SEED_BY = "seed";

/** Build a LearningPath document object from one seed path definition. */
function buildPathDoc(pathData, technologyId) {
  const salt = crypto.randomBytes(16).toString("hex");
  const questions = pathData.quiz.questions.map((q) => ({
    prompt: q.prompt,
    options: q.options,
    answerIndex: q.answerIndex,
    answerHash: hashExpectedAnswer(q.answerIndex, salt),
    explanation: q.explanation,
    skillSlug: q.skillSlug || pathData.skillSlug,
  }));

  const now = new Date();
  return {
    technologyId,
    skillSlug: pathData.skillSlug,
    title: pathData.title,
    slug: pathData.slug,
    level: pathData.level,
    estimatedHours: pathData.estimatedHours,
    status: "published",
    modules: pathData.modules,
    quiz: { passingScore: pathData.quiz.passingScore ?? 70, salt, questions },
  };
}

export async function seedLearningContent({ log = console.log } = {}) {
  // ── Skills vocabulary (upsert by slug; Phase 1 starter seed may already cover) ──
  let skillsUpserted = 0;
  for (const skill of SEED_SKILLS) {
    await Skill.updateOne(
      { slug: skill.slug },
      { $setOnInsert: { ...skill, taxonomy: { escoId: null, onetId: null } } },
      { upsert: true },
    );
    skillsUpserted += 1;
  }
  log(`skills: ${skillsUpserted} ensured (inserted only when missing)`);

  // ── Technologies (upsert by slug) ──
  const techIds = new Map();
  for (const tech of SEED_TECHNOLOGIES) {
    const doc = await Technology.findOneAndUpdate(
      { slug: tech.slug },
      { $set: { name: tech.name, category: tech.category, order: tech.order } },
      { upsert: true, returnDocument: "after" },
    );
    techIds.set(tech.slug, doc._id);
  }
  log(`technologies: ${techIds.size} ensured`);

  // ── Learning paths (upsert by slug, always published) ──
  let created = 0;
  let updated = 0;
  for (const pathData of SEED_PATHS) {
    const technologyId = techIds.get(pathData.technologySlug) || null;
    const doc = buildPathDoc(pathData, technologyId);
    const existing = await LearningPath.findOne({ slug: pathData.slug });
    const publishedAt = new Date();

    if (existing) {
      const currentVersion = (existing.versions || []).reduce((max, v) => Math.max(max, v.version || 0), 0);
      const nextVersion = currentVersion + 1;
      await LearningPath.updateOne(
        { _id: existing._id },
        {
          $set: {
            technologyId: doc.technologyId,
            skillSlug: doc.skillSlug,
            title: doc.title,
            level: doc.level,
            estimatedHours: doc.estimatedHours,
            status: "published",
            modules: doc.modules,
            quiz: doc.quiz,
          },
          $push: {
            versions: {
              version: nextVersion,
              snapshot: { modules: doc.modules, quiz: doc.quiz },
              publishedAt,
              publishedBy: SEED_BY,
              note: "Seed content refresh (hand-authored).",
            },
            contentLog: { at: publishedAt, by: SEED_BY, action: "seed", note: `Seeded v${nextVersion} of hand-authored content.` },
          },
        },
      );
      updated += 1;
    } else {
      await LearningPath.create({
        ...doc,
        versions: [
          {
            version: 1,
            snapshot: { modules: doc.modules, quiz: doc.quiz },
            publishedAt,
            publishedBy: SEED_BY,
            note: "Initial hand-authored seed content.",
          },
        ],
        contentLog: [{ at: publishedAt, by: SEED_BY, action: "seed", note: "Created from hand-authored seed content." }],
      });
      created += 1;
    }
  }
  log(`learning paths: ${created} created, ${updated} refreshed (5 total, all published)`);

  return { skillsUpserted, technologies: techIds.size, created, updated };
}

/** Entry point when run directly (npm run seed:learning) — never on import. */
async function main() {
  const { env } = loadEnv();
  if (!env.MONGODB_URI) {
    console.error("seed:learning — MONGODB_URI is not configured. Set it in .env and retry.");
    process.exit(1);
  }

  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGO_DB_NAME,
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    });
    console.log(`Connected to MongoDB (db: ${env.MONGO_DB_NAME})`);
    const summary = await seedLearningContent();
    console.log("seed:learning DONE", summary);
    process.exit(0);
  } catch (error) {
    console.error(`seed:learning FAILED: ${error?.message || error}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
