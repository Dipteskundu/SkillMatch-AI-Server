// controllers/adminLearningController.js
// SkillForge Learning Hub (Phase 4) — ADMIN CONTENT PIPELINE.
//
//   outline (admin-authored) ──> draft ──generate──> in_review ──publish──> published
//                                                    (human edits)          (versioned)
//
// Generation is the ONLY AI-dependent step: if services/llm.js reports no
// provider (isLLMAvailable() === false) or the model fails twice per lesson,
// we return a structured 503 AI_UNAVAILABLE — the admin outline/draft stays
// saved, nothing is half-published. Quiz answers are stored as salted hashes
// (sha256(`${salt}:idx:${answerIndex}`)) alongside the plaintext index, which
// is needed for human review but NEVER serialized to learners.

import crypto from "node:crypto";
import { Technology, LearningPath } from "../models/index.js";
import { generateJSON, isLLMAvailable } from "../services/llm.js";
import { hashExpectedAnswer } from "../services/skillEvaluationService.js";
import { quizDraftSchema, lessonContentSchema } from "../lib/learningSchemas.js";
import { slugify } from "../models/skillSeed.js";

const QUIZ_QUESTION_COUNT = 5;

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, message, code, error: { code, message } });
}

function contentLogEntry(action, by, note = "") {
  return { at: new Date(), by, action, note };
}

async function uniquePathSlug(title) {
  const base = slugify(title) || `path-${Date.now()}`;
  let slug = base;
  for (let i = 2; await LearningPath.findOne({ slug }); i += 1) {
    slug = `${base}-${i}`;
  }
  return slug;
}

function pathSummary(doc) {
  const lessonCount = (doc.modules || []).reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
  const lessonsWithContent = (doc.modules || []).reduce(
    (sum, m) => sum + (m.lessons || []).filter((l) => l.content && (l.content.intro || "").length > 0).length,
    0,
  );
  return {
    _id: String(doc._id),
    title: doc.title,
    slug: doc.slug,
    level: doc.level,
    skillSlug: doc.skillSlug,
    estimatedHours: doc.estimatedHours,
    status: doc.status,
    moduleCount: (doc.modules || []).length,
    lessonCount,
    lessonsWithContent,
    quizQuestionCount: doc.quiz?.questions?.length || 0,
    currentVersion: (doc.versions || []).reduce((max, v) => Math.max(max, v.version || 0), 0),
    updatedAt: doc.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. POST /api/admin/learning/outlines — create a draft
// ─────────────────────────────────────────────────────────────

export const createOutline = async (req, res) => {
  try {
    const { technologySlug, skillSlug, title, level, estimatedHours, modules } = req.body;
    const uid = req.user.uid;

    const technology = await Technology.findOne({ slug: technologySlug });
    if (!technology) {
      return res.status(404).json({
        success: false,
        message: `Technology "${technologySlug}" not found. Run "npm run seed:learning" or create it first.`,
      });
    }

    const slug = await uniquePathSlug(title);
    const path = await LearningPath.create({
      technologyId: technology._id,
      skillSlug,
      title,
      slug,
      level,
      estimatedHours,
      status: "draft",
      modules: modules.map((m) => ({
        title: m.title,
        lessons: m.lessons.map((l) => ({
          title: l.title,
          durationMin: l.durationMin,
          type: "article",
          content: { intro: "", sections: [], takeaways: [] },
        })),
      })),
      quiz: { passingScore: 70, salt: "", questions: [] },
      versions: [],
      contentLog: [contentLogEntry("outline", uid, `Draft outline created (${modules.length} modules).`)],
    });

    return res.status(201).json({ success: true, data: { path: pathSummary(path) } });
  } catch (error) {
    console.error("Admin outline create error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the outline" });
  }
};

// ─────────────────────────────────────────────────────────────
// 2. GET /api/admin/learning/review-queue — drafts + in_review
// ─────────────────────────────────────────────────────────────

export const getReviewQueue = async (req, res) => {
  try {
    const paths = await LearningPath.find({ status: { $in: ["draft", "in_review"] } })
      .sort({ updatedAt: -1 })
      .toArray();

    const technologies = await Technology.find({}).toArray();
    const techById = new Map(technologies.map((t) => [String(t._id), t.name]));

    return res.status(200).json({
      success: true,
      data: {
        paths: paths.map((p) => ({ ...pathSummary(p), technologyName: techById.get(String(p.technologyId)) || null })),
      },
    });
  } catch (error) {
    console.error("Admin review queue error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the review queue" });
  }
};

