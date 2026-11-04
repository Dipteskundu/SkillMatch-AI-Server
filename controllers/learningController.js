// controllers/learningController.js
// Public Learning Hub content API (spec v1.2 — Phase 1 & 2 & 3).
// Guests may browse paths and previews; full lesson content requires
// authentication + enrollment (Phase 2); lesson AI assistant (Phase 3).

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { generateWithFallback } from "../services/gemini.service.js";

// HTML escape targets are assembled from parts: a literal "&" in
// source has proven vulnerable to entity-decoding by tooling in transit.
const ET_AMP = "&" + "amp;";
const ET_LT = "&" + "lt;";
const ET_GT = "&" + "gt;";

const PATH_SUMMARY_FIELDS = {
  _id: 1,
  slug: 1,
  title: 1,
  topic: 1,
  level: 1,
  description: 1,
  objectives: 1,
  prerequisites: 1,
  estimatedDuration: 1,
  moduleCount: 1,
  lessonCount: 1,
  difficulty: 1,
  category: 1,
  tags: 1,
  order: 1,
  status: 1,
  updatedAt: 1,
};

/** Accept either a Mongo ObjectId or a readable slug. */
function pathFilter(idOrSlug) {
  if (ObjectId.isValid(idOrSlug) && String(new ObjectId(idOrSlug)) === idOrSlug) {
    return { _id: new ObjectId(idOrSlug) };
  }
  return { slug: String(idOrSlug).toLowerCase().trim() };
}

/**
 * GET /api/v1/learning/paths
 * Published paths only, ordered. Lessons are never included in the list.
 */
export async function listPaths(req, res) {
  try {
    const db = getDB();
    const { level, category, search } = req.query;

    const filter = { status: "published" };
    if (level) filter.level = level;
    if (category) filter.category = category;
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: safe, $options: "i" } },
        { topic: { $regex: safe, $options: "i" } },
        { tags: { $regex: safe, $options: "i" } },
      ];
    }

    const paths = await db
      .collection("learning_paths")
      .find(filter, { projection: PATH_SUMMARY_FIELDS })
      .sort({ order: 1, title: 1 })
      .toArray();

    res.status(200).json({ success: true, data: paths, count: paths.length });
  } catch (error) {
    console.error("GET /learning/paths failed:", error);
    res.status(500).json({ success: false, message: "Failed to load learning paths" });
  }
}

/**
 * GET /api/v1/learning/paths/:id
 * Path detail with ordered modules and lessons.
 *
 * Guest / non-enrolled callers get lesson metadata + preview content only;
 * full `content` is stripped server-side so answer-free previews are the
 * only thing that ever reaches an unauthenticated browser (LH-005).
 */
