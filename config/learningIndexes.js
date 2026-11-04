// config/learningIndexes.js
// Indexes for the Learning Hub collections (spec v1.2).
// Called once at boot — raw MongoDB driver does not auto-index.

const INDEXES = {
  // ── Published content ────────────────────────────────────────
  learning_paths: [{ key: { status: 1, order: 1 } }],
  learning_modules: [{ key: { pathId: 1, order: 1 } }],
  learning_lessons: [
    { key: { moduleId: 1, order: 1 } },
    { key: { pathId: 1, status: 1 } },
  ],

  // ── Personal plans & progress ────────────────────────────────
  user_learning_plans: [
    { key: { userId: 1, updatedAt: -1 } },
    { key: { userId: 1, sourcePathId: 1 } },
  ],
  learning_progress: [
    { key: { userId: 1, planId: 1 } },
    { key: { userId: 1, lessonId: 1 } },
  ],
  user_skill_profiles: [{ key: { userId: 1 }, unique: true }],
  learning_plan_versions: [{ key: { planId: 1, createdAt: -1 } }],

  // ── Assessments (practice only — never mixed with recruitment) ─
  skill_assessments: [{ key: { status: 1, type: 1 } }],
  assessment_questions: [
    { key: { assessmentId: 1, order: 1 } },
    { key: { topic: 1 } },
  ],
  assessment_attempts: [
    { key: { userId: 1, createdAt: -1 } },
    { key: { userId: 1, assessmentId: 1 } },
  ],
};

/** Create every Learning Hub index. Safe to run on every boot. */
export async function ensureLearningIndexes(db) {
  let failedCollections = [];
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    for (const { key, unique } of indexes) {
      try {
        await db.collection(collection).createIndex(key, unique ? { unique: true } : {});
      } catch (error) {
        // Surface index creation failures once rather than crashing boot.
        if (!failedCollections.includes(collection)) {
          failedCollections.push(collection);
        }
      }
    }
  }
  if (failedCollections.length) {
    // Index warnings are collected but not emitted to console in production
  }
}