// ─────────────────────────────────────────────────────────────
// 3. POST /api/admin/learning/paths/:pathId/generate — LLM drafts
// ─────────────────────────────────────────────────────────────

const lessonSystemPrompt =
  "You are an expert curriculum writer for a job-matching platform. Write accurate, " +
  "practical, interview-relevant lesson content. Be concrete and correct — never invent " +
  "statistics or fake sources. Keep each lesson readable in under 10 minutes " +
  "(roughly 300-500 words). Output ONLY JSON.";

async function generateOneLesson(path, mod, lesson, attemptTag) {
  const prompt =
    `Write the full content for one lesson of the learning path "${path.title}" ` +
    `(skill: ${path.skillSlug}, level: ${path.level}).\n\n` +
    `Module: "${mod.title}"\nLesson: "${lesson.title}"\n\n` +
    "Return JSON with this exact structure:\n" +
    '{"intro": string (2-3 sentences framing the lesson),\n' +
    ' "sections": [{"heading": string, "paragraphs": [string], "list"?: [string], "code"?: {"lang": string, "text": string}}],\n' +
    ' "takeaways": [string]}\n' +
    "Use 2-3 sections. Include a short code example (as `code`) only where it genuinely helps. " +
    "takeaways: 3-4 concrete things the reader can now do or explain.";

  return generateJSON({
    prompt,
    system: lessonSystemPrompt,
    schema: lessonContentSchema,
    temperature: 0.4,
    maxOutputTokens: 2048,
    promptTag: `learn-lesson${attemptTag}`,
  });
}

const quizSystemPrompt =
  "You are an expert curriculum writer. Write multiple-choice quiz questions that test " +
  "real understanding (not trivia), each with one clearly best answer and three plausible " +
  "distractors. Output ONLY JSON.";

async function generateQuiz(path, attemptTag) {
  const prompt =
    `Write exactly ${QUIZ_QUESTION_COUNT} multiple-choice quiz questions for the learning ` +
    `path "${path.title}" (skill: ${path.skillSlug}, level: ${path.level}), covering the ` +
    "whole path. Return JSON:\n" +
    '{"questions": [{"prompt": string, "options": [4 strings], "answerIndex": 0-3, ' +
    '"explanation": string (why the answer is right and/or why common distractors are wrong), ' +
    '"skillSlug": string}]}\n' +
    `Every question must have exactly 4 options and answerIndex pointing at the correct one.`;

  return generateJSON({
    prompt,
    system: quizSystemPrompt,
    schema: quizDraftSchema,
    temperature: 0.4,
    maxOutputTokens: 3072,
    promptTag: `learn-quiz${attemptTag}`,
  });
}

