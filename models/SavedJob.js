// models/SavedJob.js
// Mongoose schema for the existing "saved_jobs" collection.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const savedJobSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, required: true },
    firebaseUid: { type: String, required: true },
    email: { type: String, default: "" },
    // createdAt is set manually by the route via $setOnInsert.
  },
  {
    timestamps: true,
    collection: "saved_jobs",
  },
);

// Save route upserts keyed on { jobId, firebaseUid } — mirrors that contract so
// a job can only be saved once per user.
savedJobSchema.index({ jobId: 1, firebaseUid: 1 }, { unique: true });
savedJobSchema.index({ firebaseUid: 1, createdAt: -1 });

export const SavedJob = models.SavedJob || model("SavedJob", savedJobSchema);
