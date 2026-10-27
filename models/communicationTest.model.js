// models/communicationTest.model.js
// Mongoose schema for the existing "communicationTests" collection (per-job
// communication test). The raw-driver helpers STATUS/COLLECTION are kept —
// controllers/communication.controller.js imports them.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

const COLLECTION = "communicationTests";

// Question/answer shapes verified against services/gemini.service.js:
//   question: { id, text, type }   answer: { questionId, answer }
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

const communicationTestSchema = new Schema(
  {
    candidateId: { type: String, required: true }, // firebaseUid
    jobId: { type: Schema.Types.ObjectId, required: true },
    applicationId: { type: Schema.Types.ObjectId, default: null }, // optional link
    questions: { type: [questionSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, default: null }, // 0-100
    clarityScore: { type: Number, default: null },
    toneScore: { type: Number, default: null },
    grammarScore: { type: Number, default: null },
    structureScore: { type: Number, default: null },
    feedback: { type: Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: [STATUS.PENDING, STATUS.IN_PROGRESS, STATUS.COMPLETED],
      default: STATUS.PENDING,
    },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: COLLECTION,
  },
);

// One attempt per candidate per job (findOne on candidateId + jobId + status),
// plus the in-progress session lookup.
communicationTestSchema.index({ candidateId: 1, jobId: 1, status: 1 });

const CommunicationTest =
  models.CommunicationTest || model("CommunicationTest", communicationTestSchema);

export { STATUS, COLLECTION, CommunicationTest };
