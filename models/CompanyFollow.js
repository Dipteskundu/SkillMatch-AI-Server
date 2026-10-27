// models/CompanyFollow.js
// Mongoose schema for the existing "company_follows" collection.
// Follow route upserts keyed on { companyId, firebaseUid }.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const companyFollowSchema = new Schema(
  {
    companyId: { type: String, required: true }, // route param string (not ObjectId)
    firebaseUid: { type: String, required: true },
    email: { type: String, default: "" },
    // createdAt set manually by the route via $setOnInsert.
  },
  {
    timestamps: true,
    collection: "company_follows",
  },
);

companyFollowSchema.index({ companyId: 1, firebaseUid: 1 }, { unique: true });
companyFollowSchema.index({ firebaseUid: 1 });

export const CompanyFollow =
  models.CompanyFollow || model("CompanyFollow", companyFollowSchema);
