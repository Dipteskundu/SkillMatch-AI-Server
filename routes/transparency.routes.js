// routes/transparency.routes.js
// Transparency Engine: Fit Map, Live Pulse, Gap-to-Growth, Notifications

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { validate } from "../middleware/validate.js";
import {
  applicationStatusBody,
  jobFitQuery,
  objectIdParamSchema,
} from "../lib/schemas.js";
import { computeFitForUserAndJob } from "../services/fitScoreService.js";
import { canonicalizeSkill, loadSkillVocabulary } from "../services/skillNormalize.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// ENGINE 1 – FIT INTELLIGENCE
// GET /api/jobs/:id/fit?uid=<firebaseUid>
// Returns the unified Hiring Fit Score (services/fitScore.js, fit-v1):
//   { matchScore, score, directSkills, adjacentSkills, missingSkills, ... }
// `matchScore` (= score.total) and the display arrays are kept for backward
// compatibility with FitMapModal; `score` is the full explainable contract.
// ─────────────────────────────────────────────────────────────
router.get(
  "/api/jobs/:id/fit",
  validate(objectIdParamSchema, "params"),
  validate(jobFitQuery, "query"),
  async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { uid } = req.query;

        // 1. Fetch job (404 before scoring)
        const job = await db.collection("find_jobs").findOne({ _id: new ObjectId(id) });
        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        // 2. Candidate (a missing candidate scores as an empty profile —
        //    same behaviour as the old engine, no 500s).
        const user = await db.collection("users").findOne({ firebaseUid: uid });

        // 3. ONE unified, explainable score (taxonomy + optional embeddings).
        const vocabulary = await loadSkillVocabulary();
        const score = await computeFitForUserAndJob({
            firebaseUid: uid,
            jobId: job._id,
            db,
            vocabulary,
            useEmbeddings: true, // graceful no-op when embeddings unavailable
        });

        // 4. Legacy display fields (original casing), derived from the same
        //    canonical match the score used.
        const canon = (s) => canonicalizeSkill(s, vocabulary) || String(s).toLowerCase().trim();
        const matchedSet = new Set(score.matchedSkills);
        const missingSet = new Set(score.missingSkills);
        const candidateCanonicals = new Set((user?.skills || []).map(canon));

        const originalRequired = job.skills || [];
        const displayDirect = originalRequired.filter((s) => matchedSet.has(canon(s)));
        const displayMissing = originalRequired.filter((s) => missingSet.has(canon(s)));
        const displayAdjacent = (job.niceToHaveSkills || []).filter((s) => candidateCanonicals.has(canon(s)));

        res.status(200).json({
            success: true,
            data: {
                matchScore: score.total,
                score,
                directSkills: displayDirect,
                adjacentSkills: displayAdjacent,
                missingSkills: displayMissing,
                jobTitle: job.title,
                company: job.company,
                totalRequired: originalRequired.length,
            },
        });
    } catch (error) {
        console.error("Fit Engine Error:", error);
        res.status(500).json({ success: false, message: "Server error in fit engine" });
    }
  },
);


