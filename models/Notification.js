// models/Notification.js
// Mongoose schema for the existing "notifications" collection.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const notificationSchema = new Schema(
  {
    userId: { type: String, required: true }, // firebaseUid of the recipient
    type: { type: String, default: "" },
    // e.g. job_posted, job_applied, application_status, status_shortlisted,
    // task_assigned, task_submitted, application_viewed,
    // INTERVIEW_SCHEDULED / _CREATED / _RESCHEDULED / _CANCELLED / _COMPLETED, ...

    message: { type: String, default: "" },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },

    // Polymorphic references — types vary per event source (see type list above).
    jobId: { type: Schema.Types.Mixed, default: null }, // ObjectId or string or null
    jobTitle: { type: String, default: null },
    company: { type: String, default: null },
    applicationId: { type: Schema.Types.ObjectId, default: null },
    taskId: { type: Schema.Types.ObjectId, default: null },
    interviewId: { type: String, default: null }, // stored as string in interviews.controller
    candidateId: { type: String, default: null },

    // application_status events
    status: { type: String, default: null },
    feedback: { type: Schema.Types.Mixed, default: null },

    // task_submitted events carry the submission snippet
    submission: { type: Schema.Types.Mixed, default: null },
    // interview events carry the schedule snapshot
    interviewDetails: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: "notifications",
  },
);

// Required by spec: unread counts / read-all updates filter on { userId, read }.
notificationSchema.index({ userId: 1, read: 1 });
// Listing endpoint: find({ userId }).sort({ createdAt: -1 }).limit(50)
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification =
  models.Notification || model("Notification", notificationSchema);
