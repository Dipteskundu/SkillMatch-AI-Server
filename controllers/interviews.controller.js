// controllers/interviews.controller.js
import { ObjectId } from "mongodb";
import crypto from "crypto";
import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";

// Utility to generate a unique room name for Jitsi
const generateJitsiRoom = (jobId, applicationId) => {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(3).toString("hex");
  return `skillmatch-${jobId || "job"}-${applicationId || "app"}-${timestamp}-${randomSuffix}`;
};

const sanitizeText = (value, maxLen = 5000) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
};

const parseScheduledAt = (date, time) => {
  if (!date || !time) return null;
  const dt = new Date(`${date}T${time}`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

async function sendInterviewNotification({ db, userId, notification }) {
  if (!userId) return;

  try {
    await db.collection("notifications").insertOne(notification);
  } catch (err) {
    console.error("Failed to persist notification:", err);
  }

  const firebaseService = getFirebaseService();
  if (!firebaseService) return;

  try {
    await firebaseService.sendNotification(userId, notification);
  } catch (err) {
    console.error("Failed to send Firebase notification:", err);
  }
};

export const scheduleInterview = async (req, res) => {
  try {
    const db = getDB();
    const interviewData = req.body || {};
    const recruiterUid = req.user?.uid || interviewData.recruiterId;

    // Validation
    if (!recruiterUid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!interviewData.applicantId || !interviewData.date || !interviewData.time) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: applicantId, date, time",
      });
    }

    const scheduledAt = parseScheduledAt(interviewData.date, interviewData.time);
    if (!scheduledAt) {
      return res.status(400).json({ success: false, message: "Invalid date/time format" });
    }

    // If applicationId is provided, validate ownership + stage, and prevent duplicates.
    let application = null;
    let job = null;
    if (interviewData.applicationId && ObjectId.isValid(interviewData.applicationId)) {
      application = await db.collection("applications").findOne({ _id: new ObjectId(interviewData.applicationId) });
      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }

      // Validate candidate match
      if (application.firebaseUid && interviewData.applicantId !== application.firebaseUid) {
        return res.status(400).json({ success: false, message: "Applicant does not match application" });
      }

      // Validate recruiter role + ownership
      const recruiter = await db.collection("users").findOne({ firebaseUid: recruiterUid });
      if (!recruiter) {
        return res.status(404).json({ success: false, message: "Recruiter profile not found" });
      }
      if (recruiter.role !== "recruiter" && recruiter.role !== "employer" && recruiter.role !== "admin") {
        return res.status(403).json({ success: false, message: "Recruiter access required" });
      }

      if (application.jobId) {
        job = await db.collection("find_jobs").findOne({ _id: application.jobId });
      }

      if (job) {
        const ownsJob = job.postedBy === recruiterUid || job.company === (recruiter.companyName || recruiter.displayName);
        if (!ownsJob && recruiter.role !== "admin") {
          return res.status(403).json({ success: false, message: "You do not own this job/application" });
        }
      }

      // Validate stage (allow legacy 'shortlisted' -> selecting for interview)
      const allowedStages = ["interview_selected", "shortlisted"];
      if (application.status && !allowedStages.includes(application.status)) {
        return res.status(409).json({
          success: false,
          message: `Application is not in a schedulable stage (current: ${application.status})`,
        });
      }

      // Prevent duplicates for same application while active
      const existingActive = await db.collection("interviews").findOne({
        applicationId: new ObjectId(interviewData.applicationId),
        status: { $in: ["scheduled", "live", "rescheduled"] },
      });
      if (existingActive) {
        return res.status(409).json({ success: false, message: "An active interview already exists for this application" });
      }
    }

    // Generate Jitsi Link if it's a video interview
    let meetingUrl = interviewData.meetingUrl;
    let meetingLink = interviewData.meetingLink;
    let meetingRoomName = null;

    if (interviewData.type === "video") {
      const jobId = interviewData.jobId || (job?._id?.toString?.() ?? null);
      meetingRoomName = generateJitsiRoom(jobId, interviewData.applicationId || interviewData.applicantId);
      meetingUrl = `https://meet.jit.si/${meetingRoomName}`;
      meetingLink = meetingUrl;
    }

    // Create interview document
    const interview = {
      _id: new ObjectId(),
      // Pipeline links
      jobId:
        interviewData.jobId && ObjectId.isValid(interviewData.jobId)
          ? new ObjectId(interviewData.jobId)
          : (application?.jobId || null),
      applicationId: interviewData.applicationId && ObjectId.isValid(interviewData.applicationId)
        ? new ObjectId(interviewData.applicationId)
        : null,

      // Ownership
      recruiterId: recruiterUid,
      applicantId: interviewData.applicantId,

      // Display fields
      company: sanitizeText(interviewData.company || job?.company || "", 200),
      jobTitle: sanitizeText(interviewData.jobTitle || job?.title || "", 200),
      applicantEmail: sanitizeText(interviewData.applicantEmail || "", 320),
      applicantName: sanitizeText(interviewData.applicantName || "", 200),
      interviewTitle: sanitizeText(interviewData.interviewTitle || interviewData.title || "Interview", 200),

      // Scheduling
      type: sanitizeText(interviewData.type || "video", 20),
      timezone: sanitizeText(interviewData.timezone || "Asia/Dhaka", 64),
      durationMinutes: Number(interviewData.durationMinutes || interviewData.duration || 30),
      duration: String(interviewData.durationMinutes || interviewData.duration || 30),
      date: sanitizeText(interviewData.date, 20),
      time: sanitizeText(interviewData.time, 20),
      scheduledDateTime: scheduledAt,

      // Notes/instructions
      notes: sanitizeText(interviewData.notes, 5000),
      recruiterInstructions: sanitizeText(interviewData.recruiterInstructions, 5000),
      candidateInstructions: sanitizeText(interviewData.candidateInstructions, 5000),

      meetingProvider: interviewData.type === "video" ? "jitsi" : "custom",
      meetingUrl, // legacy field
      meetingLink,
      meetingRoomName,

      status: "scheduled",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection("interviews").insertOne(interview);

    // Update Application Status if applicable
    if (application?._id) {
      try {
        await db.collection("applications").updateOne(
          { _id: application._id },
          {
            $set: { status: "interviewing", updatedAt: new Date() },
            $push: { timeline: { status: "interviewing", timestamp: new Date() } }
          }
        );
      } catch (err) {
        console.error("Failed to update application status to interviewing:", err);
      }
    }

    const candidateMessage = `Your interview for ${interview.jobTitle || "a job"} has been scheduled.`;
    const recruiterMessage = `Interview with ${interview.applicantEmail || "candidate"} scheduled successfully.`;

    const candidateNotification = {
      userId: interview.applicantId,
      type: "INTERVIEW_SCHEDULED",
      interviewId: interview._id.toString(),
      jobId: interview.jobId?.toString?.() || null,
      jobTitle: interview.jobTitle,
      company: interview.company,
      message: candidateMessage,
      interviewDetails: {
        interviewTitle: interview.interviewTitle,
        date: interview.date,
        time: interview.time,
        timezone: interview.timezone,
        durationMinutes: interview.durationMinutes,
        meetingLink: interview.meetingLink,
        meetingRoomName: interview.meetingRoomName,
        notes: interview.notes,
        candidateInstructions: interview.candidateInstructions,
      },
      read: false,
      createdAt: new Date(),
    };

    const recruiterNotification = {
      userId: recruiterUid,
      type: "INTERVIEW_CREATED",
      interviewId: interview._id.toString(),
      jobId: interview.jobId?.toString?.() || null,
      jobTitle: interview.jobTitle,
      company: interview.company,
      message: recruiterMessage,
      interviewDetails: {
        interviewTitle: interview.interviewTitle,
        date: interview.date,
        time: interview.time,
        timezone: interview.timezone,
        durationMinutes: interview.durationMinutes,
        meetingLink: interview.meetingLink,
        meetingRoomName: interview.meetingRoomName,
        notes: interview.notes,
        recruiterInstructions: interview.recruiterInstructions,
      },
      read: false,
      createdAt: new Date(),
    };

    res.status(201).json({
      success: true,
      message: "Interview scheduled successfully",
      data: {
        interviewId: interview._id.toString(),
        ...interview,
      },
    });

    // Notifications (best-effort, non-blocking)
    setImmediate(async () => {
      await Promise.allSettled([
        sendInterviewNotification({ db, userId: interview.applicantId, notification: candidateNotification }),
        sendInterviewNotification({ db, userId: recruiterUid, notification: recruiterNotification }),
      ]);
    });
  } catch (error) {
    console.error("Interview Scheduling Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while scheduling interview",
    });
  }
};

