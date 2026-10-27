// lib/learningSchemas.js
// Zod schemas for the SkillForge Learning Hub routes (Phase 4).
// Route validation goes through middleware/validate.js like everywhere else.

import { z } from "zod";
import { PATH_LEVELS } from "../models/LearningPath.js";

// ─────────────────────────────────────────────────────────────
// Content structures (the lesson JSON is a frontend render contract)
// ─────────────────────────────────────────────────────────────

const lessonSectionSchema = z.object({
  heading: z.string().trim().min(1).max(300),
  paragraphs: z.array(z.string().trim().min(1)).min(1).max(20),
  list: z.array(z.string().trim().min(1)).max(30).optional(),
  code: z
    .object({
      lang: z.string().trim().max(50).default(""),
      text: z.string().min(1),
    })
    .optional(),
});

export const lessonContentSchema = z.object({
  intro: z.string().trim().min(1),
  sections: z.array(lessonSectionSchema).min(1).max(10),
  takeaways: z.array(z.string().trim().min(1)).min(1).max(10),
});

/** One quiz question as drafted by the LLM / stored server-side. */
export const quizQuestionDraftSchema = z.object({
  prompt: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2).max(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1),
  skillSlug: z.string().trim().max(100).optional(),
});

export const quizDraftSchema = z.object({
  questions: z.array(quizQuestionDraftSchema).min(1).max(10),
});

// ─────────────────────────────────────────────────────────────
// Learner routes (/api/learning)
// ─────────────────────────────────────────────────────────────

/** Params: { pathId } — LearningPath ObjectId. */
export const learningPathParams = z.object({
  pathId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "pathId must be a valid MongoDB ObjectId"),
});

/** Params: { pathId, lessonId } — both ObjectIds. */
export const lessonParams = z.object({
  pathId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "pathId must be a valid MongoDB ObjectId"),
  lessonId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "lessonId must be a valid MongoDB ObjectId"),
});

/** POST /api/learning/paths/:pathId/quiz/submit */
export const quizSubmitBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(100),
        choice: z.number().int().min(0).max(9),
      }),
    )
    .min(1)
    .max(20),
});

/** POST /api/learning/match-paths — gap -> path CTA. */
export const matchPathsBody = z.object({
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
});

// ─────────────────────────────────────────────────────────────
// Admin routes (/api/admin/learning)
// ─────────────────────────────────────────────────────────────

/** POST /api/admin/learning/outlines */
export const learningOutlineBody = z.object({
  technologySlug: z.string().trim().min(1).max(100),
  skillSlug: z.string().trim().min(1).max(100).toLowerCase(),
  title: z.string().trim().min(3).max(200),
  level: z.enum(PATH_LEVELS),
  estimatedHours: z.number().min(0.5).max(200),
  modules: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        lessons: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              durationMin: z.number().int().min(1).max(60),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(10),
});

/** PUT /api/admin/learning/paths/:pathId/lessons/:lessonId */
export const lessonEditBody = z.object({
  content: lessonContentSchema,
});

/** POST /api/admin/learning/paths/:pathId/publish */
export const pathPublishBody = z.object({
  note: z.string().trim().max(500).optional(),
});
