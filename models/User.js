// models/User.js
// Mongoose schema for the existing "users" collection.
// NOTE: routes keep writing via the raw MongoDB driver — this layer only adds
// typing + indexes. Raw writes bypass Mongoose validation, so nothing changes
// at runtime for existing endpoints.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// "employer" is a legacy recruiter role still checked across routes/middleware
// (jobs.routes, dashboard.routes, recruiterGate, chatbotService).
export const USER_ROLES = ["candidate", "recruiter", "admin", "employer"];
export const USER_STATUSES = ["active", "suspended"];

const userSchema = new Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Written by POST /api/auth/sync-user
    displayName: { type: String, default: "" },
    provider: { type: String, default: "password" },
    photoURL: { type: String, default: "" },
    role: { type: String, enum: USER_ROLES, default: "candidate" },
    status: { type: String, enum: USER_STATUSES, default: "active" },
    lastLoginAt: { type: Date, default: null },

    // Profile fields written by PUT /api/auth/profile/:uid and resume upload
    title: { type: String, default: "" },
    location: { type: String, default: "" },
    phone: { type: String, default: "" },
    bio: { type: String, default: "" },
    companyName: { type: String, default: "" },
    // Phase 2 fit engine reads skill ITEMS: strings (self/extracted) or
    // { name, source, verified } objects (learning-verified provenance is
    // written by the Phase 4 quiz-pass flow), hence Mixed, not [String].
    skills: { type: [Schema.Types.Mixed], default: [] },
    experience: { type: [Schema.Types.Mixed], default: [] },
    education: { type: [Schema.Types.Mixed], default: [] },
    projects: { type: [Schema.Types.Mixed], default: [] },
    certificates: { type: [Schema.Types.Mixed], default: [] },
    portfolioUrl: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    github: { type: String, default: "" },
    yearsOfExperience: { type: Number, default: 0 },
    resumeUploaded: { type: Boolean, default: false },

    // Verification state (skill tests + communication verification)
    verifiedSkills: { type: [String], default: [] },
    isSkillVerified: { type: Boolean, default: false },
    isCommunicationVerified: { type: Boolean, default: false },

    // Phase 4 (SkillForge): entitlement tier. Stripe billing lands in Phase 5 —
    // until then this is set manually/by admin tooling. Absent on legacy docs
    // (raw-driver writes bypass this schema) — readers treat missing as "free".
    plan: { type: String, enum: ["free", "pro"], default: "free" },
    lastTestAttempt: { type: Date, default: null },
    nextAttemptTime: { type: Date, default: null },
    lastCommunicationTestAt: { type: Date, default: null },
    nextCommunicationRetryAt: { type: Date, default: null },

    // Currently computed on read (auth/dashboard routes); stored from Phase 2 on.
    profileCompletion: { type: Number, default: null },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

export const User = models.User || model("User", userSchema);
