// Assert self-check: normalizePlan gives every AI lesson a stable lessonId,
// preserves existing valid ids (regeneration must keep completed progress
// attached), and mints a fresh id for junk/foreign id values.
// Run: node scripts/test-plan-lesson-ids.mjs
import assert from "node:assert";
import { normalizePlan } from "../services/learningPlan.service.js";

const answers = {
  goal: "Learn Nest.js",
  existingSkills: ["JavaScript"],
  proficiency: "beginner",
  targetOutcome: "job-preparation",
  weeklyHours: 8,
};

// Module 1 arrives from raw AI output (no ids anywhere). Module 2 simulates
// regeneration: one lesson carries its stored id, one has a junk value.
const raw = {
  title: "Nest.js roadmap",
  expectedOutcomes: ["Ship a REST API"],
  modules: [
    {
      title: "Foundations",
      topics: ["dependency injection"],
      estimatedHours: 3,
      prerequisites: [],
      completionCriteria: "Build a controller",
      lessons: [
        { title: "Setup", durationMinutes: 30, topics: ["cli"], hasKnowledgeCheck: true },
        { title: "Providers", durationMinutes: 45, topics: ["di"] },
      ],
    },
    {
      title: "Database",
      topics: ["mongoose"],
      estimatedHours: 2,
      prerequisites: ["Foundations"],
      lessons: [
        { title: "Inject", durationMinutes: 40, lessonId: "aaaaaaaaaaaaaaaaaaaaaaaa" },
        { title: "New material", durationMinutes: 20, lessonId: "lesson-1" },
      ],
    },
  ],
};

const plan = normalizePlan(raw, answers);
const lessons = plan.modules.flatMap((m) => m.lessons);

assert.ok(lessons.every((l) => /^[a-f0-9]{24}$/i.test(l.lessonId)),
  "every lesson gets a 24-hex lessonId");
assert.equal(new Set(lessons.map((l) => l.lessonId)).size, lessons.length,
  "lessonIds are unique");
assert.equal(lessons[2].lessonId, "aaaaaaaaaaaaaaaaaaaaaaaa",
  "untouched module keeps its stored id (completed progress survives regeneration)");
assert.notEqual(lessons[3].lessonId, "aaaaaaaaaaaaaaaaaaaaaaaa",
  "junk id is replaced with a minted one");

// Full re-generation (no stored ids anywhere) produces all-fresh ids.
const fresh = normalizePlan({
  title: "Fresh",
  modules: raw.modules.map((m) => ({ ...m, lessons: m.lessons.map(({ lessonId, ...l }) => l) })),
}, answers);
const freshIds = fresh.modules.flatMap((m) => m.lessons).map((l) => l.lessonId);
assert.ok(freshIds.every((id) => /^[a-f0-9]{24}$/i.test(id)), "fresh generation mints ids");

console.log(`✓ test-plan-lesson-ids (${lessons.length} lessons: ids assigned, preserved, unique)`);
