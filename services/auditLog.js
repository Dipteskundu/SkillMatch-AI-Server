// services/auditLog.js — fire-and-forget audit trail writes.
// NEVER throws: an audit failure must not break the audited action.

import { AuditLog } from "../models/index.js";

export async function auditLog({ userId = "", action, entity = "", entityId = "", meta = null }) {
  if (!action) return;
  try {
    await AuditLog.create({ userId, action, entity, entityId, meta, at: new Date() });
  } catch (err) {
    console.warn("audit: write failed —", err?.message || err);
  }
}

/** Read a user's own audit entries (newest first, paginated). */
export async function ownAuditEntries(userId, { page = 1, limit = 20 } = {}) {
  const skip = (Math.max(1, page) - 1) * limit;
  try {
    const [rows, total] = await Promise.all([
      AuditLog.find({ userId })
        .sort({ at: -1 })
        .skip(skip)
        .limit(limit)
        .select("action entity entityId at")
        .lean(),
      AuditLog.countDocuments({ userId }),
    ]);
    return {
      entries: (rows || []).map((r) => ({
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        at: r.at,
      })),
      total,
      page,
    };
  } catch {
    return { entries: [], total: 0, page };
  }
}

export default auditLog;