export const generatePathContent = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path) {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }
    if (path.status !== "draft" && path.status !== "in_review") {
      return fail(res, 400, "INVALID_STATUS", `Cannot generate content for a "${path.status}" path.`);
    }

    if (!isLLMAvailable()) {
      return fail(
        res,
        503,
        "AI_UNAVAILABLE",
        "AI content generation is unavailable right now. Your outline is saved — try again later.",
      );
    }

    // 1. Draft every lesson in memory (one retry per lesson on failure).
    const drafted = []; // [{ moduleIndex, lessonIndex, content }]
    const failedLessons = [];
    for (let mi = 0; mi < (path.modules || []).length; mi += 1) {
      const mod = path.modules[mi];
      for (let li = 0; li < (mod.lessons || []).length; li += 1) {
        const lesson = mod.lessons[li];
        let content = null;
        for (let attempt = 1; attempt <= 2 && !content; attempt += 1) {
          try {
            content = await generateOneLesson(path, mod, lesson, `-${attempt}`);
          } catch (err) {
            console.warn(
              `Admin generate: lesson "${lesson.title}" attempt ${attempt} failed: ${err?.message || err}`,
            );
          }
        }
        if (content) drafted.push({ moduleIndex: mi, lessonIndex: li, content });
        else failedLessons.push(`${mod.title} / ${lesson.title}`);
      }
    }

    // 2. Draft the quiz (one retry).
    let quizDraft = null;
    for (let attempt = 1; attempt <= 2 && !quizDraft; attempt += 1) {
      try {
        quizDraft = await generateQuiz(path, `-${attempt}`);
      } catch (err) {
        console.warn(`Admin generate: quiz attempt ${attempt} failed: ${err?.message || err}`);
      }
    }

    if (failedLessons.length > 0 || !quizDraft) {
      // Nothing half-published: content stays in-memory, status stays as-is.
      const detail = failedLessons.length
        ? `Failed lessons: ${failedLessons.join("; ")}.`
        : "Quiz generation failed.";
      await LearningPath.updateOne(
        { _id: path._id },
        { $push: { contentLog: contentLogEntry("generate_failed", uid, detail) } },
      );
      return fail(
        res,
        503,
        "AI_UNAVAILABLE",
        `AI generation failed — nothing was saved for this run. ${detail} Your outline is kept; try again later.`,
      );
    }

    // 3. Persist everything atomically (content + quiz + salted hashes + status).
    const salt = crypto.randomBytes(16).toString("hex");
    const questions = quizDraft.questions.map((q) => ({
      prompt: q.prompt,
      options: q.options,
      answerIndex: q.answerIndex,
      answerHash: hashExpectedAnswer(q.answerIndex, salt),
      explanation: q.explanation,
      skillSlug: q.skillSlug || path.skillSlug,
    }));

    const modules = (path.modules || []).map((m) => ({ ...m }));
    for (const d of drafted) {
      modules[d.moduleIndex].lessons[d.lessonIndex] = {
        ...modules[d.moduleIndex].lessons[d.lessonIndex],
        content: d.content,
      };
    }

    await LearningPath.updateOne(
      { _id: path._id },
      {
        $set: {
          modules,
          quiz: { passingScore: path.quiz?.passingScore ?? 70, salt, questions },
          status: "in_review",
        },
        $push: {
          contentLog: contentLogEntry(
            "generate",
            uid,
            `Drafted ${drafted.length} lessons + ${questions.length} quiz questions (in_review).`,
          ),
        },
      },
    );

    const updated = await LearningPath.findById(pathId);
    return res.status(200).json({ success: true, data: { path: pathSummary(updated) } });
  } catch (error) {
    console.error("Admin generate error:", error);
    return fail(
      res,
      503,
      "AI_UNAVAILABLE",
      "AI content generation failed. Your outline is saved — try again later.",
    );
  }
};

// ─────────────────────────────────────────────────────────────
// 4. PUT /api/admin/learning/paths/:pathId/lessons/:lessonId — review edit
// ─────────────────────────────────────────────────────────────

