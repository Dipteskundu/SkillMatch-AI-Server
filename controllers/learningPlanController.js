// controllers/learningPlanController.js
// Learning plans: enrollment (LH-005), AI generation (LH-006/008) and
// review/customisation (LH-009). Every route is authenticated and
// owner-scoped: a plan belonging to someone else answers 404, never 403,
// so record existence is never leaked.
//
// LH-021: plans never read or write the recruitment collections
// (skill_tests / assessment_results).

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { generateWithFallback } from "../services/gemini.service.js";
import {
  validateDiscoveryAnswers,
  normalizePlan,
  buildPlanPrompt,
  recommendDiagnostic,
  buildWeeklySchedule,
  getAdaptiveRecommendations,
} from "../services/learningPlan.service.js";

const DEFAULT_WEEKS = 8;

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

/** Owner-scoped lookup — returns null for missing OR foreign plans (both → 404). */
async function findOwnedPlan(db, id, uid) {
  if (!ObjectId.isValid(String(id))) return null;
  const plan = await db
    .collection("user_learning_plans")
    .findOne({ _id: new ObjectId(String(id)) });
  if (!plan || String(plan.userId) !== String(uid)) return null;
  return plan;
}

/** Snapshot the plan's prior state so revisions preserve completed work. */
async function recordVersion(db, plan, reason) {
  const versions = db.collection("learning_plan_versions");
  const version = await versions.countDocuments({ planId: plan._id });
  await versions.insertOne({
    planId: plan._id,
    userId: plan.userId,
    version,
    reason,
    title: plan.title,
    status: plan.status,
    weeklyHours: plan.weeklyHours ?? null,
    estimatedWeeks: plan.estimatedWeeks ?? null,
    moduleCount: plan.moduleCount || 0,
    // Full prior state: assessment history itself lives in assessment_attempts
    // (LH-021) and is therefore never touched by a plan revision.
    snapshot: plan,
    createdAt: new Date(),
  });
}

