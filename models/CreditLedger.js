// models/CreditLedger.js
// Phase 5 — append-only credit ledger. Balance = sum(delta) over a user's
// entries; every write records the running balanceAfter for auditability.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const creditLedgerSchema = new Schema(
  {
    userId: { type: String, required: true, index: true, trim: true },
    // Positive = grant, negative = spend.
    delta: { type: Number, required: true },
    // Machine-readable reason, e.g. "grant:monthly", "spend:ai_score", "purchase".
    reason: { type: String, required: true, trim: true },
    // Balance immediately after this entry was applied.
    balanceAfter: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: "credit_ledger",
  },
);

export const CreditLedger =
  models.CreditLedger || model("CreditLedger", creditLedgerSchema);
