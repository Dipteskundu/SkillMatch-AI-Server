// models/Job.js
// Mongoose schema for the existing "find_jobs" collection (collection name is
// intentionally NOT the Mongoose-pluralized "jobs").
//
// Status values verified in code: "pending", "approved", "rejected",
// "delete_requested" (jobs.routes admin endpoints + dashboard.routes).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const JOB_STATUSES = ["pending", "approved", "rejected", "delete_requested"];

// PLAN §5 shape: requiredSkills:[{name, weight, level}] — Phase 2 scoring input.
// The live routes currently write plain-string skills into `skills` / `niceToHaveSkills`.
const jobSkillSchema = new Schema(
  {
    name: { type: String, required: true },
    weight: { type: Number, default: null },
    level: { type: String, default: null },
  },
  { _id: false },
);

const jobSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },

    // Live fields (POST /api/jobs): company is a display name string.
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    salary: { type: String, default: "" },
    salaryRange: { type: String, default: "" },
    experienceLevel: { type: String, default: "" },
    employmentType: { type: String, default: "" },
    posted: { type: String, default: "" },
    postedBy: { type: String, default: null, index: true }, // firebaseUid of recruiter
    description: { type: String, default: "" },
    responsibilities: { type: [String], default: [] },
    vacancies: { type: Schema.Types.Mixed, default: null },
    deadline: { type: Schema.Types.Mixed, default: null }, // string or Date in practice

    // Skills actually read by fit/transparency engines.
    skills: { type: [String], default: [] },
    niceToHaveSkills: { type: [String], default: [] },
    matchedCandidates: { type: [String], default: [] }, // queried by context.service.js

    // PLAN §5 fields (Phase 2 — not written by current routes).
    companyId: { type: Schema.Types.ObjectId, default: null, index: true },
    requiredSkills: { type: [jobSkillSchema], default: [] },
    preferredSkills: { type: [jobSkillSchema], default: [] },

    status: { type: String, enum: JOB_STATUSES, default: "pending", index: true },
  },
  {
    timestamps: true,
    collection: "find_jobs",
  },
);

// Admin list: find({ status }).sort({ createdAt: -1 })
jobSchema.index({ status: 1, createdAt: -1 });

export const Job = models.Job || model("Job", jobSchema);
