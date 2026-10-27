// services/creditService.js
// ─────────────────────────────────────────────────────────────────────────────
// Metered AI credits backed by the append-only CreditLedger collection.
//
//   balance = sum(delta) over a user's entries.
//   Monthly grant: applied LAZILY on the first balance read of a new month
//   (reason `grant:YYYY-MM`) — idempotent because the reason encodes the
//   month, so a double read can never double-grant.
//
// Enforcement is OFF by default (env CREDIT_ENFORCEMENT=off|ai|all). The
// exported `creditGuard` middleware is ready to mount on AI routes when the
// platform starts charging for overage; nothing is enforced until then.
// ─────────────────────────────────────────────────────────────────────────────

import { CreditLedger } from "../models/index.js";

const DEFAULT_FREE_GRANT = 20;
const DEFAULT_PRO_GRANT = 500;

function freeGrant() {
  const n = Number(process.env.FREE_MONTHLY_AI_CREDITS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_GRANT;
}

function proGrant() {
  const n = Number(process.env.PRO_MONTHLY_AI_CREDITS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRO_GRANT;
}

export function monthlyGrantFor(plan) {
  return plan === "pro" ? proGrant() : freeGrant();
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Sum of all ledger deltas for a user (never throws → 0 on failure). */
async function sumBalance(userId) {
  try {
    const rows = await CreditLedger.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$delta" } } },
    ]).exec();
    return rows?.[0]?.total ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Balance for a user, applying the lazy monthly grant when none exists for
 * the current month. `plan` should come from users.plan ("free" default).
 */
export async function getBalance(userId, plan = "free") {
  const key = currentMonthKey();
  const reason = `grant:${key}`;
  try {
    const existing = await CreditLedger.findOne({ userId, reason }).lean();
    if (!existing) {
      const grant = monthlyGrantFor(plan);
      if (grant > 0) {
        const balance = await sumBalance(userId);
        await CreditLedger.create({
          userId,
          delta: grant,
          reason,
          balanceAfter: balance + grant,
          at: new Date(),
          meta: { plan, month: key },
        });
        return balance + grant;
      }
    }
  } catch (err) {
    console.warn("credits: grant skipped —", err?.message || err);
  }
  return sumBalance(userId);
}

/** Append a positive entry. Returns new balance. Never throws. */
export async function grant(userId, amount, reason, plan = "free") {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return sumBalance(userId);
  const balance = await sumBalance(userId);
  try {
    await CreditLedger.create({
      userId,
      delta: n,
      reason,
      balanceAfter: balance + n,
      meta: { plan },
    });
  } catch (err) {
    console.warn("credits: grant failed —", err?.message || err);
  }
  return balance + n;
}

/**
 * Spend credits. Returns { ok, balance }. ok=false when insufficient.
 * When enforcement is off (default) the spend still records but never blocks
 * (ok=true with the resulting balance) — so ledgers stay truthful while the
 * platform is free.
 */
export async function spend(userId, amount, reason) {
  const n = Math.floor(Number(amount) || 0);
  const balance = await sumBalance(userId);
  if (n <= 0) return { ok: true, balance };
  if (balance < n && enforcementOn()) {
    return { ok: false, balance };
  }
  try {
    await CreditLedger.create({
      userId,
      delta: -n,
      reason,
      balanceAfter: balance - n,
    });
  } catch (err) {
    console.warn("credits: spend failed —", err?.message || err);
  }
  return { ok: true, balance: balance - n };
}

function enforcementOn() {
  const mode = (process.env.CREDIT_ENFORCEMENT || "off").toLowerCase();
  return mode !== "off" && mode !== "";
}

/**
 * Express middleware for future metered AI routes: 402 when the user is out
 * of credits AND enforcement is enabled. Mount nothing until billing ships.
 */
export function creditGuard(cost = 1) {
  return async (req, res, next) => {
    if (!enforcementOn()) return next();
    const userId = req.user?.uid;
    if (!userId) return next();
    const balance = await getBalance(userId, req.user?.plan || "free");
    if (balance < cost) {
      return res.status(402).json({
        success: false,
        message: "Out of AI credits.",
        error: { code: "OUT_OF_CREDITS", balance },
      });
    }
    await spend(userId, cost, `spend:${req.route?.path || "ai"}`);
    return next();
  };
}

/** Recent ledger entries for the account page. Never throws. */
export async function recent(userId, limit = 20) {
  try {
    return await CreditLedger.find({ userId })
      .sort({ at: -1 })
      .limit(limit)
      .lean();
  } catch {
    return [];
  }
}
