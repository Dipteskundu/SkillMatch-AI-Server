// routes/transparency.routes.js
// Transparency Engine: Fit Map, Live Pulse, Gap-to-Growth, Notifications

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// ENGINE 1 – FIT INTELLIGENCE
// GET /api/jobs/:id/fit?uid=<firebaseUid>
// Returns match score, direct skills, adjacent skills, missing skills
// ─────────────────────────────────────────────────────────────
router.get("/api/jobs/:id/fit", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { uid } = req.query;

        if (!uid) {
            return res.status(400).json({ success: false, message: "uid query param required" });
        }

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid job ID" });
        }

        // 1. Fetch job
        const job = await db.collection("find_jobs").findOne({ _id: new ObjectId(id) });
        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        // 2. Fetch candidate skills
        const user = await db.collection("users").findOne({ firebaseUid: uid });
        const candidateSkills = (user?.skills || []).map((s) => s.toLowerCase().trim());

        // Job skills (required) — normalise
        const requiredSkills = (job.skills || []).map((s) => s.toLowerCase().trim());
        const niceToHaveSkills = (job.niceToHaveSkills || []).map((s) => s.toLowerCase().trim());

        // 3. Compute sets
        const directSkills = requiredSkills.filter((s) => candidateSkills.includes(s));
        const missingSkills = requiredSkills.filter((s) => !candidateSkills.includes(s));
        const adjacentSkills = niceToHaveSkills.filter((s) => candidateSkills.includes(s));

        // 4. Score  (80% from required, 20% from nice-to-have)
        const requiredScore = requiredSkills.length > 0
            ? (directSkills.length / requiredSkills.length) * 80
            : 80;

        const niceScore = niceToHaveSkills.length > 0
            ? (adjacentSkills.length / niceToHaveSkills.length) * 20
            : 20;

        const matchScore = Math.round(requiredScore + niceScore);

        // 5. Return original-casing versions for display
        const originalRequired = job.skills || [];
        const originalNiceToHave = job.niceToHaveSkills || [];
        const userOriginalSkills = user?.skills || [];

        const displayDirect = originalRequired.filter(
            (s) => userOriginalSkills.map((u) => u.toLowerCase()).includes(s.toLowerCase())
        );
        const displayMissing = originalRequired.filter(
            (s) => !userOriginalSkills.map((u) => u.toLowerCase()).includes(s.toLowerCase())
        );
        const displayAdjacent = originalNiceToHave.filter(
            (s) => userOriginalSkills.map((u) => u.toLowerCase()).includes(s.toLowerCase())
        );

        res.status(200).json({
            success: true,
            data: {
                matchScore,
                directSkills: displayDirect,
                adjacentSkills: displayAdjacent,
                missingSkills: displayMissing,
                jobTitle: job.title,
                company: job.company,
                totalRequired: originalRequired.length,
            },
        });
    } catch (error) {
        // error handled silently
        res.status(500).json({ success: false, message: "Server error in fit engine" });
    }
});


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
        // error handled silently
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ─────────────────────────────────────────────────────────────
// ENGINE 2 – LIVE PULSE
// PATCH /api/applications/:id/status
// Recruiter changes status → updates DB, timeline, notification
// ─────────────────────────────────────────────────────────────
router.patch("/api/applications/:id/status", async (req, res) => {
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
        // error handled silently
        res.status(500).json({ success: false, message: "Server error" });
    }
});


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
        // error handled silently
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
        // error handled silently
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
        // error handled silently
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
        // error handled silently
        res.status(500).json({ success: false, message: "Server error" });
    }
});


export default router;
