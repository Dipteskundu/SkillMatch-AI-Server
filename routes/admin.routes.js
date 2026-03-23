// routes/admin.routes.js
import express from "express";
import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";
import { getFirebaseService } from "../services/firebaseService.js";
import adminGate from "../middleware/adminGate.js";

const router = express.Router();
const firebaseService = getFirebaseService();

// POST: Ban user by Firebase UID (admin only)
router.post("/api/admin/ban/:uid", adminGate, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid)
      return res.status(400).json({ success: false, message: "UID required" });

    if (!firebaseService || !firebaseService.admin) {
      return res
        .status(500)
        .json({ success: false, message: "Firebase not initialized" });
    }

    // Disable user in Firebase
    await firebaseService.admin.auth().updateUser(uid, { disabled: true });

    // Mark banned in local users collection by firebaseUid
    const db = getDB();
    await db
      .collection("users")
      .updateMany(
        { firebaseUid: uid },
        { $set: { banned: true, bannedAt: new Date() } },
      );

    res.status(200).json({ success: true, message: "User banned" });
  } catch (err) {
    console.error("Ban user error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error while banning user" });
  }
});

// POST: Unban user by Firebase UID (admin only)
router.post("/api/admin/unban/:uid", adminGate, async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid)
      return res.status(400).json({ success: false, message: "UID required" });

    if (!firebaseService || !firebaseService.admin) {
      return res
        .status(500)
        .json({ success: false, message: "Firebase not initialized" });
    }

    await firebaseService.admin.auth().updateUser(uid, { disabled: false });

    const db = getDB();
    await db
      .collection("users")
      .updateMany(
        { firebaseUid: uid },
        { $set: { banned: false }, $unset: { bannedAt: "" } },
      );

    res.status(200).json({ success: true, message: "User unbanned" });
  } catch (err) {
    console.error("Unban user error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error while unbanning user" });
  }
});

// GET: List users (admin only)
router.get("/api/admin/users", adminGate, async (req, res) => {
  try {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    const users = await db
      .collection("users")
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const total = await db.collection("users").countDocuments();

    res.status(200).json({ success: true, data: users, total });
  } catch (err) {
    console.error("List users error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error listing users" });
  }
});

export default router;
