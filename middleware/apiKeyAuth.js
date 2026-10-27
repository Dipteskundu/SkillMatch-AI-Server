// middleware/apiKeyAuth.js — bearer API-key auth for /api/public/v1.
//
// Keys are minted as `smk_live_<32 bytes base64url>`; only their SHA-256 hash
// is stored. A per-key in-memory sliding window (rateLimitPerMin, default 60)
// returns 429 RATE_LIMITED. Buckets reset on process restart — acceptable for
// abuse blunting at current scale (documented in docs/PUBLIC_API.md).

import crypto from "node:crypto";
import { ApiKey } from "../models/index.js";

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

export function generateApiKey() {
  const raw = crypto.randomBytes(24).toString("base64url");
  const key = `smk_live_${raw}`;
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 13) };
}

const WINDOW_MS = 60_000;
const buckets = new Map(); // keyHash -> [timestamps in window]
const lastUsedFlushed = new Map(); // keyHash -> last flush ts

export async function authenticateApiKey(req, res, next) {
  try {
    let key = null;
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) key = header.slice(7).trim();
    if (!key && req.headers["x-api-key"]) key = String(req.headers["x-api-key"]).trim();

    if (!key || !key.startsWith("smk_")) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_API_KEY", message: "A valid API key is required (Authorization: Bearer smk_...)." },
      });
    }

    const keyHash = hashApiKey(key);
    const doc = await ApiKey.findOne({ keyHash, active: true }).lean();
    if (!doc || doc.revokedAt) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_API_KEY", message: "API key is invalid or revoked." },
      });
    }

    // Sliding-window rate limit per key.
    const now = Date.now();
    const limit = Number(doc.rateLimitPerMin) || 60;
    let bucket = buckets.get(keyHash) || [];
    bucket = bucket.filter((t) => now - t < WINDOW_MS);
    if (bucket.length >= limit) {
      buckets.set(keyHash, bucket);
      return res.status(429).json({
        success: false,
        error: { code: "RATE_LIMITED", message: `Rate limit exceeded (${limit}/min). Retry later.` },
      });
    }
    bucket.push(now);
    buckets.set(keyHash, bucket);

    // lastUsedAt — flushed at most once per minute per key (fire-and-forget).
    const flushed = lastUsedFlushed.get(keyHash) || 0;
    if (now - flushed > WINDOW_MS) {
      lastUsedFlushed.set(keyHash, now);
      ApiKey.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date(now) } }).catch(() => {});
    }

    req.apiKey = { id: String(doc._id), name: doc.name, scopes: doc.scopes || [] };
    return next();
  } catch (err) {
    console.error("api-key auth failed:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: { code: "AUTH_BACKEND_ERROR", message: "Could not verify API key." },
    });
  }
}

/** Test helper — clears in-memory rate-limit state. */
export function resetApiKeyStateForTests() {
  buckets.clear();
  lastUsedFlushed.clear();
}