export const editLesson = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId, lessonId } = req.params;
    const { content } = req.body; // already validated by lessonContentSchema

    const path = await LearningPath.findById(pathId);
    if (!path) {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    let target = null;
    const modules = (path.modules || []).map((m) => ({
      ...m,
      lessons: (m.lessons || []).map((l) => {
        if (String(l._id) !== String(lessonId)) return l;
        target = { title: l.title };
        return { ...l, content };
      }),
    }));
    if (!target) {
      return res.status(404).json({ success: false, message: "Lesson not found" });
    }

    await LearningPath.updateOne(
      { _id: path._id },
      {
        $set: { modules },
        $push: { contentLog: contentLogEntry("edit_lesson", uid, `Edited lesson "${target.title}".`) },
      },
    );

    const updated = await LearningPath.findById(pathId);
    const found = (updated.modules || [])
      .flatMap((m) => m.lessons || [])
      .find((l) => String(l._id) === String(lessonId));
    return res.status(200).json({
      success: true,
      data: {
        lesson: { _id: String(found._id), title: found.title, content: found.content, durationMin: found.durationMin },
      },
    });
  } catch (error) {
    console.error("Admin lesson edit error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the lesson" });
  }
};

// ─────────────────────────────────────────────────────────────
// 5. POST /api/admin/learning/paths/:pathId/publish (+ archive)
// ─────────────────────────────────────────────────────────────

export const publishPath = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;
    const { note } = req.body || {};

    const path = await LearningPath.findById(pathId);
    if (!path) {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    const lessonCount = (path.modules || []).reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
    const lessonsWithContent = (path.modules || []).reduce(
      (sum, m) => sum + (m.lessons || []).filter((l) => l.content && (l.content.intro || "").length > 0).length,
      0,
    );
    if (lessonCount === 0 || lessonsWithContent < lessonCount) {
      return fail(res, 400, "CONTENT_INCOMPLETE", "Every lesson needs generated (and reviewed) content before publishing.");
    }
    if (!path.quiz?.questions?.length) {
      return fail(res, 400, "CONTENT_INCOMPLETE", "Generate the quiz before publishing.");
    }

    const currentVersion = (path.versions || []).reduce((max, v) => Math.max(max, v.version || 0), 0);
    const version = currentVersion + 1;
    const publishedAt = new Date();

    await LearningPath.updateOne(
      { _id: path._id },
      {
        $set: { status: "published" },
        $push: {
          versions: {
            version,
            snapshot: { modules: path.modules, quiz: path.quiz },
            publishedAt,
            publishedBy: uid,
            note: note || "",
          },
          contentLog: contentLogEntry("publish", uid, `Published v${version}${note ? ` — ${note}` : ""}.`),
        },
      },
    );

    const updated = await LearningPath.findById(pathId);
    return res.status(200).json({
      success: true,
      data: { path: { ...pathSummary(updated), version } },
    });
  } catch (error) {
    console.error("Admin publish error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish the learning path" });
  }
};

export const archivePath = async (req, res) => {
  try {
    const uid = req.user.uid;
    const { pathId } = req.params;

    const path = await LearningPath.findById(pathId);
    if (!path) {
      return res.status(404).json({ success: false, message: "Learning path not found" });
    }

    await LearningPath.updateOne(
      { _id: path._id },
      {
        $set: { status: "archived" },
        $push: { contentLog: contentLogEntry("archive", uid, "Path archived.") },
      },
    );

    const updated = await LearningPath.findById(pathId);
    return res.status(200).json({ success: true, data: { path: pathSummary(updated) } });
  } catch (error) {
    console.error("Admin archive error:", error);
    return res.status(500).json({ success: false, message: "Failed to archive the learning path" });
  }
};

// ─────────────────────────────────────────────────────────────
// 6. GET /api/admin/learning/paths — all statuses
// ─────────────────────────────────────────────────────────────

export const listPaths = async (req, res) => {
  try {
    const paths = await LearningPath.find({}).sort({ updatedAt: -1 }).toArray();
    const technologies = await Technology.find({}).toArray();
    const techById = new Map(technologies.map((t) => [String(t._id), t.name]));

    return res.status(200).json({
      success: true,
      data: {
        paths: paths.map((p) => ({ ...pathSummary(p), technologyName: techById.get(String(p.technologyId)) || null })),
      },
    });
  } catch (error) {
    console.error("Admin paths list error:", error);
    return res.status(500).json({ success: false, message: "Failed to load learning paths" });
  }
};
