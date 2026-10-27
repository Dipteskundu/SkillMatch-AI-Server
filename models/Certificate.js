// models/Certificate.js
// SkillForge Learning Hub (Phase 4): one row per FIRST passing path quiz.
// `verifiableCode` is a crypto-random URL-safe string (unique index) — the
// public verification handle ("badge id") shown to the learner.

import crypto from "node:crypto";
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/** URL-safe, crypto-random verification code (22 chars from 16 random bytes). */
export function generateVerifiableCode() {
  return crypto.randomBytes(16).toString("base64url");
}

const certificateSchema = new Schema(
  {
    userId: { type: String, required: true, index: true }, // firebaseUid
    skillSlug: { type: String, default: "" },
    skillName: { type: String, default: "" },
    pathId: { type: Schema.Types.ObjectId, ref: "LearningPath", default: null },
    verifiableCode: { type: String, required: true, unique: true },
    score: { type: Number, default: 0 },
    issuedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "certificates",
  },
);

export const Certificate = models.Certificate || model("Certificate", certificateSchema);
