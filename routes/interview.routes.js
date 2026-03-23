// routes/interview.routes.js
// Handles interview scheduling and management

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// GET: Get interviews for candidate (by applicant email)
// =======================================
router.get("/api/interviews/candidate/:email", async (req, res) => {
  try {
    const db = getDB();
    const { email } = req.params;

    // Use case-insensitive regex to match emails regardless of case
    const interviews = await db
      .collection("interviews")
      .find({
        applicantEmail: {
          $regex: new RegExp(
            "^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            "i",
          ),
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: interviews,
    });
  } catch (error) {
    console.error("GET Candidate Interviews Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching interviews",
    });
  }
});

// GET: Get interviews for recruiter
// =======================================
router.get("/api/interviews/recruiter/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    const interviews = await db
      .collection("interviews")
      .find({ recruiterId: uid })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: interviews,
    });
  } catch (error) {
    console.error("GET Interviews Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching interviews",
    });
  }
});

// POST: Schedule new interview
// =======================================
router.post("/api/interviews", async (req, res) => {
  try {
    const db = getDB();
    const {
      applicantId,
      jobId,
      recruiterId,
      date,
      time,
      type,
      meetingLink,
      notes,
      status = "scheduled",
    } = req.body;

    // Validation - only require recruiterId, date, and time
    if (!recruiterId || !date || !time) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: recruiterId, date, and time are required",
      });
    }

    // Get applicant details (optional)
    let applicant = null;
    if (applicantId) {
      try {
        applicant = await db
          .collection("applications")
          .findOne({ _id: new ObjectId(applicantId) });
      } catch (err) {
        console.log(
          "Applicant not found, proceeding without applicant details",
        );
      }
    }

    // Get job details (optional)
    let job = null;
    if (jobId) {
      try {
        job = await db
          .collection("find_jobs")
          .findOne({ _id: new ObjectId(jobId) });
      } catch (err) {
        console.log("Job not found, proceeding without job details");
      }
    }

    const interview = {
      applicantId: applicantId ? new ObjectId(applicantId) : null,
      applicantName:
        applicant?.name || applicant?.email?.split("@")[0] || "Candidate",
      applicantEmail: applicant?.email || null,
      jobId: jobId ? new ObjectId(jobId) : null,
      jobTitle: job?.title || "General Interview",
      recruiterId,
      date,
      time,
      type,
      meetingLink,
      notes,
      status,
      createdAt: new Date(),
    };

    const result = await db.collection("interviews").insertOne(interview);

    // Update application status
    await db.collection("applications").updateOne(
      { _id: new ObjectId(applicantId) },
      {
        $set: {
          status: "interview_scheduled",
          updatedAt: new Date(),
          timeline: [
            ...(applicant.timeline || []),
            { status: "interview_scheduled", timestamp: new Date() },
          ],
        },
      },
    );

    res.status(201).json({
      success: true,
      message: "Interview scheduled successfully",
      data: {
        _id: result.insertedId,
        ...interview,
      },
    });
  } catch (error) {
    console.error("POST Interview Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while scheduling interview",
    });
  }
});

// PUT: Reschedule interview
// =======================================
router.put("/api/interviews/:id/reschedule", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { date, time, meetingLink } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid interview ID",
      });
    }

    const result = await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          date,
          time,
          meetingLink,
          updatedAt: new Date(),
          status: "rescheduled",
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
      message: "Interview rescheduled successfully",
    });
  } catch (error) {
    console.error("PUT Interview Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while rescheduling interview",
    });
  }
});

// DELETE: Cancel interview
// =======================================
router.delete("/api/interviews/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid interview ID",
      });
    }

    const interview = await db
      .collection("interviews")
      .findOne({ _id: new ObjectId(id) });
    if (!interview) {
      return res.status(404).json({
        success: false,
        message: "Interview not found",
      });
    }

    // Update application status back to submitted
    await db.collection("applications").updateOne(
      { _id: interview.applicantId },
      {
        $set: {
          status: "submitted",
          updatedAt: new Date(),
          timeline: [
            ...(interview.timeline || []),
            { status: "cancelled", timestamp: new Date() },
          ],
        },
      },
    );

    // Delete interview
    const result = await db
      .collection("interviews")
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Interview not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Interview cancelled successfully",
    });
  } catch (error) {
    console.error("DELETE Interview Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while cancelling interview",
    });
  }
});

export default router;
