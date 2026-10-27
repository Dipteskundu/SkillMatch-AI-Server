// models/Assessment.js
// skill_tests collection: candidate skill tests (generate -> submit flow).
// Question/answer shapes per services/skillEvaluationService.js and
// controllers/skillTestController.js (Phase 2 security redesign):
//   question: { id, text, difficulty, skill, type, options[4] (per-attempt
//              shuffled), answerHash = sha256(`${answerSalt}:idx:${correctIdx}`) }
//   answer:   { questionId, answer }  (answer = option text or 0-based index)
//   Legacy in-flight documents may still carry a plaintext `correctAnswer`
//   per question (kept in the schema for those docs; never serialized).
//
// Also exports AssessmentResult (PLAN §5) — one row per attempt is written to
// assessment_results by controllers/skillTestController.js (raw driver, same
// shape as this schema) for completion/timeout analytics.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const ASSESSMENT_RESULTS = ["pending", "pass", "fail", "expired"]; // `result` values

const questionSchema = new Schema(
  {
    id: { type: String, default: "" },
    text: { type: String, default: "" },
    difficulty: { type: String, default: "Medium" },
    skill: { type: String, default: "" },
    type: { type: String, default: "mcq" },
    options: { type: [String], default: [] },
    // Salted SHA-256 of the correct option's index in the shuffled options.
    answerHash: { type: String, default: "" },
    // Legacy (pre-redesign documents only) — never returned by any route.
    correctAnswer: { type: String, default: "" },
  },
  { _id: false },
);

const answerSchema = new Schema(
  {
    questionId: { type: String, default: "" },
    answer: { type: String, default: "" }, // option text or 0-based option index
  },
  { _id: false },
);

const assessmentSchema = new Schema(
  {
    candidateId: { type: String, required: true, index: true }, // firebaseUid
    skills: { type: [String], default: [] },
    questions: { type: [questionSchema], default: [] },
    answerSalt: { type: String, default: "" }, // per-test salt for answerHash
    timeLimitMinutes: { type: Number, default: null }, // 10, enforced server-side
    startedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    durationSec: { type: Number, default: null }, // actual time spent (analytics)
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, default: null },
    result: { type: String, enum: ASSESSMENT_RESULTS, default: "pending" },
    feedback: { type: Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "skill_tests",
  },
);

assessmentSchema.index({ candidateId: 1, createdAt: -1 });

export const Assessment = models.Assessment || model("Assessment", assessmentSchema);

// ─── Phase 2: per-attempt result (PLAN §5) ───────────────────────────────────
// Written by controllers/skillTestController.js (raw driver insert into
// `assessment_results`; shape mirrors this schema). Collection is created on
// first insert / index sync.
const perSkillSchema = new Schema(
  {
    skill: { type: String, default: "" },
    correct: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    score: { type: Number, default: 0 }, // per-skill percentage
  },
  { _id: false },
);

const integritySchema = new Schema(
  {
    tabExits: { type: Number, default: 0 },
    pasteEvents: { type: Number, default: 0 },
    durationSec: { type: Number, default: null },
  },
  { _id: false },
);

const assessmentResultSchema = new Schema(
  {
    candidateId: { type: String, required: true, index: true }, // firebaseUid
    assessmentId: { type: Schema.Types.ObjectId, required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, default: null },
    skills: { type: [String], default: [] },
    score: { type: Number, default: null },
    perSkill: { type: [perSkillSchema], default: [] },
    result: { type: String, enum: ASSESSMENT_RESULTS, default: "pending" },
    feedback: { type: Schema.Types.Mixed, default: null },
    durationSec: { type: Number, default: null }, // time spent (completion analytics)
    integrity: { type: integritySchema, default: null },
    attempt: { type: Number, default: 1 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "assessment_results",
  },
);

assessmentResultSchema.index({ candidateId: 1, assessmentId: 1, attempt: 1 });

export const AssessmentResult =
  models.AssessmentResult || model("AssessmentResult", assessmentResultSchema);
