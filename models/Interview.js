// models/Interview.js
// Schema reference for interviews collection

/**
 * Document structure for interviews collection
 *
 * {
 *   _id: ObjectId,
 *   jobId: ObjectId,                 // Link to job
 *   applicationId: ObjectId,         // Link to application
 *   applicantId: string,             // firebaseUid of candidate
 *   recruiterId: string,             // firebaseUid of recruiter or static "recruiter"
 *   company: string,                 // Company name
 *   applicantEmail: string,          // Candidate email
 *   applicantName: string,           // Candidate name
 *   jobTitle: string,                // Job title
 *   type: string,                    // "video", "phone", "in-person"
 *   meetingUrl: string,              // For video/jitsi
 *   meetingId: string,               // Custom Meeting ID (optional)
 *   location: string,                // For in-person or phone number
 *   scheduledDateTime: Date,         // The core scheduled time
 *   date: string,                    // YYYY-MM-DD
 *   time: string,                    // HH:MM
 *   duration: string,                // e.g "30", "60"
 *   notes: string,                   // Additional notes
 *   reminderTime: string,            // Minutes before
 *   status: string,                  // "scheduled", "completed", "cancelled", "missed"
 *   scheduledBy: string,             // "recruiter"
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */

const COLLECTION = "interviews";

export { COLLECTION };
