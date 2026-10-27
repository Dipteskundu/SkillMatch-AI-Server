// models/TaskSubmission.js
// Mongoose schema for the existing "task_submissions" collection.
// Fields verified against routes/tasks.routes.js (POST /api/tasks/:taskId/submit).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const taskSubmissionSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, required: true, index: true },
    applicationId: { type: Schema.Types.ObjectId, required: true, index: true },
    candidateId: { type: String, required: true, index: true }, // firebaseUid
    githubUrl: { type: String, default: "" },
    liveUrl: { type: String, default: "" },
    notes: { type: String, default: "" },
    submittedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "task_submissions",
  },
);

export const TaskSubmission =
  models.TaskSubmission || model("TaskSubmission", taskSubmissionSchema);