export async function getPathById(req, res) {
  try {
    const db = getDB();
    const path = await db
      .collection("learning_paths")
      .findOne(pathFilter(req.params.id), { projection: PATH_SUMMARY_FIELDS });

    if (!path || path.status !== "published") {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    const modules = await db
      .collection("learning_modules")
      .find({ pathId: path._id }, { projection: { content: 0 } })
      .sort({ order: 1 })
      .toArray();

    const moduleIds = modules.map((m) => m._id);
    const lessons = moduleIds.length
      ? await db
          .collection("learning_lessons")
          .find(
            { moduleId: { $in: moduleIds }, status: "published" },
            {
              projection: {
                moduleId: 1,
                order: 1,
                title: 1,
                durationMinutes: 1,
                isPreview: 1,
                objectives: 1,
                topics: 1,
                // Never returned to a non-enrolled caller (see below):
                content: 1,
              },
            },
          )
          .sort({ order: 1 })
          .toArray()
      : [];

    // Enrolled learners get full lesson content; everyone else gets
    // metadata plus explicitly-previewed lessons only (LH-005).
    let canSeeFullContent = false;
    if (req.user?.uid) {
      const enrollment = await db
        .collection("user_learning_plans")
        .findOne(
          { userId: req.user.uid, sourcePathId: path._id },
          { projection: { _id: 1 } },
        );
      canSeeFullContent = Boolean(enrollment);
    }

    // Answer keys never leave the server for a non-enrolled caller, even on a
    // preview lesson: show the question, withhold correctIndex + explanation.
    const stripAnswers = (content) => {
      if (!content || !Array.isArray(content.knowledgeCheck)) return content;
      return {
        ...content,
        knowledgeCheck: content.knowledgeCheck.map(
          ({ correctIndex, explanation, ...q }) => q,
        ),
      };
    };

    const safeLessons = lessons.map((lesson) => {
      const { content, ...meta } = lesson;
      if (canSeeFullContent) return { ...meta, content };
      if (!lesson.isPreview) return meta;
      return { ...meta, content: stripAnswers(content) };
    });

    const modulesWithLessons = modules.map((m) => ({
      ...m,
      lessons: safeLessons.filter((l) => String(l.moduleId) === String(m._id)),
    }));

    res.status(200).json({
      success: true,
      data: { ...path, modules: modulesWithLessons },
    });
  } catch (error) {
    console.error("GET /learning/paths/:id failed:", error);
    res.status(500).json({ success: false, message: "Failed to load learning path" });
  }
}

/**
 * PATCH /api/v1/learning/progress
 * Update lesson progress — resumable, owner-scoped (LH-010).
 */
export async function updateProgress(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;
    const { lessonId, completed, timeSpentMinutes, planId } = req.body;

    if (!lessonId || completed === undefined) {
      return res.status(400).json({
        success: false,
        message: "lessonId and completed are required",
      });
    }

    if (typeof completed !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "completed must be a boolean",
      });
    }

    if (timeSpentMinutes !== undefined && typeof timeSpentMinutes !== "number") {
      return res.status(400).json({
        success: false,
        message: "timeSpentMinutes must be a number",
      });
    }

    const now = new Date();
    // Link the row to the caller's plan so completions count toward its
    // percentage (listMyPlans aggregates learning_progress by planId).
    let storedPlanId = null;
    if (planId) {
      try {
        storedPlanId = new ObjectId(String(planId));
      } catch {
        storedPlanId = null;
      }
    }
    const set = {
      userId: uid,
      lessonId,
      completed,
      timeSpentMinutes: completed ? timeSpentMinutes : (timeSpentMinutes || 0),
      completedAt: completed ? now : undefined,
      updatedAt: now,
    };
    if (storedPlanId) set.planId = storedPlanId;
    await db.collection("learning_progress").updateOne(
      { userId: uid, lessonId },
      {
        $set: set,
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    // Compute progress % for this user's plans
    const plans = await db
      .collection("user_learning_plans")
      .find({ userId: uid })
      .toArray();

    let totalLessons = 0;
    let completedLessons = 0;
    for (const plan of plans) {
      const lessons = await db
        .collection("learning_lessons")
        .find({ moduleId: { $in: plan.modules?.map((m) => m.moduleId) || [] } })
        .toArray();
      totalLessons += lessons.length;
      const done = await db
        .collection("learning_progress")
        .countDocuments({
          userId: uid,
          lessonId: { $in: lessons.map((l) => l._id) },
          completed: true,
        });
      completedLessons += done;
    }

    const percent = totalLessons ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;

    return res.status(200).json({
      success: true,
      data: { progressPercent: percent },
    });
  } catch (error) {
    console.error("PATCH /learning/progress failed:", error);
    return res.status(500).json({ success: false, message: "Failed to update progress" });
  }
}

/**
 * Teaching prose for an AI-plan lesson — those lessons live only inside
 * the owner's plan document, so there is no learning_lessons doc to read.
 * AI text is escaped and paragraph-wrapped: safe HTML for the client's
 * dangerouslySetInnerHTML without adding a sanitizer dependency.
 */
