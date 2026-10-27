// routes/applications.routes.js
// Handles application-related API routes

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";
import { validate } from "../middleware/validate.js";
import {
  applicationRecalculateQuery,
  applicationStatusBody,
  objectIdParamSchema,
  uidParamSchema,
} from "../lib/schemas.js";
import {
  recomputeApplicationAiScore,
  toApiAiScore,
} from "../services/fitScoreService.js";

const router = express.Router();

// GET: Get Recruiter's Applications
// =======================================
router.get("/api/applications/recruiter/:uid", validate(uidParamSchema, "params"), async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID is required",
      });
    }

    // Get recruiter info to find their company
    const recruiter = await db
      .collection("users")
      .findOne({ firebaseUid: uid });
    if (
      !recruiter ||
      (recruiter.role !== "recruiter" && recruiter.role !== "employer")
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Recruiter role required.",
      });
    }

    // Find all applications for recruiter's jobs
    const applications = await db
      .collection("applications")
      .aggregate([
        {
          $lookup: {
            from: "find_jobs",
            localField: "jobId",
            foreignField: "_id",
            as: "jobDetails",
          },
        },
        { $unwind: "$jobDetails" },
        {
          $match: {
            $or: [
              {
                "jobDetails.company":
                  recruiter.companyName || recruiter.displayName,
              },
              { "jobDetails.postedBy": uid },
            ],
          },
        },
        {
          $addFields: {
            jobTitle: "$jobDetails.title",
            company: "$jobDetails.company",
            location: "$jobDetails.location",
            appliedAt: "$createdAt",
          },
        },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    // Get candidate details for each application
    const applicationsWithCandidates = await Promise.all(
      applications.map(async (app) => {
        const candidate = await db
          .collection("users")
          .findOne({ firebaseUid: app.firebaseUid });
        return {
          ...app,
          displayName: candidate?.displayName || "",
          photoURL: candidate?.photoURL || "",
          skills: candidate?.skills || [],
          isSkillVerified: candidate?.isSkillVerified || false,
          isCommunicationVerified: candidate?.isCommunicationVerified || false,
          title: candidate?.title || "",
          phone: candidate?.phone || "",
        };
      }),
    );

    res.status(200).json({
      success: true,
      applications: applicationsWithCandidates,
    });
  } catch (error) {
    console.error("GET Recruiter Applications Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
});

// PUT: Update Application Status
// =======================================
router.put(
  "/api/applications/:id/status",
  validate(objectIdParamSchema, "params"),
  validate(applicationStatusBody),
  async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status, feedback } = req.body;

    // Find and update application.
    // NOTE: timeline must be $push-ed, not $set-ted — the old code replaced
    // the entire timeline array with a single object, which broke every
    // subsequent timeline push/read. $push appends correctly, preserving the
    // array shape that the rest of the codebase (and Mongoose schema) expects.
    const application = await db.collection("applications").findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          feedback: feedback || null,
          updatedAt: new Date(),
        },
        $push: {
          timeline: { status, timestamp: new Date() },
        },
      },
      { returnDocument: "after" },
    );

    if (!application.value) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const updatedApplication = application.value;

    // Create notification for candidate
    const statusMessages = {
      submitted: "Your application has been received and is under review.",
      shortlisted: "Congratulations! Your application has been shortlisted.",
      interviewing:
        "You've been selected for an interview! The recruiter will contact you soon.",
      selected: "Congratulations! You have been selected for the position.",
      rejected: `Your application status has been updated.${feedback ? ` Feedback: ${feedback}` : ""}`,
    };

    const notification = {
      userId: updatedApplication.firebaseUid,
      type: "application_status",
      applicationId: updatedApplication._id,
      jobId: updatedApplication.jobId,
      jobTitle: updatedApplication.jobTitle,
      company: updatedApplication.company,
      message:
        statusMessages[status] ||
        `Your application status has been updated to: ${status}`,
      status: status,
      feedback: feedback || null,
      read: false,
      createdAt: new Date(),
    };

    // Save notification to database
    await db.collection("notifications").insertOne(notification);

    // Send real-time notification via Firebase (best-effort)
    const firebaseService = getFirebaseService();
    if (firebaseService) {
      try {
        await firebaseService.sendNotification(
          updatedApplication.firebaseUid,
          notification,
        );
      } catch (firebaseError) {
        console.error("Firebase notification error:", firebaseError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Application status updated successfully",
      data: updatedApplication,
    });
  } catch (error) {
    console.error("Update Application Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating application status",
    });
  }
  },
);

// POST: Force Recalculate aiScore (Hiring Fit Score)
// =======================================
// Recruiter/admin only for now (real role gating lands with middleware/auth
// Phase 2): the caller must be an admin, OR a recruiter who owns the job
// (postedBy / company match — same ownership rule as GET /api/jobs/my-jobs).
router.post(
  "/api/applications/:id/recalculate",
  validate(objectIdParamSchema, "params"),
  validate(applicationRecalculateQuery, "query"),
  async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { uid } = req.query;

    const application = await db
      .collection("applications")
      .findOne({ _id: new ObjectId(id) });
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const requester = await db.collection("users").findOne({ firebaseUid: uid });
    if (!requester) {
      return res.status(404).json({ success: false, message: "Requester not found" });
    }

    const ownsJob = async () => {
      if (requester.role === "admin") return true;
      if (requester.role !== "recruiter" && requester.role !== "employer") return false;
      const job = await db.collection("find_jobs").findOne({ _id: application.jobId });
      if (!job) return false;
      return job.postedBy === uid ||
        job.company === (requester.companyName || requester.displayName);
    };

    if (!(await ownsJob())) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only the job's recruiter or an admin can recalculate scores.",
      });
    }

    const score = await recomputeApplicationAiScore(application, db);
    if (!score) {
      return res.status(404).json({
        success: false,
        message: "Candidate or job for this application could not be found",
      });
    }

    res.status(200).json({
      success: true,
      message: "aiScore recalculated",
      data: { aiScore: toApiAiScore(score) },
    });
  } catch (error) {
    console.error("Recalculate aiScore Error:", error);
    res.status(500).json({ success: false, message: "Server error while recalculating aiScore" });
  }
  },
);

export default router;
