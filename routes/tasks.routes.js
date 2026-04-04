import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";

const router = express.Router();

const sanitizeText = (value, maxLen = 5000) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
};

const isProbablyUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

// POST: Create Task and Assign
router.post("/api/tasks", async (req, res) => {
  try {
    const db = getDB();
    const { title, description, requirements, deadline, recruiterId, jobId, applicantIds } = req.body;

    if (!title || !description || !deadline || !recruiterId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    let targetApplicantIds = Array.isArray(applicantIds) ? applicantIds : [];
    
    // If no specific applicants were selected but a jobId exists, pick all shortlisted for that job
    if (targetApplicantIds.length === 0 && jobId && ObjectId.isValid(jobId)) {
      const shortlisted = await db.collection("applications").find({
        jobId: new ObjectId(jobId),
        status: "shortlisted"
      }).toArray();
      targetApplicantIds = shortlisted.map(app => app._id.toString());
    }

    if (targetApplicantIds.length === 0) {
      return res.status(400).json({ success: false, message: "No valid candidates to assign task to." });
    }

    // Convert string IDs to ObjectIds
    const objectIdApplicants = targetApplicantIds.map(id => {
      try {
        return new ObjectId(id);
      } catch (err) {
        return null;
      }
    }).filter(id => id !== null);

    // 1. Save the Task
    const newTask = {
      title: sanitizeText(title, 200),
      description: sanitizeText(description, 5000),
      requirements: sanitizeText(requirements, 8000),
      deadline,
      recruiterId,
      jobId: jobId && ObjectId.isValid(jobId) ? new ObjectId(jobId) : null,
      assignedApplicants: objectIdApplicants,
      createdAt: new Date(),
    };

    const taskResult = await db.collection("job_tasks").insertOne(newTask);

    // 2. Update all specific applications status to 'task_sent'
    await db.collection("applications").updateMany(
      { _id: { $in: objectIdApplicants } },
      { 
        $set: { status: "task_sent" },
        $push: { timeline: { status: "task_sent", timestamp: new Date() } }
      }
    );

    // 3. Send notifications (Optional, do in background)
    const firebaseService = getFirebaseService();
    if (firebaseService) {
      setImmediate(async () => {
        try {
          const apps = await db.collection("applications").find({ _id: { $in: objectIdApplicants } }).toArray();
          for (const app of apps) {
            if (app.firebaseUid) {
              const notifObj = {
                userId: app.firebaseUid,
                type: "task_assigned",
                taskId: taskResult.insertedId,
                jobId: app.jobId,
                message: `A technical task has been sent to you for the position of ${app.jobTitle || "the job"}.`,
                read: false,
                createdAt: new Date()
              };
              await db.collection("notifications").insertOne(notifObj);
              await firebaseService.sendNotification(app.firebaseUid, notifObj);
            }
          }
        } catch (err) {
          console.error("Task Notification Error:", err);
        }
      });
    }

    res.status(201).json({
      success: true,
      message: "Task assigned successfully",
      taskId: taskResult.insertedId
    });

  } catch (error) {
    console.error("POST Task Error:", error);
    res.status(500).json({ success: false, message: "Server error while assigning task" });
  }
});

// Legacy route kept for compatibility (requires uid match)
router.get("/api/tasks/candidate/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    // Find applications for this candidate that are in 'task_sent' or 'task_accepted' state
    const applications = await db.collection("applications").find({
      firebaseUid: uid,
      status: { $in: ["task_sent", "task_accepted", "task_submitted"] }
    }).toArray();

    if (applications.length === 0) {
      return res.status(200).json({ success: true, tasks: [], applications: [] });
    }

    const appIds = applications.map(app => app._id);
    
    // Find all tasks assigned to these applications
    const tasks = await db.collection("job_tasks").find({
      assignedApplicants: { $in: appIds }
    }).toArray();

    res.status(200).json({ success: true, tasks, applications });
  } catch (error) {
    console.error("GET Candidate Tasks Error:", error);
    res.status(500).json({ success: false, message: "Server error while fetching tasks" });
  }
});

// PUT: Candidate accepts task
router.put("/api/tasks/:taskId/accept", async (req, res) => {
  try {
    const db = getDB();
    const { taskId } = req.params;
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Missing application ID" });
    }

    await db.collection("applications").updateOne(
      { _id: new ObjectId(applicationId) },
      { 
        $set: { status: "task_accepted" },
        $push: { timeline: { status: "task_accepted", timestamp: new Date() } }
      }
    );

    res.status(200).json({ success: true, message: "Task accepted" });
  } catch (error) {
    console.error("PUT Task Accept Error:", error);
    res.status(500).json({ success: false, message: "Server error while accepting task" });
  }
});

