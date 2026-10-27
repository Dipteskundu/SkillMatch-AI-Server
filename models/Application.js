// models/Application.js
// Mongoose schema for the existing "applications" collection.
//
// Field/status values verified against jobs.routes, applications.routes,
// dashboard.routes, transparency.routes, tasks.routes and interviews.controller.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Every status string actually read/written anywhere in the codebase.
// (transparency VALID_STATUSES + tasks pipeline + interview sync + statusMessages)
export const APPLICATION_STATUSES = [
  "applied",
  "submitted",
  "seen",
  "viewed",
  "ai_scored",
  "shortlisted",
  "task_sent",
  "task_accepted",
  "task_submitted",
  "interviewing",
  "interview",
  "interview_selected",
  "interview_completed",
  "selected",
  "offer",
  "rejected",
  "hired",
];

// Phase 2 Hiring Fit Score (PLAN §4/§5). Written by services/fitScoreService.js
// via the unified engine (services/fitScore.js) on apply + on recompute.
const aiScoreEvidenceSchema = new Schema(
  {
    factor: { type: String, default: "" },
    // `quote` is the legacy field (kept for old readers); `label`/`detail` are
    // the fit-v1 contract fields.
    quote: { type: String, default: "" },
    label: { type: String, default: "" },
    detail: { type: String, default: "" },
    source: { type: String, default: "" },
  },
  { _id: false },
);

const aiScoreAdjacentSkillSchema = new Schema(
  {
    candidateSkill: { type: String, default: "" },
    jobSkill: { type: String, default: "" },
    credit: { type: Number, default: 0 },
    semantic: { type: Boolean, default: false },
  },
  { _id: false },
);

const aiScoreSchema = new Schema(
  {
    total: { type: Number, default: null },
    breakdown: {
      skillMatch: { type: Number, default: null },
      assessment: { type: Number, default: null },
      experience: { type: Number, default: null },
      education: { type: Number, default: null },
      additional: { type: Number, default: null },
    },
    // Effective weights AFTER redistribution of inactive (null) factors.
    weights: {
      skillMatch: { type: Number, default: null },
      assessment: { type: Number, default: null },
      experience: { type: Number, default: null },
      education: { type: Number, default: null },
      additional: { type: Number, default: null },
    },
    evidence: { type: [aiScoreEvidenceSchema], default: [] },
    matchedSkills: { type: [String], default: [] },
    adjacentSkills: { type: [aiScoreAdjacentSkillSchema], default: [] },
    missingSkills: { type: [String], default: [] },
    noAssessment: { type: Boolean, default: false },
    modelVersion: { type: String, default: null },
    computedAt: { type: Date, default: null },
  },
  { _id: false },
);

// Raw code writes { status, timestamp } (sometimes { note }) — see transparency.routes.
// `by` kept for the PLAN §5 timeline contract (optional, not written today).
const timelineEventSchema = new Schema(
  {
    status: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now },
    by: { type: String, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, required: true, index: true },
    // The code identifies candidates by Firebase UID (there is no candidateId field).
    firebaseUid: { type: String, required: true, index: true },
    email: { type: String, default: "" },

    // Denormalized snapshot written at apply time (used in notifications/aggregations).
    jobTitle: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },

    status: { type: String, enum: APPLICATION_STATUSES, default: "submitted", index: true },

    // Weights/score: default null semantics so `aiScore: null` writes keep working.
    aiScore: { type: aiScoreSchema, default: null },

    timeline: { type: [timelineEventSchema], default: [] },

    // feedback is a free string in applications.routes and an object
    // { missingSkills, suggestedActions, generatedAt } in transparency.routes.
    feedback: { type: Schema.Types.Mixed, default: null },

    // Written by controllers/communication.controller.js on test submit.
    communicationScore: { type: Number, default: null },
    communicationStatus: { type: String, default: null },
    communicationFeedback: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: "applications",
  },
);

// NOTE: deliberately NOT unique — POST /api/jobs/:id/apply does not check for
// duplicates, so a unique index would fail on existing data and contradict the
// current behaviour. Revisit once apply-side dedupe lands (later phase).
applicationSchema.index({ jobId: 1, firebaseUid: 1 });

export const Application = models.Application || model("Application", applicationSchema);
