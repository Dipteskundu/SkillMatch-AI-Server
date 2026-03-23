// routes/jobs.routes.js
// Handles job-related API routes

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { mockJobs } from "../data/mockData.js";
import { analyzeSkillGap } from "../services/skillGapService.js";
import { getFirebaseService } from "../services/firebaseService.js";
import { getRuntimeSavedJobs, saveRuntimeJob } from "../services/runtimeStore.js";

const router = express.Router();
const firebaseService = getFirebaseService();



// GET: Get All Jobs
// =======================================
router.get("/api/jobs", async (req, res) => {
  if (req.dbUnavailable) {
    return res.status(200).json({
      success: true,
      count: mockJobs.length,
      data: mockJobs,
      fallback: true,
      message: "Showing fallback jobs while the database is unavailable.",
    });
  }

  try {
    // 1️⃣ Get database
    const db = getDB();

    // 2️⃣ Fetch all jobs from the correct collection
    //    You said your collection is named "find_jobs"
    const jobs = await db
      .collection("find_jobs")
      .find({})
      .toArray();

    // 3️⃣ Send response
    res.status(200).json({
      success: true,
      count: jobs.length,
      data: jobs,
    });

  } catch (error) {
    console.error("GET Jobs Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while fetching jobs",
    });
  }
});



// POST: Create New Job
// =======================================
router.post("/api/jobs", async (req, res) => {
  try {
    const db = getDB();

    // 1️⃣ Extract fields from body
    const {
      title,
      company,
      location,
      salary,
      skills,
      salaryRange,
      experienceLevel,
      employmentType,
      posted,
    } = req.body;

    // 2️⃣ Basic validation
    if (!title || !company || !location) {
      return res.status(400).json({
        success: false,
        message: "Please provide title, company, and location",
      });
    }

    // 3️⃣ Create job object
    const newJob = {
      title,
      company,
      location,
      salary: salary || "",
      skills: skills || [],
      salaryRange: salaryRange || "",
      experienceLevel: experienceLevel || "",
      employmentType: employmentType || "",
      posted: posted || "",
      createdAt: new Date(),
    };

    // 4️⃣ Insert into database
    const result = await db
      .collection("find_jobs")
      .insertOne(newJob);

    // 5️⃣ Send response
    res.status(201).json({
      success: true,
      message: "Job created successfully",
      data: {
        _id: result.insertedId,
        ...newJob,
      },
    });

    // 6️⃣ Send real-time match notifications in background
    if (firebaseService) {
      setImmediate(async () => {
        try {
          const requiredSkills = (newJob.skills || []).map(s => s.toLowerCase().trim());
          if (requiredSkills.length > 0) {
            const users = await db.collection("users").find({ role: { $ne: "recruiter" } }).toArray();
            for (const candidate of users) {
              const candidateSkills = (candidate.skills || []).map(s => s.toLowerCase().trim());
              if (!candidateSkills.length) continue;

              const matching = requiredSkills.filter(s => candidateSkills.includes(s));
              const fitScore = (matching.length / requiredSkills.length) * 100;

              if (fitScore >= 70 && candidate.firebaseUid) {
                const notifObj = {
                  userId: candidate.firebaseUid,
                  type: "job_posted",
                  jobId: result.insertedId,
                  jobTitle: newJob.title,
                  company: newJob.company,
                  message: `New job match (${Math.round(fitScore)}% Fit): ${newJob.title} at ${newJob.company}`,
                  read: false,
                  createdAt: new Date()
                };
                await db.collection("notifications").insertOne(notifObj);
                await firebaseService.sendNotification(candidate.firebaseUid, notifObj);
              }
            }
          }
        } catch (err) { console.error("Job match notification error:", err); }
      });
    }

  } catch (error) {
    console.error("POST Job Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while creating job",
    });
  }
});



// GET: Get Single Job By ID
// =======================================
router.get("/api/jobs/:id", async (req, res) => {
  if (req.dbUnavailable) {
    const job = mockJobs.find((item) => item._id === req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
      fallback: true,
    });
  }

  try {
    const db = getDB();
    const { id } = req.params;

    // 1️⃣ Check if ID is valid
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID format",
      });
    }

    // 2️⃣ Find job
    const job = await db
      .collection("find_jobs")
      .findOne({ _id: new ObjectId(id) });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // 3️⃣ Send response
    res.status(200).json({
      success: true,
      data: job,
    });

  } catch (error) {
    console.error("GET Single Job Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while fetching job",
    });
  }
});



// DELETE: Delete Job By ID
// =======================================
router.delete("/api/jobs/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    // 1️⃣ Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID format",
      });
    }

    // 2️⃣ Delete job
    const result = await db
      .collection("find_jobs")
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // 3️⃣ Send response
    res.status(200).json({
      success: true,
      message: "Job deleted successfully",
    });

  } catch (error) {
    console.error("DELETE Job Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while deleting job",
    });
  }
});


