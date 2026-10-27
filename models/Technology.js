// models/Technology.js
// SkillForge Learning Hub (Phase 4): light catalog grouping for learning paths
// (e.g. "Web Development" -> React path, "Data" -> SQL path). NEW collection
// ("technologies"), seeded by scripts/seed-learning.js.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const technologySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: { type: String, default: "general" }, // e.g. web, programming, data, engineering, career
    order: { type: Number, default: 0 }, // catalog display order (ascending)
  },
  {
    timestamps: true,
    collection: "technologies",
  },
);

export const Technology = models.Technology || model("Technology", technologySchema);