// ─────────────────────────────────────────────────────────────
// ENGINE 2 – LIVE PULSE
// POST /api/applications/:id/viewed
// Recruiter opens candidate profile → mark as viewed
// ─────────────────────────────────────────────────────────────
router.post("/api/applications/:id/viewed", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { recruiterCompany } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid application ID" });
        }

        const application = await db.collection("applications").findOne({ _id: new ObjectId(id) });
        if (!application) {
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        // Only update if not already viewed
        if (application.status === "applied" || application.status === "submitted") {
            const timelineEvent = { status: "viewed", timestamp: new Date() };

            await db.collection("applications").updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { status: "viewed", updatedAt: new Date() },
                    $push: { timeline: timelineEvent },
                }
            );

            // Create notification for candidate
            await db.collection("notifications").insertOne({
                userId: application.firebaseUid,
                type: "application_viewed",
                applicationId: new ObjectId(id),
                jobTitle: application.jobTitle,
                message: `A recruiter${recruiterCompany ? ` at ${recruiterCompany}` : ""} is viewing your profile for ${application.jobTitle}.`,
                read: false,
                createdAt: new Date(),
            });
        }

        res.status(200).json({ success: true, message: "Application marked as viewed" });
    } catch (error) {
        console.error("Viewed Event Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ─────────────────────────────────────────────────────────────
// ENGINE 2 – LIVE PULSE
// PATCH /api/applications/:id/status
// Recruiter changes status → updates DB, timeline, notification
// ─────────────────────────────────────────────────────────────
router.patch(
    "/api/applications/:id/status",
    validate(objectIdParamSchema, "params"),
    validate(applicationStatusBody),
    async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { status, recruiterNote } = req.body;

        const VALID_STATUSES = [
            "applied", "ai_scored", "viewed", "shortlisted",
            "interview", "offer", "rejected", "hired",
        ];

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
            });
        }

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid application ID" });
        }

        const application = await db.collection("applications").findOne({ _id: new ObjectId(id) });
        if (!application) {
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        const timelineEvent = { status, timestamp: new Date(), note: recruiterNote || null };

        // Build update
        const updateDoc = {
            $set: { status, updatedAt: new Date() },
            $push: { timeline: timelineEvent },
        };

        // If rejected → run feedback engine inline
        if (status === "rejected") {
            const job = await db.collection("find_jobs").findOne({ _id: application.jobId });
            const user = await db.collection("users").findOne({ firebaseUid: application.firebaseUid });

            if (job && user) {
                const candidateSkills = (user.skills || []).map((s) => s.toLowerCase());
                const jobSkills = job.skills || [];
                const missingSkills = jobSkills.filter(
                    (s) => !candidateSkills.includes(s.toLowerCase())
                );

                const suggestedActions = missingSkills.slice(0, 3).map(
                    (skill) => `Strengthen your ${skill} skills — search for ${skill} jobs to find targeted roles.`
                );

                if (missingSkills.length === 0) {
                    suggestedActions.push("Keep building your portfolio and applying to similar roles.");
                }

                updateDoc.$set.feedback = {
                    missingSkills,
                    suggestedActions,
                    generatedAt: new Date(),
                };
            }
        }

        await db.collection("applications").updateOne({ _id: new ObjectId(id) }, updateDoc);

        // Create notification
        const notificationMessages = {
            shortlisted: `You have been shortlisted for ${application.jobTitle} at ${application.company}! 🎉`,
            interview: `You've been invited to interview for ${application.jobTitle} at ${application.company}.`,
            offer: `Congratulations! You have received an offer for ${application.jobTitle} at ${application.company}! 🎊`,
            rejected: `You were not selected for ${application.jobTitle}, but here is how to improve your chances.`,
            viewed: `A recruiter viewed your application for ${application.jobTitle}.`,
            hired: `🎉 Welcome aboard! Your offer for ${application.jobTitle} at ${application.company} has been confirmed!`,
        };

        if (notificationMessages[status]) {
            await db.collection("notifications").insertOne({
                userId: application.firebaseUid,
                type: `status_${status}`,
                applicationId: new ObjectId(id),
                jobTitle: application.jobTitle,
                company: application.company,
                message: notificationMessages[status],
                read: false,
                createdAt: new Date(),
            });
        }

        res.status(200).json({ success: true, message: `Status updated to "${status}"` });
    } catch (error) {
        console.error("Status Update Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
  },
);


// ─────────────────────────────────────────────────────────────
// ENGINE 3 – GAP-TO-GROWTH FEEDBACK
// GET /api/applications/:id/feedback
// Returns stored feedback object for a rejected application
// ─────────────────────────────────────────────────────────────
router.get("/api/applications/:id/feedback", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid application ID" });
        }

        const application = await db.collection("applications").findOne(
            { _id: new ObjectId(id) },
            { projection: { feedback: 1, jobTitle: 1, company: 1, status: 1 } }
        );

        if (!application) {
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        if (!application.feedback) {
            return res.status(200).json({
                success: true,
                data: null,
                message: "No feedback available for this application",
            });
        }

        res.status(200).json({
            success: true,
            data: {
                jobTitle: application.jobTitle,
                company: application.company,
                status: application.status,
                ...application.feedback,
            },
        });
    } catch (error) {
        console.error("Feedback Fetch Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ─────────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM
// GET /api/notifications/:uid
// Fetch all notifications for a user, sorted newest first
// ─────────────────────────────────────────────────────────────
router.get("/api/notifications/:uid", async (req, res) => {
    try {
        const db = getDB();
        const { uid } = req.params;

        const notifications = await db.collection("notifications")
            .find({ userId: uid })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray();

        const unreadCount = notifications.filter((n) => !n.read).length;

        res.status(200).json({
            success: true,
            data: { notifications, unreadCount },
        });
    } catch (error) {
        console.error("Notifications Fetch Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ─────────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM
// PATCH /api/notifications/:id/read
// Mark a single notification as read
// ─────────────────────────────────────────────────────────────
router.patch("/api/notifications/:id/read", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid notification ID" });
        }

        await db.collection("notifications").updateOne(
            { _id: new ObjectId(id) },
            { $set: { read: true, readAt: new Date() } }
        );

        res.status(200).json({ success: true, message: "Notification marked as read" });
    } catch (error) {
        console.error("Mark Read Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ─────────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM
// PATCH /api/notifications/read-all/:uid
// Mark all notifications as read for a user
// ─────────────────────────────────────────────────────────────
router.patch("/api/notifications/read-all/:uid", async (req, res) => {
    try {
        const db = getDB();
        const { uid } = req.params;

        await db.collection("notifications").updateMany(
            { userId: uid, read: false },
            { $set: { read: true, readAt: new Date() } }
        );

        res.status(200).json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
        console.error("Mark All Read Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


export default router;