/** Persist self-reported skills from the questionnaire (spec: upsert). */
async function upsertSkillProfile(db, uid, answers) {
  const now = new Date();
  await db.collection("user_skill_profiles").updateOne(
    { userId: uid },
    {
      $set: {
        userId: uid,
        goal: answers.goal,
        skills: answers.existingSkills,
        proficiency: answers.proficiency,
        targetOutcome: answers.targetOutcome,
        targetJobRole: answers.targetJobRole || null,
        weakAreas: answers.weakAreas || [],
        learningPreference: answers.learningPreference || [],
        language: answers.language || "English",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

function pathFilter(idOrSlug) {
  const value = String(idOrSlug ?? "").trim();
  if (ObjectId.isValid(value) && String(new ObjectId(value)) === value) {
    return { _id: new ObjectId(value) };
  }
  return { slug: value.toLowerCase() };
}

// ── POST /api/v1/learning/enrollments ─────────────────────────────
// Copies a published path into a personal plan. The published source
// stays immutable — the plan holds its own structural snapshot, so later
// admin edits to the path never rewrite a learner's plan.
export async function enrollInPath(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;
    const requested = req.body?.pathId;

    if (!requested || typeof requested !== "string" || !requested.trim()) {
      return fail(res, 400, "pathId is required");
    }

    const path = await db
      .collection("learning_paths")
      .findOne(pathFilter(requested));
    if (!path || path.status !== "published") {
      return fail(res, 404, "Learning path not found");
    }

    // Enrolling twice returns the existing plan instead of duplicating it.
    const existing = await db
      .collection("user_learning_plans")
      .findOne({ userId: uid, sourcePathId: path._id });
    if (existing) {
      // completedLessonIds lets clients resume at the next lesson on re-start
      // instead of jumping back to lesson 1.
      const doneRows = await db
        .collection("learning_progress")
        .find({ userId: uid, planId: existing._id, completed: true })
        .toArray();
      return res.status(200).json({
        success: true,
        data: { ...existing, completedLessonIds: doneRows.map((r) => r.lessonId) },
        created: false,
      });
    }

    const modules = await db
      .collection("learning_modules")
      .find({ pathId: path._id })
      .sort({ order: 1 })
      .toArray();
    const lessons = modules.length
      ? await db
          .collection("learning_lessons")
          .find({ moduleId: { $in: modules.map((m) => m._id) }, status: "published" })
          .sort({ order: 1 })
          .toArray()
      : [];

    const now = new Date();
    const snapshot = modules.map((mod) => ({
      moduleId: mod._id,
      order: mod.order,
      title: mod.title,
      slug: mod.slug,
      estimatedHours: mod.estimatedHours ?? null,
      prerequisites: mod.prerequisites || [],
      completionCriteria: mod.completionCriteria || "",
      lessons: lessons
        .filter((l) => String(l.moduleId) === String(mod._id))
        .map((l) => ({
          lessonId: l._id,
          order: l.order,
          title: l.title,
          durationMinutes: l.durationMinutes ?? 30,
          topics: l.topics || [],
          isPreview: l.isPreview === true,
        })),
    }));

    const plan = {
      userId: uid,
      source: "enrollment",
      sourcePathId: path._id,
      sourcePathSlug: path.slug,
      title: path.title,
      description: path.description || "",
      level: path.level,
      topic: path.topic || null,
      category: path.category || null,
      learningGoal: path.title,
      startingLevel: path.level,
      targetOutcome: null,
      expectedOutcomes: path.objectives || [],
      // Enrollment has no questionnaire, so it carries no invented schedule.
      weeklyHours: null,
      estimatedWeeks: null,
      estimatedHours: path.estimatedHours ?? null,
      estimatedDuration: path.estimatedDuration || null,
      discovery: null,
      diagnostic: { status: "not-taken", recommended: false, reasons: [] },
      modules: snapshot,
      weeklySchedule: null,
      assessmentMilestones: [
        ...modules.map((m) => ({ module: m.title, type: "module" })),
        { module: null, type: "final" },
      ],
      moduleCount: snapshot.length,
      lessonCount: snapshot.reduce((n, m) => n + m.lessons.length, 0),
      optionalTopics: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("user_learning_plans").insertOne(plan);
    return res.status(201).json({
      success: true,
      data: { ...plan, _id: result.insertedId, completedLessonIds: [] },
      created: true,
    });
  } catch (error) {
    console.error("POST /learning/enrollments failed:", error);
    return fail(res, 500, "Failed to enroll in this path");
  }
}

// ── POST /api/v1/learning/plans/generate ──────────────────────────
// Strictly rate-limited at the route (AI cost). Validates the five
// required questions, calls Gemini, then schema-validates before storage
// so a malformed model response is a 502, never a stored bad plan.
export async function generatePlan(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;

    const validation = validateDiscoveryAnswers(req.body);
    if (!validation.ok) {
      return fail(res, 400, "Please answer all required questions", {
        errors: validation.errors,
      });
    }

    const answers = {
      ...validation.answers,
      estimatedWeeks: validation.answers.completionWeeks || DEFAULT_WEEKS,
    };

    let raw;
    try {
      const { text } = await generateWithFallback(buildPlanPrompt(answers));
      // House idiom (gemini.service / aiQuestionService): strip code fences.
      let jsonStr = text;
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
      raw = JSON.parse(jsonStr);
    } catch (err) {
      console.error("Plan generation (AI) failed:", err?.message || err);
      return fail(res, 502, "Plan generation failed. Please try again.");
    }

    let body;
    try {
      body = normalizePlan(raw, answers);
    } catch (err) {
      console.error("Plan generation (schema) failed:", err?.message || err);
      return fail(res, 502, "Plan generation failed. Please try again.");
    }

    const now = new Date();
    const diagnostic = recommendDiagnostic(answers);
    const base = {
      userId: uid,
      source: "ai",
      sourcePathId: null,
      sourcePathSlug: null,
      description: "",
      level: answers.proficiency,
      topic: null,
      category: null,
      discovery: answers,
      diagnostic: { ...diagnostic, status: "pending" },
      optionalTopics: [],
      moduleCount: body.modules.length,
      lessonCount: body.modules.reduce((n, m) => n + m.lessons.length, 0),
      status: "draft",
      updatedAt: now,
    };

    // A learner only ever holds one unsaved AI draft: regenerating the
    // questionnaire replaces it rather than accumulating unremovable drafts
    // (there is deliberately no DELETE endpoint in the spec).
    const draft = await db
      .collection("user_learning_plans")
      .findOne({ userId: uid, source: "ai", status: "draft" });

    let planId;
    if (draft) {
      await recordVersion(db, draft, "regenerated");
      planId = draft._id;
      await db
        .collection("user_learning_plans")
        .updateOne({ _id: draft._id }, { $set: { ...base, ...body } });
    } else {
      const doc = { ...base, ...body, createdAt: now };
      const result = await db.collection("user_learning_plans").insertOne(doc);
      planId = result.insertedId;
    }

    await upsertSkillProfile(db, uid, answers);

    const plan = await db
      .collection("user_learning_plans")
      .findOne({ _id: planId });

    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    console.error("POST /learning/plans/generate failed:", error);
    return fail(res, 500, "Failed to generate a plan");
  }
}

// ── GET /api/v1/learning/my-plans ─────────────────────────────────
// Returns full plan documents (they hold structure, not lesson prose)
// with progress derived from learning_progress in a single aggregation.
export async function listMyPlans(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;

    const plans = await db
      .collection("user_learning_plans")
      .find({ userId: uid })
      .sort({ updatedAt: -1 })
      .toArray();

    // AI-plan lessons saved before per-lesson ids existed cannot be
    // deep-linked ("Continue" built `?lesson=undefined` and 404'd) —
    // assign + persist ids once here so old plans heal themselves.
    for (const plan of plans) {
      if (plan.source !== "ai") continue;
      let changed = false;
      for (const mod of plan.modules || []) {
        for (const lesson of mod.lessons || []) {
          if (!lesson.lessonId) {
            lesson.lessonId = String(new ObjectId());
            changed = true;
          }
        }
      }
      if (changed) {
        await db
          .collection("user_learning_plans")
          .updateOne({ _id: plan._id }, { $set: { modules: plan.modules } });
      }
    }

    const planIds = plans.map((p) => p._id);
    // learning_progress rows are written by Phase 3 with completed: true.
    const progressRows = planIds.length
      ? await db
          .collection("learning_progress")
          .aggregate([
            { $match: { userId: uid, planId: { $in: planIds }, completed: true } },
            { $group: { _id: "$planId", done: { $sum: 1 }, completedLessonIds: { $push: "$lessonId" } } },
          ])
          .toArray()
      : [];
    const doneByPlan = new Map(progressRows.map((r) => [String(r._id), r]));

    // 56 days of completed-lesson activity (LH-025 dashboards): one row per
    // day with lesson count and tracked minutes, so the client can bucket
    // weekly bars, streaks and the weekly goal without a second endpoint.
    const since = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
    const activityRows = await db
      .collection("learning_progress")
      .find({ userId: uid, completed: true, completedAt: { $gte: since } })
      .project({ completedAt: 1, timeSpentMinutes: 1 })
      .toArray();
    const activityByDay = new Map();
    for (const row of activityRows) {
      const day = new Date(row.completedAt).toISOString().slice(0, 10);
      const bucket = activityByDay.get(day) || { day, lessons: 0, minutes: 0 };
      bucket.lessons += 1;
      bucket.minutes += Number(row.timeSpentMinutes) || 0;
      activityByDay.set(day, bucket);
    }
    const activity = [...activityByDay.values()].sort((a, b) =>
      a.day < b.day ? -1 : 1,
    );

    const data = plans.map((plan) => {
      const row = doneByPlan.get(String(plan._id));
      const done = row?.done || 0;
      const total = plan.lessonCount || 0;
      return {
        ...plan,
        progress: {
          completedLessons: done,
          totalLessons: total,
          percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
        },
        // Lets clients compute "next lesson to resume" client-side.
        completedLessonIds: row?.completedLessonIds || [],
      };
    });

    res.status(200).json({ success: true, data, count: data.length, activity });
  } catch (error) {
    console.error("GET /learning/my-plans failed:", error);
    return fail(res, 500, "Failed to load your plans");
  }
}

// ── PATCH /api/v1/learning/plans/:id ──────────────────────────────
// Whitelisted fields only. Saving a draft (status: active) is how the
// "Save" button works — no extra endpoint beyond the spec's route table.
export async function updatePlan(req, res) {
  try {
    const db = getDB();
    const plan = await findOwnedPlan(db, req.params.id, req.user.uid);
    if (!plan) return fail(res, 404, "Learning plan not found");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const set = {};
    const errors = [];

    if (body.title !== undefined) {
      const title = String(body.title).trim().slice(0, 120);
      if (title.length < 2) errors.push("title must be at least 2 characters");
      else set.title = title;
    }

    if (body.weeklyHours !== undefined) {
      const hours = Number(body.weeklyHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 80) {
        errors.push("weeklyHours must be between 1 and 80");
      } else {
        set.weeklyHours = Math.round(hours);
      }
    }

    if (body.estimatedWeeks !== undefined) {
      const weeks = Number(body.estimatedWeeks);
      if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
        errors.push("estimatedWeeks must be between 1 and 52");
      } else {
        set.estimatedWeeks = Math.round(weeks);
      }
    }

    if (body.optionalTopics !== undefined) {
      if (!Array.isArray(body.optionalTopics)) {
        errors.push("optionalTopics must be an array");
      } else {
        set.optionalTopics = [
          ...new Set(
            body.optionalTopics
              .map((t) => String(t ?? "").trim().slice(0, 60))
              .filter(Boolean),
          ),
        ].slice(0, 10);
      }
    }

    if (body.status !== undefined) {
      if (!["draft", "active"].includes(body.status)) {
        errors.push("status must be draft or active");
      } else {
        set.status = body.status;
      }
    }

    if (errors.length) return fail(res, 400, "Invalid plan update", { errors });
    if (!Object.keys(set).length) return fail(res, 400, "No valid fields to update");

    // Weekly-hours changes must move the schedule with them.
    if (set.weeklyHours && Array.isArray(plan.modules) && plan.modules.length) {
      set.weeklySchedule = buildWeeklySchedule(plan.modules, set.weeklyHours);
      if (!set.estimatedWeeks) {
        set.estimatedWeeks = Math.max(
          1,
          Math.ceil(plan.estimatedHours / set.weeklyHours),
        );
      }
    }

    await recordVersion(db, plan, "edited");

    const now = new Date();
    await db
      .collection("user_learning_plans")
      .updateOne({ _id: plan._id }, { $set: { ...set, updatedAt: now } });

    const updated = await db
      .collection("user_learning_plans")
      .findOne({ _id: plan._id });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("PATCH /learning/plans/:id failed:", error);
    return fail(res, 500, "Failed to update the plan");
  }
}

// ── POST /api/v1/learning/plans/:id/regenerate ────────────────────
// Regenerates only uncompleted sections. Completed modules are refused
// with 400, progress rows and assessment attempts are never rewritten.
export async function regeneratePlan(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;
    const plan = await findOwnedPlan(db, req.params.id, uid);
    if (!plan) return fail(res, 404, "Learning plan not found");

    if (plan.source !== "ai" || !plan.discovery) {
      return fail(
        res,
        400,
        "Enrolled paths follow their published order and cannot be regenerated",
      );
    }

    const existing = Array.isArray(plan.modules) ? plan.modules : [];
    if (!existing.length) return fail(res, 400, "Plan has no modules to regenerate");

    const requested = Array.isArray(req.body?.moduleIndexes)
      ? req.body.moduleIndexes
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n < existing.length)
      : existing.map((_, i) => i); // default: whole plan
    if (!requested.length) return fail(res, 400, "No valid modules requested");

    const completedRows = await db
      .collection("learning_progress")
      .find({ userId: uid, planId: plan._id, completed: true })
      .toArray();
    const completedLessons = new Set(completedRows.map((r) => String(r.lessonId)));

    const isCompleted = (mod) =>
      (mod.lessons || []).some((l) => completedLessons.has(String(l.lessonId)));
    const blocked = requested.filter((i) => isCompleted(existing[i]));
    if (blocked.length) {
      return fail(
        res,
        400,
        "Completed sections are preserved and cannot be regenerated",
        { preservedModules: blocked.map((i) => existing[i].title) },
      );
    }

    const answers = { ...plan.discovery, estimatedWeeks: plan.estimatedWeeks || DEFAULT_WEEKS };
    const targetTitles = requested.map((i) => existing[i].title).join(", ");

    let raw;
    try {
      const prompt = [
        buildPlanPrompt(answers),
        "",
        "This is a REVISION of an existing roadmap. Replace ONLY these modules:",
        targetTitles,
        "Keep every other part unchanged by returning the FULL ordered module list,",
        "copying untouched modules verbatim and replacing the named ones with new material.",
        `Existing modules in order: ${existing.map((m) => m.title).join(" | ")}`,
        `Current plan title: ${plan.title}`,
      ].join("\n");

      const { text } = await generateWithFallback(prompt);
      let jsonStr = text;
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
      raw = JSON.parse(jsonStr);
    } catch (err) {
      console.error("Plan regeneration (AI) failed:", err?.message || err);
      return fail(res, 502, "Regeneration failed. Your existing plan is unchanged.");
    }

    // Splice AI output back into the preserved ordering: untouched modules
    // keep their current definition, so partial responses lose nothing.
    const aiModules = Array.isArray(raw?.modules) ? raw.modules.filter(Boolean) : [];
    const targetSet = new Set(requested);
    let aiCursor = 0;
    const assembled = existing.map((mod, index) =>
      targetSet.has(index) && aiCursor < aiModules.length
        ? aiModules[aiCursor++]
        : mod,
    );
    raw = { ...raw, modules: assembled };

    let body;
    try {
      body = normalizePlan(raw, answers);
    } catch (err) {
      console.error("Plan regeneration (schema) failed:", err?.message || err);
      return fail(res, 502, "Regeneration failed. Your existing plan is unchanged.");
    }

    const now = new Date();
    const next = {
      ...body,
      moduleCount: body.modules.length,
      lessonCount: body.modules.reduce((n, m) => n + m.lessons.length, 0),
      updatedAt: now,
    };

    await recordVersion(db, plan, "regenerated");
    await db
      .collection("user_learning_plans")
      .updateOne({ _id: plan._id }, { $set: next });

    const updated = await db
      .collection("user_learning_plans")
      .findOne({ _id: plan._id });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("POST /learning/plans/:id/regenerate failed:", error);
    return fail(res, 500, "Failed to regenerate the plan");
  }
}