export const getRecruiterInterviews = async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user?.uid || req.params?.uid;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Prevent accessing other recruiters' lists through legacy route params
    if (req.params?.uid && req.params.uid !== uid) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const interviews = await db
      .collection("interviews")
      .find({ recruiterId: uid })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      interviews,
      count: interviews.length,
    });
  } catch (error) {
    console.error("GET Recruiter Interviews Error:", error);
    res.status(500).json({ success: false, message: "Server error while fetching interviews" });
  }
};

export const updateInterviewStatus = async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status } = req.body;
    const uid = req.user?.uid;

    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid interview ID format" });
    }

    const validStatuses = ["scheduled", "completed", "cancelled", "missed", "rescheduled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const interview = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!interview) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }

    // Recruiter-only for status changes
    if (interview.recruiterId !== uid && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    // Sync status with application pipeline
    if (status === "completed" && interview.applicationId) {
      try {
        await db.collection("applications").updateOne(
          { _id: new ObjectId(interview.applicationId) },
          {
            $set: { status: "interview_completed", updatedAt: new Date() },
            $push: { timeline: { status: "interview_completed", timestamp: new Date() } }
          }
        );
      } catch (appErr) {
        console.error("Failed to sync application status:", appErr);
      }
    } else if (status === "cancelled" && interview.applicationId) {
      try {
        await db.collection("applications").updateOne(
          { _id: new ObjectId(interview.applicationId) },
          {
            $set: { status: "interview_selected", updatedAt: new Date() },
            $push: { timeline: { status: "interview_selected_from_cancel", timestamp: new Date() } }
          }
        );
      } catch (appErr) {
        console.error("Failed to revert application status:", appErr);
      }
    }

    res.status(200).json({ success: true, message: "Interview status updated successfully" });

    // Notification (best-effort, non-blocking)
    setImmediate(async () => {
      const notifType = status.toUpperCase();
      await sendInterviewNotification({
        db,
        userId: interview.applicantId,
        notification: {
          userId: interview.applicantId,
          type: `INTERVIEW_${notifType}`,
          interviewId: id,
          message: `Your interview for ${interview.jobTitle || "a job"} has been ${status}.`,
          read: false,
          createdAt: new Date(),
        },
      });
    });
  } catch (error) {
    console.error("UPDATE Interview Status Error:", error);
    res.status(500).json({ success: false, message: "Server error while updating interview status" });
  }
};

