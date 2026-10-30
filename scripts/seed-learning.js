// scripts/seed-learning.js
// Seeds the 9 predefined Learning Hub paths with modules and full lessons.
//
// Usage:  npm run seed:learning
//
// Idempotent: uperts paths by `slug` and lessons by `{ pathId, slug }`.
// Never touches user data (plans, progress, attempts).

import "../config/dotenv.js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDB, getDB } from "../config/db.js";
import { ensureLearningIndexes } from "../config/learningIndexes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "seed", "learning");

/**
 * Seed one assessment (diagnostic) + its question bank.
 * Same contract as path seeding: upsert by slug, converge to the file,
 * never touch user data (attempts).
 */
async function seedAssessment(db, data) {
  const assessments = db.collection("skill_assessments");
  const questions = db.collection("assessment_questions");
  const { questions: questionList = [], ...meta } = data;
  const now = new Date();

  await assessments.updateOne(
    { slug: meta.slug },
    {
      $set: {
        ...meta,
        source: "seed",
        type: meta.type || "diagnostic",
        questionCount: questionList.length,
        status: meta.status || "active",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  const saved = await assessments.findOne({ slug: meta.slug });
  const assessmentId = saved._id;
  const seenOrders = [];

  for (const question of questionList) {
    await questions.updateOne(
      { assessmentId, order: question.order },
      {
        $set: { ...question, assessmentId, source: "seed", updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    seenOrders.push(question.order);
  }

  // Converge to the seed file rather than accumulating stale questions.
  await questions.deleteMany({
    assessmentId,
    ...(seenOrders.length ? { order: { $nin: seenOrders } } : {}),
  });

  console.log(`✓ ${meta.slug} — diagnostic, ${questionList.length} questions`);
  return meta.slug;
}

async function main() {
  await connectDB();
  const db = getDB();
  await ensureLearningIndexes(db);

  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error(`No seed files found in ${SEED_DIR}`);
    process.exit(1);
  }

  const paths = db.collection("learning_paths");
  const modules = db.collection("learning_modules");
  const lessons = db.collection("learning_lessons");

  let totals = { paths: 0, modules: 0, lessons: 0, assessments: 0 };
  const seededAssessmentSlugs = [];

  for (const file of files) {
    const raw = await readFile(path.join(SEED_DIR, file), "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`✗ ${file}: invalid JSON — ${err.message}`);
      process.exit(1);
    }

    // Question-bank seed files carry `questions` instead of `modules`.
    if (Array.isArray(data.questions)) {
      seededAssessmentSlugs.push(await seedAssessment(db, data));
      totals.assessments += 1;
      continue;
    }

    const { modules: moduleList = [], ...pathDoc } = data;
    const now = new Date();

    // ── Path ────────────────────────────────────────────────
    const lessonCount = moduleList.reduce(
      (n, m) => n + (m.lessons?.length || 0),
      0,
    );

    await paths.updateOne(
      { slug: pathDoc.slug },
      {
        $set: {
          ...pathDoc,
          source: "seed",
          moduleCount: moduleList.length,
          lessonCount,
          status: pathDoc.status || "published",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    const savedPath = await paths.findOne({ slug: pathDoc.slug });
    const pathId = savedPath._id;

    const seenModuleIds = [];

    for (const moduleDoc of moduleList) {
      const { lessons: lessonList = [], ...moduleMeta } = moduleDoc;

      await modules.updateOne(
        { pathId, slug: moduleMeta.slug },
        {
          $set: {
            ...moduleMeta,
            pathId,
            order: moduleMeta.order,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );

      const savedModule = await modules.findOne({ pathId, slug: moduleMeta.slug });
      seenModuleIds.push(savedModule._id);

      for (const lessonDoc of lessonList) {
        const { content, ...lessonMeta } = lessonDoc;
        await lessons.updateOne(
          { pathId, slug: lessonMeta.slug },
          {
            $set: {
              ...lessonMeta,
              pathId,
              moduleId: savedModule._id,
              content: content || null,
              status: lessonMeta.status || "published",
              revision: 1,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true },
        );
        totals.lessons += 1;
      }

      totals.modules += 1;
    }

    // Remove modules/lessons that were dropped from the seed file, so a
    // re-run converges to the file rather than accumulating stale content.
    const staleModules = await modules
      .find({ pathId, _id: { $nin: seenModuleIds } })
      .toArray();
    if (staleModules.length) {
      const staleIds = staleModules.map((m) => m._id);
      await lessons.deleteMany({ moduleId: { $in: staleIds } });
      await modules.deleteMany({ _id: { $in: staleIds } });
    }

    // Drop lessons no longer present under their module.
    for (const savedModule of await modules.find({ pathId }).toArray()) {
      const seedModule = moduleList.find((m) => m.slug === savedModule.slug);
      const keepSlugs = (seedModule?.lessons || []).map((l) => l.slug);
      await lessons.deleteMany({
        moduleId: savedModule._id,
        ...(keepSlugs.length ? { slug: { $nin: keepSlugs } } : {}),
      });
    }

    // Remove paths present in DB but absent from seed (only published ones
    // we own — never user-generated content, which lives in other collections).
    totals.paths += 1;
    console.log(
      `✓ ${pathDoc.slug} — ${moduleList.length} modules, ${lessonCount} lessons`,
    );
  }

  const seededSlugs = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(path.join(SEED_DIR, file), "utf8"));
    seededSlugs.push(data.slug);
  }
  const orphaned = await paths
    .find({ slug: { $nin: seededSlugs }, source: "seed" })
    .toArray();
  if (orphaned.length) {
    const orphanIds = orphaned.map((p) => p._id);
    await lessons.deleteMany({ pathId: { $in: orphanIds } });
    await modules.deleteMany({ pathId: { $in: orphanIds } });
    await paths.deleteMany({ _id: { $in: orphanIds } });
    console.log(`· removed ${orphaned.length} path(s) no longer in seed`);
  }

  // Same convergence for seeded assessments (attempts are user data — untouched).
  if (seededAssessmentSlugs.length) {
    const orphanAssessments = await db
      .collection("skill_assessments")
      .find({ slug: { $nin: seededAssessmentSlugs }, source: "seed" })
      .toArray();
    if (orphanAssessments.length) {
      const orphanAssessmentIds = orphanAssessments.map((a) => a._id);
      await db
        .collection("assessment_questions")
        .deleteMany({ assessmentId: { $in: orphanAssessmentIds } });
      await db.collection("skill_assessments").deleteMany({ _id: { $in: orphanAssessmentIds } });
      console.log(`· removed ${orphanAssessments.length} assessment(s) no longer in seed`);
    }
  }

  console.log(
    `\nDone: ${totals.paths} paths, ${totals.modules} modules, ${totals.lessons} lessons, ${totals.assessments} assessment(s)`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
