// routes/adminApiKeys.routes.js — admin CRUD for public API keys (Phase 5).
// The plaintext key is returned ONCE at creation; only its hash is stored.
// All routes: verifyToken + requireAdmin.

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";
import { validate } from "../middleware/validate.js";
import { apiKeyBody, objectIdParam } from "../lib/publicApiSchemas.js";
import { generateApiKey } from "../middleware/apiKeyAuth.js";
import { ApiKey } from "../models/index.js";
import { auditLog } from "../services/auditLog.js";

const router = Router();

// POST /api/admin/api-keys — mint a new key (plaintext shown once).
router.post(
  "/api/admin/api-keys",
  verifyToken,
  requireAdmin,
  validate(apiKeyBody),
  async (req, res) => {
    try {
      const { name, rateLimitPerMin } = req.body;
      const { key, keyHash, keyPrefix } = generateApiKey();

      const doc = await ApiKey.create({
        name,
        keyHash,
        keyPrefix,
        ownerUid: req.user.uid || "",
        rateLimitPerMin: rateLimitPerMin || 60,
        active: true,
      });

      await auditLog({
        userId: req.user.uid,
        action: "api_key_created",
        entity: "api_key",
        entityId: String(doc._id),
        meta: { name },
      });

      res.status(201).json({
        success: true,
        data: {
          key, // shown once — never retrievable again
          _id: String(doc._id),
          name: doc.name,
          keyPrefix: doc.keyPrefix,
          rateLimitPerMin: doc.rateLimitPerMin,
          createdAt: doc.createdAt,
        },
      });
    } catch (err) {
      console.error("api-key create failed:", err?.message || err);
      res.status(500).json({ success: false, message: "Could not create API key." });
    }
  },
);

// GET /api/admin/api-keys — list (prefix only, never full keys).
router.get("/api/admin/api-keys", verifyToken, requireAdmin, async (req, res) => {
  try {
    const keys = await ApiKey.find({})
      .sort({ createdAt: -1 })
      .select("name keyPrefix rateLimitPerMin active lastUsedAt revokedAt createdAt ownerUid")
      .lean();
    res.json({
      success: true,
      data: {
        keys: (keys || []).map((k) => ({
          _id: String(k._id),
          name: k.name,
          keyPrefix: k.keyPrefix,
          rateLimitPerMin: k.rateLimitPerMin,
          active: k.active,
          revokedAt: k.revokedAt,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
        })),
      },
    });
  } catch (err) {
    console.error("api-key list failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not list API keys." });
  }
});

// DELETE /api/admin/api-keys/:id — revoke (soft: active=false + revokedAt).
router.delete(
  "/api/admin/api-keys/:id",
  verifyToken,
  requireAdmin,
  validate(objectIdParam, "params"),
  async (req, res) => {
    try {
      const result = await ApiKey.updateOne(
        { _id: req.params.id },
        { $set: { active: false, revokedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "API key not found." });
      }
      await auditLog({
        userId: req.user.uid,
        action: "api_key_revoked",
        entity: "api_key",
        entityId: req.params.id,
      });
      res.json({ success: true, data: { revoked: true } });
    } catch (err) {
      console.error("api-key revoke failed:", err?.message || err);
      res.status(500).json({ success: false, message: "Could not revoke API key." });
    }
  },
);

export default router;