async function generatePlanLessonContent(plan, module, lesson) {
  const prompt = [
    "You are a technical mentor writing lesson material for a job-skills learning platform.",
    "Write the lesson body the learner reads in one sitting.",
    "",
    `Learner: ${plan.startingLevel || "beginner"} level. Goal: ${plan.learningGoal || plan.title}.`,
    `Module: ${module.title} (topics: ${(module.topics || []).join(", ") || "n/a"}).`,
    `Lesson: ${lesson.title} (${lesson.kind === "activity" ? "hands-on activity" : "lesson"}, ~${lesson.durationMinutes} minutes).`,
    lesson.topics?.length ? `Cover exactly these topics: ${lesson.topics.join(", ")}.` : "",
    "",
    "Rules:",
    "- Plain prose in paragraphs separated by blank lines. NO markdown, NO headings, NO code fences.",
    lesson.kind === "activity"
      ? "- This is a guided exercise: numbered steps in prose, what to try, what to observe."
      : "- Explain the concepts, give concrete examples, end with what to practice next.",
    "- 300 to 450 words.",
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await generateWithFallback(prompt);
  const escapeHtml = (s) =>
    s.replace(/&/g, ET_AMP)
      .replace(/</g, ET_LT)
      .replace(/>/g, ET_GT);
  return {
    introduction: `Generated for your plan "${plan.title}" around ${
      plan.startingLevel || "beginner"
    } level.`,
    explanation: text
      .trim()
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join(""),
  };
}

/**
 * Resolve an AI-plan lesson from the caller's own plan. Owner-scoped by
 * userId — a plan lesson id must never serve another user's request.
 * Prose is generated once on first open and cached into the plan.
 */
async function findPlanLesson(db, uid, lessonId) {
  const plan = await db
    .collection("user_learning_plans")
    .findOne({ userId: uid, "modules.lessons.lessonId": lessonId });
  if (!plan) return null;

  let ownerModule = null;
  let item = null;
  for (const mod of plan.modules || []) {
    const found = (mod.lessons || []).find((l) => String(l.lessonId) === lessonId);
    if (found) {
      ownerModule = mod;
      item = found;
      break;
    }
  }
  if (!item) return null;

  if (!item.content) {
    try {
      item.content = await generatePlanLessonContent(plan, ownerModule, item);
      // Cache-on-first-open so later opens skip the AI round trip.
      // updatedAt is deliberately NOT touched — plans sort on it in my-plans.
      await db.collection("user_learning_plans").updateOne(
        { _id: plan._id, "modules.lessons.lessonId": lessonId },
        { $set: { "modules.$[m].lessons.$[l].content": item.content } },
        {
          arrayFilters: [
            { "m.lessons.lessonId": lessonId },
            { "l.lessonId": lessonId },
          ],
        },
      );
    } catch (err) {
      console.error("Plan lesson prose generation failed:", err?.message || err);
      // Metadata-only lesson still renders; prose retries on next open.
    }
  }

  return {
    _id: item.lessonId,
    moduleId: null,
    title: item.title,
    order: item.order,
    durationMinutes: item.durationMinutes,
    kind: item.kind,
    topics: item.topics || [],
    objectives: item.topics || [],
    content: item.content || {},
    planId: String(plan._id),
  };
}

/**
 * GET /api/v1/learning/lessons/:id
 * Full lesson content requires auth + enrollment; guests see preview only (LH-005).
 */
export async function getLessonById(req, res) {
  try {
    const db = getDB();
    const lessonId = req.params.id;

    // Resolve by ObjectId or slug
    let lesson;
    if (ObjectId.isValid(lessonId) && String(new ObjectId(lessonId)) === lessonId) {
      lesson = await db.collection("learning_lessons").findOne({ _id: new ObjectId(lessonId) });
    } else {
      lesson = await db.collection("learning_lessons").findOne({ slug: String(lessonId).toLowerCase().trim() });
    }

    // AI-plan lessons have no learning_lessons document — resolve them from
    // the caller's own plan. Auth-only: guests keep the 404 (LH-005 posture).
    if (!lesson && req.user?.uid) {
      lesson = await findPlanLesson(db, req.user.uid, lessonId);
    }

    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }

    // Build response — always include metadata
    const { content, ...meta } = lesson;

    // Check if user has enrollment for this lesson's path
    let fullContent = { ...meta, content };

    // If no user, preview only: strip knowledgeCheck answers
    if (!req.user?.uid) {
      if (fullContent.knowledgeCheck && Array.isArray(fullContent.knowledgeCheck)) {
        fullContent.knowledgeCheck = fullContent.knowledgeCheck.map(
          ({ correctIndex, explanation, ...q }) => q,
        );
      }
    } else {
      // Authenticated — check enrollment via the lesson's module
      const module = await db.collection("learning_modules").findOne({ _id: lesson.moduleId });
      if (module) {
        const enrollment = await db.collection("user_learning_plans").findOne({
          userId: req.user.uid,
          sourcePathId: module.pathId,
        });
        if (!enrollment) {
          // Authenticated but not enrolled — preview only
          if (fullContent.knowledgeCheck && Array.isArray(fullContent.knowledgeCheck)) {
            fullContent.knowledgeCheck = fullContent.knowledgeCheck.map(
              ({ correctIndex, explanation, ...q }) => q,
            );
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: fullContent,
    });
  } catch (error) {
    console.error("GET /learning/lessons/:id failed:", error);
    return res.status(500).json({ success: false, message: "Failed to load lesson" });
  }
}

/**
 * POST /api/v1/learning/lessons/:id/ask
 * AI mentoring on a lesson — rate-limited per user (10/15min) (LH-011).
 */
export async function askLessonQuestion(req, res) {
  try {
    const db = getDB();
    const uid = req.user.uid;
    const lessonId = req.params.id;
    const { question } = req.body;

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      });
    }

    // Find the lesson to get context
    let lesson;
    if (ObjectId.isValid(lessonId) && String(new ObjectId(lessonId)) === lessonId) {
      lesson = await db.collection("learning_lessons").findOne({ _id: new ObjectId(lessonId) });
    } else {
      lesson = await db.collection("learning_lessons").findOne({ slug: String(lessonId).toLowerCase().trim() });
    }

    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }

    // Upsert chat history entry
    const now = new Date();
    await db.collection("lesson_chat_history").updateOne(
      { userId: uid, lessonId: lesson._id },
      {
        $push: {
          entries: {
            role: "user",
            content: question,
            createdAt: now,
          },
        },
        $set: {
          userId: uid,
          lessonId: lesson._id,
          lessonTitle: lesson.title,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    // Build prompt for Gemini
    const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    const genAI = process.env.GEMINI_API_KEY
      ? new (await import("@google/generative-ai")).GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      : null;

    let prompt = `You are a technical mentor for a learner on a skills platform.

Learner proficiency: beginner (default, since we don't have their profile here)
Question: ${question}

Lesson context:
- Title: ${lesson.title}
- Objectives: ${(lesson.objectives || []).join(", ")}
- Topics: ${(lesson.topics || []).join(", ")}
- Content excerpt: ${(lesson.content && lesson.content.explanation ? lesson.content.explanation.substring(0, 800) : "No explanation available.")}
- Knowledge check: ${lesson.content && lesson.content.knowledgeCheck
      ? `${lesson.content.knowledgeCheck[0]?.question} (options: ${lesson.content.knowledgeCheck[0]?.options?.join(", ")}). Answer key server-side.`
      : "No knowledge check defined."}

Rules:
- Answer as a concise mentor would — no markdown, no code execution.
- If the question is about running code, reply: "Code snippets are for reading only, never executed here. To experiment, use a REPL in your environment."
- Keep the answer under 200 tokens. Be concrete and technical, grounded in the lesson content above.
- No markdown fences, no commentary, just the answer.

`;

    if (!genAI) {
      return res.status(500).json({
        success: false,
        message: "Gemini API not configured",
      });
    }

    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response?.text() || "I'm having trouble reaching the AI mentor right now. Please try again.";

    // Persist the AI response
    await db.collection("lesson_chat_history").updateOne(
      { userId: uid, lessonId: lesson._id },
      {
        $push: {
          entries: {
            role: "model",
            content: text,
            createdAt: now,
          },
        },
      },
    );

    return res.status(200).json({
      success: true,
      data: { answer: text, lessonId: lesson._id, lessonTitle: lesson.title },
    });
  } catch (error) {
    console.error("POST /learning/lessons/:id/ask failed:", error);
    const message = error.message || "Plan generation failed. Please try again.";
    return res.status(502).json({ success: false, message });
  }
}
/** Admin CRUD for paths (LH-022). */
export async function createPath(req, res) {
  try {
    const db = getDB();
    const path = await db.collection("learning_paths").insertOne({
      title: req.body.title,
      topic: req.body.topic,
      level: req.body.level,
      description: req.body.description,
      objectives: req.body.objectives,
      prerequisites: req.body.prerequisites || [],
      estimatedDuration: req.body.estimatedDuration,
      moduleCount: req.body.moduleCount || 0,
      lessonCount: req.body.lessonCount || 0,
      category: req.body.category,
      difficulty: req.body.difficulty || "Beginner",
      tags: req.body.tags || [],
      order: req.body.order ?? 0,
      status: req.body.status ?? "published",
      updatedAt: new Date(),
    });
    return res.status(201).json({
      success: true,
      data: { ...path.ops[0], id: path.ops[0]._id },
    });
  } catch (error) {
    console.error("CREATE path failed:", error);
    return res.status(500).json({ success: false, message: "Failed to create path" });
  }
}

export async function updatePath(req, res) {
  try {
    const db = getDB();
    const pathId = req.params.id;
    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };
    const result = await db
      .collection("learning_paths")
      .updateOne({ _id: new ObjectId(pathId) }, { $set: updateData });
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Path not found" });
    }
    return res.status(200).json({
      success: true,
      data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("UPDATE path failed:", error);
    return res.status(500).json({ success: false, message: "Failed to update path" });
  }
}

export async function deletePath(req, res) {
  try {
    const db = getDB();
    const pathId = req.params.id;
    const result = await db.collection("learning_paths").deleteOne({ _id: new ObjectId(pathId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Path not found" });
    }
    return res.status(200).json({
      success: true,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("DELETE path failed:", error);
    return res.status(500).json({ success: false, message: "Failed to delete path" });
  }
}

/** Admin CRUD for modules (LH-022). */
export async function listModules(req, res) {
  try {
    const db = getDB();
    const modules = await db.collection("learning_modules").find().sort({ order: 1 }).toArray();
    return res.status(200).json({
      success: true,
      data: modules,
    });
  } catch (error) {
    console.error("LIST modules failed:", error);
    return res.status(500).json({ success: false, message: "Failed to list modules" });
  }
}

export async function createModule(req, res) {
  try {
    const db = getDB();
    const module = await db.collection("learning_modules").insertOne({
      title: req.body.title,
      description: req.body.description,
      pathId: req.body.pathId,
      order: req.body.order ?? 0,
      estimatedHours: req.body.estimatedHours,
      prerequisites: req.body.prerequisites || [],
      completionCriteria: req.body.completionCriteria || "",
      status: req.body.status ?? "published",
      updatedAt: new Date(),
    });
    return res.status(201).json({
      success: true,
      data: { ...module.ops[0], id: module.ops[0]._id },
    });
  } catch (error) {
    console.error("CREATE module failed:", error);
    return res.status(500).json({ success: false, message: "Failed to create module" });
  }
}

export async function updateModule(req, res) {
  try {
    const db = getDB();
    const moduleId = req.params.id;
    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };
    const result = await db.collection("learning_modules").updateOne(
      { _id: new ObjectId(moduleId) },
      { $set: updateData },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Module not found" });
    }
    return res.status(200).json({
      success: true,
      data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("UPDATE module failed:", error);
    return res.status(500).json({ success: false, message: "Failed to update module" });
  }
}

export async function deleteModule(req, res) {
  try {
    const db = getDB();
    const moduleId = req.params.id;
    const result = await db.collection("learning_modules").deleteOne({ _id: new ObjectId(moduleId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Module not found" });
    }
    return res.status(200).json({
      success: true,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("DELETE module failed:", error);
    return res.status(500).json({ success: false, message: "Failed to delete module" });
  }
}

/** Admin CRUD for lessons (LH-022). */
export async function listLessons(req, res) {
  try {
    const db = getDB();
    const lessons = await db.collection("learning_lessons").find().sort({ order: 1 }).toArray();
    return res.status(200).json({
      success: true,
      data: lessons,
    });
  } catch (error) {
    console.error("LIST lessons failed:", error);
    return res.status(500).json({ success: false, message: "Failed to list lessons" });
  }
}

export async function createLesson(req, res) {
  try {
    const db = getDB();
    const lesson = await db.collection("learning_lessons").insertOne({
      title: req.body.title,
      moduleId: req.body.moduleId,
      order: req.body.order ?? 0,
      durationMinutes: req.body.durationMinutes,
      isPreview: req.body.isPreview ?? false,
      objectives: req.body.objectives || [],
      topics: req.body.topics || [],
      content: req.body.content || {},
      knowledgeCheck: req.body.knowledgeCheck || [],
      summary: req.body.summary,
      status: req.body.status ?? "published",
      updatedAt: new Date(),
    });
    return res.status(201).json({
      success: true,
      data: { ...lesson.ops[0], id: lesson.ops[0]._id },
    });
  } catch (error) {
    console.error("CREATE lesson failed:", error);
    return res.status(500).json({ success: false, message: "Failed to create lesson" });
  }
}

export async function updateLesson(req, res) {
  try {
    const db = getDB();
    const lessonId = req.params.id;
    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };
    const result = await db.collection("learning_lessons").updateOne(
      { _id: new ObjectId(lessonId) },
      { $set: updateData },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }
    return res.status(200).json({
      success: true,
      data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("UPDATE lesson failed:", error);
    return res.status(500).json({ success: false, message: "Failed to update lesson" });
  }
}

export async function deleteLesson(req, res) {
  try {
    const db = getDB();
    const lessonId = req.params.id;
    const result = await db.collection("learning_lessons").deleteOne({ _id: new ObjectId(lessonId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }
    return res.status(200).json({
      success: true,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("DELETE lesson failed:", error);
    return res.status(500).json({ success: false, message: "Failed to delete lesson" });
  }
}
