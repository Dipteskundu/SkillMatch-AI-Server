// models/Task.js
// Mongoose schema for the existing "job_tasks" collection (take-home tasks).
// Fields verified against routes/tasks.routes.js.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const TASK_COLLECTION = "job_tasks";

const taskSchema = new Schema(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    requirements: { type: String, default: "" },
    deadline: { type: Schema.Types.Mixed, default: null }, // string or Date from body
    recruiterId: { type: String, default: null, index: true }, // firebaseUid
    jobId: { type: Schema.Types.ObjectId, default: null, index: true },
    assignedApplicants: { type: [Schema.Types.ObjectId], default: [] }, // application _ids
  },
  {
    timestamps: true,
    collection: TASK_COLLECTION,
  },
);

// Candidate lookup: { assignedApplicants: { $in: applicationIds } }
taskSchema.index({ assignedApplicants: 1 });

export const Task = models.Task || model("Task", taskSchema);