// POST: Apply to a Job
// =======================================
router.post("/api/jobs/:id/apply", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { uid, email, jobTitle, company, location } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID format",
      });
    }

    const applications = db.collection("applications");

    const application = {
      jobId: new ObjectId(id),
      firebaseUid: uid,
      email,
      jobTitle: jobTitle || "",
      company: company || "",
      location: location || "",
      status: "submitted",
      aiScore: null,
      timeline: [{ status: "submitted", timestamp: new Date() }],
      feedback: null,
      createdAt: new Date(),
    };

    const result = await applications.insertOne(application);

    // --- Skill Gap Detection Start ---
    try {
      const jobDoc = await db.collection("find_jobs").findOne({ _id: new ObjectId(id) });
      const jobSkills = jobDoc?.skills || [];

      const candidate = await db.collection("users").findOne({ firebaseUid: uid });
      const candidateSkills = candidate?.skills || [];

      const skillGapResult = await analyzeSkillGap(candidateSkills, jobSkills);

      const skillGapDoc = {
        applicationId: result.insertedId,
        candidateId: uid,
        jobId: new ObjectId(id),
        matchedSkills: skillGapResult.matchedSkills,
        missingSkills: skillGapResult.missingSkills,
        matchScore: skillGapResult.matchScore,
        learningSuggestions: skillGapResult.learningSuggestions,
        createdAt: new Date()
      };

      await db.collection("skillGaps").insertOne(skillGapDoc);
    } catch (gapError) {
      console.error("Skill Gap Analysis Error:", gapError);
    }
    // --- Skill Gap Detection End ---

    res.status(201).json({
      success: true,
      message: "Application submitted",
      id: result.insertedId,
    });

    // Notify recruiter & Update applicant count real-time in background
    if (firebaseService) {
      setImmediate(async () => {
        try {
          // Get job document to find exact title and possibly the company
          const jobDoc = await db.collection("find_jobs").findOne({ _id: new ObjectId(id) });
          const actualTitle = jobTitle || jobDoc?.title || "a job";
          const actualCompany = company || jobDoc?.company || "";

          const numApplicants = await applications.countDocuments({ jobId: new ObjectId(id) });

          // 1. Update Realtime Firebase Applicant Count
          await firebaseService.updateApplicantCount(id, numApplicants);

          // 2. Find Recruiter and notify
          if (actualCompany) {
            // Try to match recruiter by company name or display name
            const recruiter = await db.collection("users").findOne({
              $or: [{ companyName: actualCompany }, { displayName: actualCompany }],
              role: "recruiter"
            });

            if (recruiter && recruiter.firebaseUid) {
              const notifObj = {
                userId: recruiter.firebaseUid,
                type: "job_applied",
                applicationId: result.insertedId,
                jobId: new ObjectId(id),
                jobTitle: actualTitle,
                message: `New Application: ${email} applied for ${actualTitle}.`,
                read: false,
                createdAt: new Date()
              };
              await db.collection("notifications").insertOne(notifObj);
              await firebaseService.sendNotification(recruiter.firebaseUid, notifObj);
            }
          }
        } catch (err) { console.error("Application notification error:", err); }
      });
    }

  } catch (error) {
    console.error("APPLY Job Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while submitting application",
    });
  }
});


// POST: Save Job
// =======================================
router.post("/api/jobs/:id/save", async (req, res) => {
  if (req.dbUnavailable) {
    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    saveRuntimeJob(uid, req.params.id);

    return res.status(200).json({
      success: true,
      message: "Job saved successfully",
      fallback: true,
    });
  }

  try {
    const db = getDB();
    const { id } = req.params;
    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID format",
      });
    }

    const savedJobs = db.collection("saved_jobs");

    await savedJobs.updateOne(
      {
        jobId: new ObjectId(id),
        firebaseUid: uid,
      },
      {
        $setOnInsert: {
          createdAt: new Date(),
        },
        $set: {
          email,
        },
      },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Job saved successfully",
    });
  } catch (error) {
    console.error("SAVE Job Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while saving job",
    });
  }
});


// GET: Get Saved Jobs for User
// =======================================
router.get("/api/jobs/saved/:uid", async (req, res) => {
  if (req.dbUnavailable) {
    const savedIds = getRuntimeSavedJobs(req.params.uid);
    const data = mockJobs.filter((job) => savedIds.includes(job._id));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
      fallback: true,
    });
  }

  try {
    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID is required",
      });
    }

    const savedJobsCollection = db.collection("saved_jobs");

    const savedJobs = await savedJobsCollection.aggregate([
      { $match: { firebaseUid: uid } },
      {
        $lookup: {
          from: "find_jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "jobDetails",
        },
      },
      { $unwind: "$jobDetails" },
      { $sort: { createdAt: -1 } }
    ]).toArray();

    res.status(200).json({
      success: true,
      count: savedJobs.length,
      data: savedJobs.map(sj => ({
        _id: sj._id,
        savedAt: sj.createdAt,
        ...sj.jobDetails
      })),
    });

  } catch (error) {
    console.error("GET Saved Jobs Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching saved jobs",
    });
  }
});


// DELETE: Unsave Job
// =======================================
router.delete("/api/jobs/saved/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid saved job ID",
      });
    }

    const result = await db.collection("saved_jobs").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Saved job not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Job unsaved successfully",
    });

  } catch (error) {
    console.error("DELETE Unsave Job Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while unsaving job",
    });
  }
});


export default router;
