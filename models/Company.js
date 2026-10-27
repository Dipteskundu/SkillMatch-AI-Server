// models/Company.js
// Mongoose schema for the existing "companies_info" collection
// (NOT Mongoose-pluralized "companies" — explicit collection name required).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const companySchema = new Schema(
  {
    // Written by POST /api/companies (companies.routes)
    name: { type: String, required: true, trim: true },
    industry: { type: String, default: "" },
    location: { type: String, default: "" },
    description: { type: String, default: "" },
    logo: { type: String, default: "" },
    companySize: { type: String, default: "" },
    website: { type: String, default: "" },

    // PLAN §5 fields (not written by current routes).
    ownerId: { type: Schema.Types.ObjectId, default: null, index: true }, // ref User
    verified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "companies_info",
  },
);

export const Company = models.Company || model("Company", companySchema);
