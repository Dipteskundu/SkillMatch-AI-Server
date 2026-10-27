// models/AuditLog.js — append-only audit trail (Phase 5 compliance).
// Records sensitive actions (data exports, approval decisions, key issuance,
// plan changes). Fire-and-forget writes via services/auditLog.js — an audit
// failure must never break the action being audited.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const auditLogSchema = new Schema(
  {
    userId: { type: String, default: "", index: true, trim: true },
    action: { type: String, required: true, trim: true, index: true },
    entity: { type: String, default: "", trim: true },
    entityId: { type: String, default: "", trim: true },
    meta: { type: Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
  },
  { collection: "audit_logs" },
);

auditLogSchema.index({ userId: 1, at: -1 });

export const AuditLog = models.AuditLog || model("AuditLog", auditLogSchema);
export default AuditLog;
