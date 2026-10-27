// models/Resume.js
// Mongoose schema for the existing "resumes" collection.
// Fields verified against controllers/resumeController.js (actual insert).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const RESUME_COLLECTION = "resumes";

const resumeSchema = new Schema(
  {
    candidateId: { type: String, required: true, index: true }, // firebaseUid
    originalName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    extractedText: { type: String, default: "" },
    extractedSkills: { type: [String], default: [] },
    extractedExperience: { type: Number, default: 0 }, // years
    extractedTechnologies: { type: [String], default: [] },
    extractedRoles: { type: [String], default: [] },
    // ── Phase 3: async extraction pipeline ──
    extractionStatus: { type: String, default: "queued", index: true }, // queued|running|done|suspicious|failed
    injectionFlags: { type: [String], default: [] }, // injectionGuard pattern ids
    normalizedSkills: { type: [String], default: [] }, // canonical (alias-resolved) names
    skillEvidence: { type: Schema.Types.Mixed, default: null }, // skill -> verbatim quote
    skillEmbedding: { type: [Number], default: null }, // optional skill-set vector
    jobId: { type: String, default: null }, // jobs_queue _id
    error: { type: String, default: null },
    processedAt: { type: Date, default: null },
    // Transient: raw file bytes, $unset by the pipeline after parsing.
    fileBuffer: { type: Schema.Types.Buffer, default: null },
  },
  {
    timestamps: true,
    collection: RESUME_COLLECTION,
  },
);

export const Resume = models.Resume || model("Resume", resumeSchema);
