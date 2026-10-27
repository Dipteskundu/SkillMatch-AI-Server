// models/CommunicationVerification.js
// Mongoose schema for the existing "communication_verifications" collection
// (global one-time verification — distinct from per-job communicationTests).
// Fields verified against controllers/commVerification.controller.js.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const COMM_VER_COLLECTION = "communication_verifications";

const questionSchema = new Schema(
  {
    id: { type: String, default: "" },
    text: { type: String, default: "" },
    type: { type: String, default: "" },
  },
  { _id: false },
);

const answerSchema = new Schema(
  {
    questionId: { type: String, default: "" },
    answer: { type: String, default: "" },
  },
  { _id: false },
);

const communicationVerificationSchema = new Schema(
  {
    candidateId: { type: String, required: true }, // firebaseUid
    questions: { type: [questionSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, default: null },
    clarityScore: { type: Number, default: null },
    toneScore: { type: Number, default: null },
    grammarScore: { type: Number, default: null },
    structureScore: { type: Number, default: null },
    feedback: { type: Schema.Types.Mixed, default: null },
    result: { type: String, enum: ["pass", "fail"], default: null },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: COMM_VER_COLLECTION,
  },
);

// Start route: findOne({ candidateId, status: "in_progress" })
communicationVerificationSchema.index({ candidateId: 1, status: 1 });

export const CommunicationVerification =
  models.CommunicationVerification ||
  model("CommunicationVerification", communicationVerificationSchema);
