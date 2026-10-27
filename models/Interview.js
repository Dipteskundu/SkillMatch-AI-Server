// models/Interview.js
// Mongoose schema for the existing "interviews" collection.
// Fields verified against controllers/interviews.controller.js (insert +
// reschedule/cancel/complete/start updates).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const INTERVIEW_COLLECTION = "interviews";

// Valid statuses per interviews.controller (update route + active check).
export const INTERVIEW_STATUSES = [
  "scheduled",
  "live",
  "rescheduled",
  "completed",
  "cancelled",
  "missed",
];

const rescheduleEventSchema = new Schema(
  {
    fromDate: { type: String, default: "" },
    fromTime: { type: String, default: "" },
    fromTimezone: { type: String, default: "" },
    fromMeetingRoomName: { type: String, default: "" },
    fromMeetingLink: { type: String, default: "" },
    changedAt: { type: Date, default: null },
    changedBy: { type: String, default: "" },
  },
  { _id: false },
);

const interviewSchema = new Schema(
  {
    // Pipeline links
    jobId: { type: Schema.Types.ObjectId, default: null },
    applicationId: { type: Schema.Types.ObjectId, default: null, index: true },

    // Ownership
    recruiterId: { type: String, required: true, index: true }, // firebaseUid
    applicantId: { type: String, required: true, index: true }, // firebaseUid

    // Display fields
    company: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    applicantEmail: { type: String, default: "" },
    applicantName: { type: String, default: "" },
    interviewTitle: { type: String, default: "Interview" },

    // Scheduling
    type: { type: String, default: "video" }, // video | phone | in-person
    timezone: { type: String, default: "Asia/Dhaka" },
    durationMinutes: { type: Number, default: 30 },
    duration: { type: String, default: "30" },
    date: { type: String, default: "" }, // YYYY-MM-DD
    time: { type: String, default: "" }, // HH:MM
    scheduledDateTime: { type: Date, default: null },
    reminderTime: { type: String, default: null },

    // Notes/instructions
    notes: { type: String, default: "" },
    recruiterInstructions: { type: String, default: "" },
    candidateInstructions: { type: String, default: "" },

    // Meeting
    meetingProvider: { type: String, default: "jitsi" }, // jitsi | custom
    meetingUrl: { type: String, default: null },
    meetingLink: { type: String, default: null },
    meetingRoomName: { type: String, default: null },
    meetingId: { type: String, default: null },
    location: { type: String, default: "" }, // in-person address / phone number

    status: { type: String, enum: INTERVIEW_STATUSES, default: "scheduled" },
    scheduledBy: { type: String, default: null },

    // Lifecycle timestamps written by the controller
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    rescheduleHistory: { type: [rescheduleEventSchema], default: [] },
  },
  {
    timestamps: true,
    collection: INTERVIEW_COLLECTION,
  },
);

// Duplicate-prevention query: { applicationId, status: { $in: [...] } }
interviewSchema.index({ applicationId: 1, status: 1 });

export const Interview = models.Interview || model("Interview", interviewSchema);
