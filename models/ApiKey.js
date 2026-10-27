// models/ApiKey.js — public API keys (Phase 5).
// Only the SHA-256 hash of the full key is stored; the plaintext key is shown
// exactly once at creation and is unrecoverable afterwards.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const apiKeySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    keyHash: { type: String, required: true, unique: true, index: true },
    // First characters of the key (e.g. "smk_live_ab") for display in lists.
    keyPrefix: { type: String, required: true, trim: true },
    // Firebase UID of the owning admin/user who created it.
    ownerUid: { type: String, default: "", index: true, trim: true },
    scopes: { type: [String], default: ["jobs:read"] },
    rateLimitPerMin: { type: Number, default: 60, min: 1, max: 10000 },
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "api_keys" },
);

export const ApiKey = models.ApiKey || model("ApiKey", apiKeySchema);
export default ApiKey;
