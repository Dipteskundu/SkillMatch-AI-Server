// models/UserProgress.js
// SkillForge Learning Hub (Phase 4): one document per learner, keyed by
// firebaseUid (the identity convention used across routes — see
// models/Assessment.candidateId, models/User.firebaseUid).
//
// enrollments[]    one per active/completed path; percent is recomputed
//                  server-side on every lesson completion.
// quizAttempts[]   append-only history (retakes allowed; re-passing never
//                  re-issues a badge).
// dailyLessonViews rolling { date: "YYYY-MM-DD", count } counter backing the
//                  FREE_DAILY_LESSONS entitlement (Pro is unlimited).
// badges[]         earned certificates (skill provenance: source "learning").

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const enrollmentSchema = new Schema(
  {
    pathId: { type: Schema.Types.ObjectId, ref: "LearningPath", required: true },
    enrolledAt: { type: Date, default: Date.now },
    completedLessonIds: { type: [Schema.Types.ObjectId], default: [] },
    percent: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
);

const quizAttemptSchema = new Schema(
  {
    pathId: { type: Schema.Types.ObjectId, ref: "LearningPath", required: true },
    score: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const badgeSchema = new Schema(
  {
    skillSlug: { type: String, default: "" },
    skillName: { type: String, default: "" },
    pathId: { type: Schema.Types.ObjectId, ref: "LearningPath", default: null },
    certificateId: { type: Schema.Types.ObjectId, ref: "Certificate", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userProgressSchema = new Schema(
  {
    // firebaseUid — NOT an ObjectId ref (matches the identity convention).
    userId: { type: String, required: true, unique: true },
    enrollments: { type: [enrollmentSchema], default: [] },
    quizAttempts: { type: [quizAttemptSchema], default: [] },
    dailyLessonViews: {
      type: new Schema(
        { date: { type: String, default: "" }, count: { type: Number, default: 0 } },
        { _id: false },
      ),
      default: () => ({ date: "", count: 0 }),
    },
    xp: { type: Number, default: 0 },
    streakDays: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: null },
    badges: { type: [badgeSchema], default: [] },
  },
  {
    timestamps: true,
    collection: "user_progress",
  },
);

export const UserProgress = models.UserProgress || model("UserProgress", userProgressSchema);
