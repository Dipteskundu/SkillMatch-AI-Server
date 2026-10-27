// models/SkillGap.js
// Mongoose schema for the existing "skillGaps" collection (camelCase name —
// explicit collection binding required, Mongoose would pluralize to "skillgaps").
// Fields verified against routes/jobs.routes.js (apply flow) and
// controllers/skillGapController.js.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const SKILL_GAP_COLLECTION = "skillGaps";

const skillGapSchema = new Schema(
  {
    applicationId: { type: Schema.Types.ObjectId, required: true, index: true },
    candidateId: { type: String, required: true, index: true }, // firebaseUid
    jobId: { type: Schema.Types.ObjectId, required: true, index: true },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    matchScore: { type: Number, default: 0 }, // 0-100
    learningSuggestions: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: SKILL_GAP_COLLECTION,
  },
);

export const SkillGap = models.SkillGap || model("SkillGap", skillGapSchema);