/** GET /api/v1/learning/recommendations (LH-023).
 *  Returns adaptive topic-focused suggestions for the next lesson
 *  or job-gap roles, based on the user's lesson history and profile. */
export async function getAdaptiveRecommendationsCtrl(req, res) {
  try {
    const db = getDB();
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Fetch user's completed lessons and weak topics from progress
    const progress = await db
      .collection("learning_progress")
      .find({ userId: uid })
      .sort({ updatedAt: -1 })
      .limit(1)
      .toArray();

    const completedLessons = progress.length > 0
      ? progress[0].completedLessons || []
      : [];

    const weakTopics = progress.length > 0
      ? progress[0].weakTopics || []
      : [];

    // Fetch the most recent lesson's topics
    const lessons = await db
      .collection("learning_lessons")
      .find({})
      .sort({ updatedAt: -1 })
      .limit(1)
      .toArray();

    const lessonTopics = lessons.length > 0
      ? lessons[0].topics || []
      : [];

    const proficiency = req.user?.role || "candidate";

    const { recommendations } = getAdaptiveRecommendations(
      lessonTopics,
      weakTopics,
      proficiency,
      completedLessons,
    );

    return res.status(200).json({
      success: true,
      data: { recommendations, generatedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("GET /learning/recommendations failed:", error);
    return res.status(500).json({ success: false, message: "Failed to generate recommendations" });
  }
}

/** GET /api/v1/learning/certificate (LH-027).
 *  Returns certificate eligibility and details for path completion. */
export async function getCertificateCtrl(req, res) {
  try {
    const db = getDB();
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { pathId } = req.query;

    // Fetch user's progress for this path
    const progress = await db
      .collection("learning_progress")
      .findOne({ userId: uid, "pathId": pathId });

    const certificateInfo = getCertificateInfo(pathId, progress);

    return res.status(200).json({
      success: true,
      data: { ...certificateInfo, pathId },
    });
  } catch (error) {
    console.error("GET /learning/certificate failed:", error);
    return res.status(500).json({ success: false, message: "Failed to generate certificate info" });
  }
}
