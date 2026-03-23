// routes/applications.routes.js
// Handles job applications management

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// GET: Get applications for recruiter
// ======================================
router.get("/api/applications/recruiter/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    // 1. Fetch recruiter info
    const user = await db.collection("users").findOne({ firebaseUid: uid });

    if (!user) {
      // Try to find user by uid field instead
      const userByUid = await db.collection("users").findOne({ uid: uid });

      if (!userByUid) {
        return res
          .status(403)
          .json({ success: false, message: "User not found" });
      }

      // Use the user found by uid field
      var foundUser = userByUid;
    } else {
      var foundUser = user;
    }

    if (foundUser.role !== "recruiter") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // 2. Fetch jobs posted by this recruiter (multiple ways to match - same as dashboard)
    // Also include jobs without recruiter info as fallback for testing
    const jobs = await db
      .collection("find_jobs")
      .find({
        $or: [
          { recruiterUid: uid }, // Direct UID match
          { recruiterEmail: foundUser.email }, // Email match
          { company: foundUser.companyName }, // Company match
          { company: foundUser.displayName }, // Display name fallback
          { recruiterUid: { $exists: false } }, // Jobs without recruiter info (for testing)
          { recruiterEmail: { $exists: false } }, // Jobs without recruiter email
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    const jobIds = jobs.map((j) => j._id);

    if (jobIds.length === 0) {
      return res.json([]);
    }

    // 3. Find all applications for these jobs
    const applications = await db
      .collection("applications")
      .find({ jobId: { $in: jobIds } })
      .sort({ appliedAt: -1 })
      .toArray();

    // 4. Enrich applications with job details
    const enrichedApplications = applications.map((app) => {
      const job = jobs.find((j) => j._id.equals(app.jobId));
      return {
        ...app,
        jobTitle: job?.title || "Unknown Position",
        company: job?.company || "Unknown Company",
      };
    });

    res.json(enrichedApplications);
  } catch (error) {
    console.error("GET /api/applications/recruiter/:uid error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
});

// PUT: Update application status
// ==============================
router.put("/api/applications/:applicantId/status", async (req, res) => {
  try {
    const db = getDB();
    const { applicantId } = req.params;
    const { status, feedback } = req.body;

    // Validate status
    const validStatuses = [
      "submitted",
      "shortlisted",
      "interviewing",
      "selected",
      "rejected",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: " + validStatuses.join(", "),
      });
    }

    // Update application status
    const updateData = {
      status,
      updatedAt: new Date(),
    };

    // Add feedback if provided
    if (feedback) {
      updateData.feedback = feedback;
    }

    const result = await db
      .collection("applications")
      .updateOne({ _id: new ObjectId(applicantId) }, { $set: updateData });

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.json({
      success: true,
      message: "Application status updated successfully",
      data: {
        status,
        updatedAt: updateData.updatedAt,
        feedback: feedback || null,
      },
    });
  } catch (error) {
    console.error("PUT /api/applications/:applicantId/status error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating application status",
    });
  }
});

// TEST: Get all applications (for debugging) - MUST BE BEFORE :applicantId route
// =================================================================
router.get("/api/applications/all", async (req, res) => {
  try {
    const db = getDB();
    const applications = await db.collection("applications").find({}).toArray();
    console.log("🧪 TEST: All applications count:", applications.length);
    res.json(applications);
  } catch (error) {
    console.error("❌ TEST: Error fetching all applications:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET: Get single application details
// ===================================
router.get("/api/applications/:applicantId", async (req, res) => {
  try {
    const db = getDB();
    const { applicantId } = req.params;

    const application = await db
      .collection("applications")
      .findOne({ _id: new ObjectId(applicantId) });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    // Get job details
    const job = await db
      .collection("find_jobs")
      .findOne({ _id: new ObjectId(application.jobId) });

    // Enrich with job details
    const enrichedApplication = {
      ...application,
      jobTitle: job?.title || "Unknown Position",
      company: job?.company || "Unknown Company",
    };

    res.json(enrichedApplication);
  } catch (error) {
    console.error("GET /api/applications/:applicantId error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching application details",
    });
  }
});

export default router;
