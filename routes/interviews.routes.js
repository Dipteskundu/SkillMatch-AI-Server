// routes/interviews.routes.js
// Handles interview-related API routes

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";

const router = express.Router();
const firebaseService = getFirebaseService();

console.log(
  "Interviews routes loaded with Firebase service:",
  !!firebaseService,
);

// Test endpoint to verify routes are working
router.get("/api/interviews/test", (req, res) => {
  console.log("Test endpoint hit!");
  res.json({ success: true, message: "Interviews routes are working!" });
});

// GET: Get Recruiter's Interviews
// =======================================
router.get("/api/interviews/recruiter/:uid", async (req, res) => {
  try {
    console.log("=== GETTING RECRUITER INTERVIEWS ===");
    console.log("Recruiter UID:", req.params.uid);

    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID is required",
      });
    }

    // Get recruiter info
    const recruiter = await db
      .collection("users")
      .findOne({ firebaseUid: uid });

    console.log("Recruiter found:", recruiter ? "Yes" : "No");
    console.log(
      "Recruiter company:",
      recruiter?.companyName || recruiter?.displayName,
    );

    // Get all interviews and filter by recruiterId for now
    const allInterviews = await db.collection("interviews").find({}).toArray();
    console.log("All interviews in database:", allInterviews.length);

    // Log each interview to see what we have
    allInterviews.forEach((interview, index) => {
      console.log(`Interview ${index + 1}:`, {
        id: interview._id,
        recruiterId: interview.recruiterId,
        applicantId: interview.applicantId,
        company: interview.company,
        jobTitle: interview.jobTitle,
      });
    });

    // Simple filter by recruiterId, but also include old interviews with 'recruiter' as fallback
    const interviews = allInterviews.filter(
      (interview) =>
        interview.recruiterId === uid || interview.recruiterId === "recruiter",
    );

    console.log("Filtered interviews for recruiter:", interviews.length);

    res.status(200).json({
      success: true,
      interviews,
      count: interviews.length,
    });
  } catch (error) {
    console.error("GET Recruiter Interviews Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching interviews",
    });
  }
});

// PUT: Update Interview Status
// =======================================
router.put("/api/interviews/:id/status", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid interview ID format",
      });
    }

    const validStatuses = ["scheduled", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const result = await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Interview not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Interview status updated successfully",
    });
  } catch (error) {
    console.error("UPDATE Interview Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating interview status",
    });
  }
});

// GET: Get Candidate's Interviews
// =======================================
router.get("/api/interviews/candidate/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Candidate UID is required",
      });
    }

    // Fetch interviews for the candidate
    const interviews = await db
      .collection("interviews")
      .find({ applicantId: uid })
      .sort({ scheduledDateTime: 1 }) // Sort by date ascending
      .toArray();

    res.status(200).json({
      success: true,
      interviews,
      count: interviews.length,
    });
  } catch (error) {
    console.error("GET Candidate Interviews Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching candidate interviews",
    });
  }
});

// POST: Schedule New Interview
// =======================================
router.post("/api/interviews", async (req, res) => {
  try {
    console.log("=== INTERVIEW SCHEDULING REQUEST ===");
    console.log("Request body:", req.body);

    const db = getDB();
    const interviewData = req.body;

    // Simple validation
    if (
      !interviewData.applicantId ||
      !interviewData.date ||
      !interviewData.time
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: applicantId, date, time",
      });
    }

    // Create interview document
    const interview = {
      ...interviewData,
      _id: new ObjectId(),
      status: "scheduled",
      createdAt: new Date(),
      updatedAt: new Date(),
      scheduledDateTime: new Date(
        `${interviewData.date}T${interviewData.time}`,
      ),
    };

    console.log("Saving interview to database...");
    const result = await db.collection("interviews").insertOne(interview);
    console.log("Interview saved:", result);

    // Create notification for candidate
    const notification = {
      userId: interviewData.applicantId, // This should be the candidate's Firebase UID
      type: "interview_scheduled",
      interviewId: interview._id.toString(),
      jobId: interviewData.jobId,
      jobTitle: interviewData.jobTitle,
      company: interviewData.company,
      message: `Interview scheduled for ${interviewData.jobTitle} at ${interviewData.company}`,
      interviewDetails: {
        date: interviewData.date,
        time: interviewData.time,
        type: interviewData.type,
        duration: interviewData.duration,
        location: interviewData.location,
        meetingUrl: interviewData.meetingUrl,
        meetingId: interviewData.meetingId,
        notes: interviewData.notes,
      },
      read: false,
      createdAt: new Date(),
    };

    console.log("Creating notification:", notification);

    // Save notification to database
    await db.collection("notifications").insertOne(notification);
    console.log("Notification saved to database");

    // Send real-time notification via Firebase
    if (firebaseService) {
      try {
        await firebaseService.sendNotification(
          interviewData.applicantId,
          notification,
        );
        console.log("Firebase notification sent");
      } catch (firebaseError) {
        console.error("Firebase notification error:", firebaseError);
      }
    }

    console.log("=== INTERVIEW SCHEDULING SUCCESS ===");

    res.status(201).json({
      success: true,
      message: "Interview scheduled successfully",
      data: {
        interviewId: interview._id.toString(),
        ...interview,
      },
    });
  } catch (error) {
    console.error("=== INTERVIEW SCHEDULING ERROR ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    res.status(500).json({
      success: false,
      message: "Server error while scheduling interview",
    });
  }
});

export default router;
