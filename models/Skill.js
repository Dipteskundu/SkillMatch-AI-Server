// models/Skill.js
// Canonical skill vocabulary for matching (PLAN §5 / Phase 2 semantic search).
// This is a NEW collection ("skills") — no existing route writes to it yet.
// Seed it with models/skillSeed.js (runs automatically on first connect).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const skillSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    aliases: { type: [String], default: [] }, // e.g. ["js"] -> canonical "JavaScript"
    taxonomy: {
      escoId: { type: String, default: null },
      onetId: { type: String, default: null },
    },
    category: { type: String, default: "general", index: true },
    adjacency: { type: [String], default: [] }, // neighboring skill slugs/names
    demand: { type: Number, default: 0 }, // 0-100 demand signal
  },
  {
    timestamps: true,
    collection: "skills",
  },
);

export const Skill = models.Skill || model("Skill", skillSchema);
