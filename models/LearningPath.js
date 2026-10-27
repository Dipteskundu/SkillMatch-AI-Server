// models/LearningPath.js
// SkillForge Learning Hub (Phase 4): a learning path verifies ONE canonical
// skill (skillSlug) through modules of short lessons + a final quiz.
//
// Content pipeline: admin outline -> status "draft" -> LLM drafts lesson
// content + quiz -> "in_review" (human edits) -> "published" (versioned).
// The quiz answer key lives ONLY server-side: each question stores the
// plaintext `answerIndex` (admin review needs it) plus an `answerHash`
// (salted SHA-256 of the index, same convention as skill tests —
// services/skillEvaluationService.hashExpectedAnswer). Learner routes never
// serialize answerIndex / answerHash / salt.
//
// Lesson `content` JSON structure (frontend render contract — DO NOT change
// without updating the frontend):
//   { intro: string,
//     sections: [{ heading, paragraphs: [string], list?: [string],
//                  code?: { lang, text } }],
//     takeaways: [string] }

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const PATH_LEVELS = ["beginner", "intermediate", "advanced"];
export const PATH_STATUSES = ["draft", "in_review", "published", "archived"];
export const LESSON_TYPES = ["article", "interactive"];

const lessonContentSchema = new Schema(
  {
    intro: { type: String, default: "" },
    sections: {
      type: [
        new Schema(
          {
            heading: { type: String, default: "" },
            paragraphs: { type: [String], default: [] },
            list: { type: [String], default: undefined },
            code: {
              type: new Schema(
                { lang: { type: String, default: "" }, text: { type: String, default: "" } },
                { _id: false },
              ),
              default: undefined,
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    takeaways: { type: [String], default: [] },
  },
  { _id: false },
);

const lessonSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: lessonContentSchema, default: () => ({}) },
    durationMin: { type: Number, default: 5 },
    type: { type: String, enum: LESSON_TYPES, default: "article" },
  },
  { _id: true },
);

const moduleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    lessons: { type: [lessonSchema], default: [] },
  },
  { _id: true },
);

const quizQuestionSchema = new Schema(
  {
    prompt: { type: String, required: true },
    options: { type: [String], default: [] },
    answerIndex: { type: Number, default: null }, // server-side only, never serialized to learners
    answerHash: { type: String, default: "" }, // sha256(`${salt}:idx:${answerIndex}`)
    explanation: { type: String, default: "" },
    skillSlug: { type: String, default: "" },
  },
  { _id: true },
);

const quizSchema = new Schema(
  {
    passingScore: { type: Number, default: 70 },
    salt: { type: String, default: "" },
    questions: { type: [quizQuestionSchema], default: [] },
  },
  { _id: false },
);

const versionSchema = new Schema(
  {
    version: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, default: null }, // { modules, quiz } incl. answers (server-side)
    publishedAt: { type: Date, default: null },
    publishedBy: { type: String, default: "" }, // admin firebaseUid or "seed"
    note: { type: String, default: "" },
  },
  { _id: false },
);

const contentLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: String, default: "" }, // firebaseUid (admin) or "seed"
    action: { type: String, default: "" }, // outline | generate | edit_lesson | publish | archive | seed | generate_failed
    note: { type: String, default: "" },
  },
  { _id: false },
);

const learningPathSchema = new Schema(
  {
    technologyId: { type: Schema.Types.ObjectId, ref: "Technology", default: null, index: true },
    skillSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    level: { type: String, enum: PATH_LEVELS, default: "beginner" },
    estimatedHours: { type: Number, default: 0 },
    status: { type: String, enum: PATH_STATUSES, default: "draft", index: true },
    modules: { type: [moduleSchema], default: [] },
    quiz: { type: quizSchema, default: () => ({}) },
    versions: { type: [versionSchema], default: [] },
    contentLog: { type: [contentLogSchema], default: [] },
  },
  {
    timestamps: true,
    collection: "learning_paths",
  },
);

learningPathSchema.index({ status: 1, createdAt: -1 });

export const LearningPath = models.LearningPath || model("LearningPath", learningPathSchema);