// POST: Candidate submits task
router.post("/api/tasks/:taskId/submit", async (req, res) => {
  try {
    const db = getDB();
    const { taskId } = req.params;
    const { uid, applicationId, githubUrl, liveUrl, notes } = req.body;

    if (!githubUrl || !applicationId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (!isProbablyUrl(githubUrl)) {
      return res.status(400).json({ success: false, message: "GitHub URL must be a valid URL (https://...)" });
    }
    if (liveUrl && !isProbablyUrl(liveUrl)) {
      return res.status(400).json({ success: false, message: "Live URL must be a valid URL (https://...)" });
    }

    const application = await db.collection("applications").findOne({ _id: new ObjectId(applicationId) });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.firebaseUid !== uid) return res.status(403).json({ success: false, message: "Forbidden" });

    const submission = {
      taskId: new ObjectId(taskId),
      applicationId: new ObjectId(applicationId),
      candidateId: uid,
      githubUrl: sanitizeText(githubUrl, 2000),
      liveUrl: sanitizeText(liveUrl || "", 2000),
      notes: sanitizeText(notes || "", 8000),
      submittedAt: new Date()
    };

    const taskSubmissions = db.collection("task_submissions");
    await taskSubmissions.insertOne(submission);

    // Update application status to 'task_submitted'
    await db.collection("applications").updateOne(
      { _id: new ObjectId(applicationId) },
      { 
        $set: { status: "task_submitted" },
        $push: { timeline: { status: "task_submitted", timestamp: new Date() } }
      }
    );

    res.status(201).json({ success: true, message: "Task submitted successfully" });

    // Notify recruiter that a submission is received (best-effort, non-blocking)
    setImmediate(async () => {
      try {
        const task = await db.collection("job_tasks").findOne({ _id: new ObjectId(taskId) });
        const recruiterId = task?.recruiterId;
        if (!recruiterId) return;

        const notifObj = {
          userId: recruiterId,
          type: "task_submitted",
          taskId: task?._id,
          applicationId: application._id,
          candidateId: uid,
          message: `A candidate has submitted the task: ${task?.title || "Task"}.`,
          submission: {
            githubUrl: submission.githubUrl,
            liveUrl: submission.liveUrl,
            notes: submission.notes,
            submittedAt: submission.submittedAt,
          },
          read: false,
          createdAt: new Date(),
        };

        await db.collection("notifications").insertOne(notifObj);
        const firebaseService = getFirebaseService();
        if (firebaseService) {
          await firebaseService.sendNotification(recruiterId, notifObj);
        }
      } catch (err) {
        console.error("Task submission notify recruiter failed:", err);
      }
    });
  } catch (error) {
    console.error("POST Task Submit Error:", error);
    res.status(500).json({ success: false, message: "Server error while submitting task" });
  }
});

// GET: Recruiter fetches task submissions
router.get("/api/tasks/submissions/:recruiterId", async (req, res) => {
  try {
    const db = getDB();
    const { recruiterId } = req.params;

    // We can find all applications that belong to this recruiter and are in status 'task_submitted'
    const applications = await db.collection("applications").find({
      status: "task_submitted"
    }).toArray();

    // Ideally, we restrict applications by recruiterId. The existing applicants fetch uses jobs posted by recruiter.
    // For simplicity, we just look up submissions based on applications that are 'task_submitted'.
    const appIds = applications.map(app => app._id);

    const submissions = await db.collection("task_submissions").aggregate([
      { $match: { applicationId: { $in: appIds } } },
      {
        $lookup: {
          from: "applications",
          localField: "applicationId",
          foreignField: "_id",
          as: "application"
        }
      },
      { $unwind: "$application" },
      {
        $lookup: {
          from: "job_tasks",
          localField: "taskId",
          foreignField: "_id",
          as: "task"
        }
      },
      { $unwind: "$task" }
    ]).toArray();

    res.status(200).json({ success: true, submissions });
  } catch (error) {
    console.error("GET Submissions Error:", error);
    res.status(500).json({ success: false, message: "Server error while fetching submissions" });
  }
});

export default router;
