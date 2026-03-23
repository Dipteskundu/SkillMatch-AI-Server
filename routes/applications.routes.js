// routes/applications.routes.js
// Handles application-related API routes

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";

const router = express.Router();
const firebaseService = getFirebaseService();

// GET: Get Recruiter's Applications
// =======================================
router.get("/api/applications/recruiter/:uid", async (req, res) => {
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
          skills: candidate?.skills || [],
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
router.put("/api/applications/:id/status", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status, feedback } = req.body;

    // Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid application ID format",
      });
    }

    // Find and update application
    const application = await db.collection("applications").findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          feedback: feedback || null,
          updatedAt: new Date(),
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

    // Send real-time notification via Firebase
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
});

export default router;
