// admin.routes.js
// All admin-only API routes for the SkillMatch AI platform

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// Returns all users with normalised fields
router.get("/api/admin/users", async (req, res) => {
  try {
    const db = getDB();
    const rows = await db
      .collection("users")
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const users = rows.map((u) => {
      const id = u._id ? u._id.toString() : u.id;
      return {
        ...u,
        id,
        _id: id,
        uid: u.uid || u.firebaseUid || id,
        name: u.name || u.displayName || "Unknown User",
        email: u.email || "",
        role:
          u.role === "recruiter"
            ? "recruiter"
            : u.role === "admin"
              ? "admin"
              : "candidate",
        status: u.status || "active",
        flagged: Boolean(u.flagged || u.status === "banned"),
        joinedDate: u.joinedDate || u.createdAt || new Date(),
      };
    });

    res.status(200).json({ users });
  } catch (err) {
    console.error("Admin users GET error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ─── POST /api/admin/users ────────────────────────────────────────────────────
// Upsert / sync a user record (called after Firebase sign-in)
router.post("/api/admin/users", async (req, res) => {
  try {
    const db = getDB();
    const body = req.body || {};
    const now = new Date();

    const email = (body.email || "").trim().toLowerCase();
    const uid = body.uid || body.firebaseUid || null;

    if (!email && !uid) {
      return res.status(400).json({ error: "email or uid is required" });
    }

    const filters = [];
    if (uid) filters.push({ uid }, { firebaseUid: uid });
    if (email) filters.push({ email });
    if (body.id && ObjectId.isValid(body.id))
      filters.push({ _id: new ObjectId(body.id) });

    const filter = filters.length === 1 ? filters[0] : { $or: filters };

    const safeRole =
      body.role === "recruiter"
        ? "recruiter"
        : body.role === "admin"
          ? "admin"
          : "candidate";

    const safeStatus =
      body.status === "inactive" || body.status === "banned"
        ? body.status
        : "active";

    await db.collection("users").updateOne(
      filter,
      {
        $set: {
          uid,
          email,
          name: body.name || body.displayName || "",
          role: safeRole,
          status: safeStatus,
          flagged: Boolean(body.flagged || safeStatus === "banned"),
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now, joinedDate: now },
      },
      { upsert: true },
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Admin users POST error:", err);
    res.status(500).json({ error: "Failed to sync user" });
  }
});

// ─── PATCH /api/admin/users/:userId ──────────────────────────────────────────
// Ban, unban, or deactivate a user
const ALLOWED_STATUSES = new Set(["active", "inactive", "banned"]);

router.patch("/api/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const body = req.body || {};
    const status = body.status;

    if (!ALLOWED_STATUSES.has(status)) {
      return res
        .status(400)
        .json({ error: "status must be active, inactive, or banned" });
    }

    const db = getDB();
    const now = new Date();

    const filters = [
      { uid: userId },
      { firebaseUid: userId },
      { email: userId },
      { id: userId },
    ];
    if (ObjectId.isValid(userId)) {
      filters.unshift({ _id: new ObjectId(userId) });
    }

    const result = await db.collection("users").updateOne(
      { $or: filters },
      {
        $set: {
          status,
          flagged: status === "banned",
          updatedAt: now,
        },
      },
    );

    if (!result.matchedCount) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      success: true,
      status,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Admin users PATCH error:", err);
    res.status(500).json({ error: "Failed to update user status" });
  }
});

// ─── GET /api/admin/metrics ───────────────────────────────────────────────────
// Aggregated platform metrics for the admin dashboard
router.get("/api/admin/metrics", async (req, res) => {
  try {
    const db = getDB();

    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      jobPostings,
      totalApplications,
      totalCompanies,
      pendingJobRequests,
      suspiciousPosts,
    ] = await Promise.all([
      db.collection("users").countDocuments({}),
      db.collection("users").countDocuments({
        $or: [
          { status: "active" },
          { status: { $exists: false } },
          { status: null },
          { status: "" },
        ],
      }),
      db.collection("users").countDocuments({ status: "banned" }),
      db.collection("find_jobs").countDocuments({}),
      db.collection("applications").countDocuments({}),
      db.collection("companies_info").countDocuments({}),
      db.collection("jobRequests").countDocuments({ status: "pending" }),
      db.collection("suspiciousPosts").countDocuments({}),
    ]);

    res.status(200).json({
      totalUsers,
      activeUsers,
      bannedUsers,
      jobPostings,
      totalApplications,
      totalCompanies,
      pendingJobRequests,
      fraudDetected: suspiciousPosts,
      dailyActivity: activeUsers,
    });
  } catch (err) {
    console.error("Admin metrics GET error:", err);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// ─── GET /api/admin/suspicious-posts ─────────────────────────────────────────
router.get("/api/admin/suspicious-posts", async (req, res) => {
  try {
    const db = getDB();
    const rows = await db
      .collection("suspiciousPosts")
      .find({})
      .sort({ flaggedDate: -1, createdAt: -1, _id: -1 })
      .toArray();

    const posts = rows.map((p) => {
      const id = p._id ? p._id.toString() : p.id;
      return {
        ...p,
        id,
        _id: id,
        title: p.title || "Untitled post",
        company: p.company || "Unknown company",
        status: p.status || "flagged",
        suspicionReasons: Array.isArray(p.suspicionReasons)
          ? p.suspicionReasons
          : ["Flagged by moderation rules"],
        flaggedDate: p.flaggedDate || p.createdAt || new Date(),
      };
    });

    res.status(200).json({ posts });
  } catch (err) {
    console.error("Admin suspicious-posts GET error:", err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// ─── PATCH /api/admin/suspicious-posts/:postId ───────────────────────────────
router.patch("/api/admin/suspicious-posts/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    const nextStatus = req.body?.status || "reviewed";
    const db = getDB();

    const filter = ObjectId.isValid(postId)
      ? { _id: new ObjectId(postId) }
      : { id: postId };

    const result = await db.collection("suspiciousPosts").updateOne(filter, {
      $set: {
        status: nextStatus,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    if (!result.matchedCount) {
      // Graceful fallback – treat as already reviewed
      return res
        .status(200)
        .json({ success: true, message: "Already reviewed or not found" });
    }

    res.status(200).json({ success: true, status: nextStatus });
  } catch (err) {
    console.error("Admin suspicious-posts PATCH error:", err);
    res.status(500).json({ error: "Failed to review post" });
  }
});

// ─── DELETE /api/admin/suspicious-posts/:postId ──────────────────────────────
router.delete("/api/admin/suspicious-posts/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    const db = getDB();

    const filter = ObjectId.isValid(postId)
      ? { _id: new ObjectId(postId) }
      : { id: postId };

    const result = await db.collection("suspiciousPosts").deleteOne(filter);

    if (!result.deletedCount) {
      return res
        .status(200)
        .json({ success: true, message: "Already removed or not found" });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Admin suspicious-posts DELETE error:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// ─── GET /api/admin/job-requests ─────────────────────────────────────────────
router.get("/api/admin/job-requests", async (req, res) => {
  try {
    const db = getDB();
    const requests = await db
      .collection("jobRequests")
      .find({})
      .sort({ requestedAt: -1, createdAt: -1, _id: -1 })
      .toArray();

    const serialized = requests.map((r) => ({
      ...r,
      id: r._id.toString(),
      _id: r._id.toString(),
    }));

    res.status(200).json({ requests: serialized });
  } catch (err) {
    console.error("Admin job-requests GET error:", err);
    res.status(500).json({ error: "Failed to fetch job requests" });
  }
});

// ─── PATCH /api/admin/job-requests/:requestId ────────────────────────────────
// Approve (posts the job) or reject a recruiter job request
router.patch("/api/admin/job-requests/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const nextStatus = req.body?.status;

    if (!["approved", "rejected"].includes(nextStatus)) {
      return res
        .status(400)
        .json({ error: "status must be approved or rejected" });
    }

    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    const db = getDB();
    const requestObjectId = new ObjectId(requestId);
    const now = new Date();

    const existing = await db
      .collection("jobRequests")
      .findOne({ _id: requestObjectId });
    if (!existing) {
      return res.status(404).json({ error: "Request not found" });
    }

    await db
      .collection("jobRequests")
      .updateOne(
        { _id: requestObjectId },
        { $set: { status: nextStatus, updatedAt: now, reviewedAt: now } },
      );

    if (nextStatus === "approved") {
      await db.collection("find_jobs").insertOne({
        title: existing.title,
        location: existing.location,
        salary: existing.salary,
        description: existing.description,
        employmentType: existing.employmentType || "Full-time",
        company: existing.companyName || "Unknown Company",
        companyName: existing.companyName || "Unknown Company",
        recruiterEmail: existing.recruiterEmail || "",
        status: "active",
        applicants: 0,
        postedDate: now,
        createdAt: now,
        sourceRequestId: requestObjectId,
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Admin job-requests PATCH error:", err);
    res.status(500).json({ error: "Failed to update job request" });
  }
});

export default router;