export const getCandidateInterviews = async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user?.uid || req.params?.uid;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Prevent accessing other candidates' lists through legacy route params
    if (req.params?.uid && req.params.uid !== uid) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const interviews = await db
      .collection("interviews")
      .find({ applicantId: uid })
      .sort({ scheduledDateTime: 1 })
      .toArray();

    res.status(200).json({
      success: true,
      interviews,
      count: interviews.length,
    });
  } catch (error) {
    console.error("GET Candidate Interviews Error:", error);
    res.status(500).json({ success: false, message: "Server error while fetching candidate interviews" });
  }
};

export const getInterviewById = async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const uid = req.user?.uid;
    const role = req.user?.role;

    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const interview = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!interview) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const canAccess =
      role === "admin" ||
      interview.recruiterId === uid ||
      interview.applicantId === uid;

    if (!canAccess) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    res.status(200).json({ success: true, interview });
  } catch (err) {
    console.error("GET Interview By ID Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateInterview = async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const updates = req.body;
    const uid = req.user?.uid;

    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    const existing = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ success: false, message: "Interview not found" });

    if (existing.recruiterId !== uid && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Only allow specific updates
    const allowedUpdates = [
      "date",
      "time",
      "duration",
      "durationMinutes",
      "notes",
      "timezone",
      "recruiterInstructions",
      "candidateInstructions",
      "interviewTitle",
    ];
    const actualUpdates = {};

    let needsRescheduleNotification = false;

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        actualUpdates[key] = typeof updates[key] === "string" ? sanitizeText(updates[key]) : updates[key];
        if (key === "date" || key === "time") {
          needsRescheduleNotification = true;
        }
      }
    }

    if (actualUpdates.durationMinutes !== undefined && actualUpdates.duration === undefined) {
      actualUpdates.duration = String(actualUpdates.durationMinutes);
    }
    if (actualUpdates.duration !== undefined && actualUpdates.durationMinutes === undefined) {
      const parsed = Number(actualUpdates.duration);
      if (Number.isFinite(parsed)) actualUpdates.durationMinutes = parsed;
    }

    if (actualUpdates.date || actualUpdates.time) {
      const newDate = actualUpdates.date || existing.date;
      const newTime = actualUpdates.time || existing.time;
      const nextScheduledAt = parseScheduledAt(newDate, newTime);
      if (!nextScheduledAt) {
        return res.status(400).json({ success: false, message: "Invalid date/time format" });
      }

      actualUpdates.scheduledDateTime = nextScheduledAt;
      actualUpdates.status = "scheduled";

      // For Jitsi, generate a NEW room on reschedule and keep history
      if ((existing.type || "video") === "video") {
        const jobId = existing.jobId?.toString?.() ?? null;
        const applicationId = existing.applicationId?.toString?.() ?? null;
        const nextRoomName = generateJitsiRoom(jobId, applicationId || existing.applicantId);
        const nextMeetingLink = `https://meet.jit.si/${nextRoomName}`;
        actualUpdates.meetingRoomName = nextRoomName;
        actualUpdates.meetingUrl = nextMeetingLink;
        actualUpdates.meetingLink = nextMeetingLink;

        await db.collection("interviews").updateOne(
          { _id: new ObjectId(id) },
          {
            $push: {
              rescheduleHistory: {
                fromDate: existing.date,
                fromTime: existing.time,
                fromTimezone: existing.timezone,
                fromMeetingRoomName: existing.meetingRoomName,
                fromMeetingLink: existing.meetingLink || existing.meetingUrl,
                changedAt: new Date(),
                changedBy: uid,
              },
            },
          },
        );
      }
    }

    actualUpdates.updatedAt = new Date();

    const result = await db.collection("interviews").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: actualUpdates },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }

    if (needsRescheduleNotification) {
      const interview = result.value;
      const message = `Your interview has been rescheduled to ${interview.date} at ${interview.time}.`;

      // Notifications (best-effort, non-blocking)
      setImmediate(async () => {
        await Promise.allSettled([
          sendInterviewNotification({
            db,
            userId: interview.applicantId,
            notification: {
              userId: interview.applicantId,
              type: "INTERVIEW_RESCHEDULED",
              interviewId: id,
              message,
              interviewDetails: {
                date: interview.date,
                time: interview.time,
                timezone: interview.timezone,
                meetingLink: interview.meetingLink || interview.meetingUrl,
              },
              read: false,
              createdAt: new Date(),
            },
          }),
          sendInterviewNotification({
            db,
            userId: interview.recruiterId,
            notification: {
              userId: interview.recruiterId,
              type: "INTERVIEW_RESCHEDULED",
              interviewId: id,
              message: `Interview rescheduled to ${interview.date} at ${interview.time}.`,
              read: false,
              createdAt: new Date(),
            },
          }),
        ]);
      });
    }

    res.status(200).json({ success: true, message: "Interview updated", data: result.value });
  } catch (err) {
    console.error("UPDATE Interview Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const cancelInterview = async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;
    const reason = sanitizeText(req.body?.reason || req.body?.cancelReason || "", 500);
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID format" });
    if (!reason) return res.status(400).json({ success: false, message: "Cancel reason is required" });

    const interview = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    if (interview.recruiterId !== uid && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled", cancelReason: reason, updatedAt: new Date() } },
    );

    if (interview.applicationId) {
      try {
        await db.collection("applications").updateOne(
          { _id: new ObjectId(interview.applicationId) },
          {
            $set: { status: "interview_selected", updatedAt: new Date() },
            $push: { timeline: { status: "interview_selected", timestamp: new Date() } },
          },
        );
      } catch (err) {
        console.error("Failed to revert application status on cancel:", err);
      }
    }

    res.status(200).json({ success: true, message: "Interview cancelled" });

    // Notifications (best-effort, non-blocking)
    setImmediate(async () => {
      await Promise.allSettled([
        sendInterviewNotification({
          db,
          userId: interview.applicantId,
          notification: {
            userId: interview.applicantId,
            type: "INTERVIEW_CANCELLED",
            interviewId: id,
            message: `Your interview for ${interview.jobTitle || "a job"} has been cancelled.`,
            interviewDetails: { reason },
            read: false,
            createdAt: new Date(),
          },
        }),
        sendInterviewNotification({
          db,
          userId: interview.recruiterId,
          notification: {
            userId: interview.recruiterId,
            type: "INTERVIEW_CANCELLED",
            interviewId: id,
            message: `Interview cancelled.`,
            interviewDetails: { reason },
            read: false,
            createdAt: new Date(),
          },
        }),
      ]);
    });
  } catch (err) {
    console.error("CANCEL Interview Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const completeInterview = async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID format" });

    const interview = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    if (interview.recruiterId !== uid && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "completed", endedAt: new Date(), updatedAt: new Date() } },
    );

    if (interview.applicationId) {
      try {
        await db.collection("applications").updateOne(
          { _id: new ObjectId(interview.applicationId) },
          {
            $set: { status: "interview_completed", updatedAt: new Date() },
            $push: { timeline: { status: "interview_completed", timestamp: new Date() } },
          },
        );
      } catch (err) {
        console.error("Failed to sync application status on complete:", err);
      }
    }

    res.status(200).json({ success: true, message: "Interview completed" });

    // Notification (best-effort, non-blocking)
    setImmediate(async () => {
      await sendInterviewNotification({
        db,
        userId: interview.applicantId,
        notification: {
          userId: interview.applicantId,
          type: "INTERVIEW_COMPLETED",
          interviewId: id,
          message: `Your interview for ${interview.jobTitle || "a job"} has been marked completed.`,
          read: false,
          createdAt: new Date(),
        },
      });
    });
  } catch (err) {
    console.error("COMPLETE Interview Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const startInterview = async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID format" });

    const interview = await db.collection("interviews").findOne({ _id: new ObjectId(id) });
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    if (interview.recruiterId !== uid && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "live", startedAt: interview.startedAt || new Date(), updatedAt: new Date() } },
    );

    res.status(200).json({ success: true, message: "Interview started" });
  } catch (err) {
    console.error("START Interview Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
