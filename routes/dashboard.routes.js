import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { validate } from "../middleware/validate.js";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";
import {
  adminUsersQuery,
  applicationStatusBody,
  escapeRegExp,
  objectIdParamSchema,
  userRoleEnum,
} from "../lib/schemas.js";

const router = express.Router();

// --- Candidate Dashboard ---
router.get("/api/dashboard/candidate/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    // 1. Fetch applications
    const applications = await db
      .collection("applications")
      .find({ firebaseUid: uid })
      .sort({ createdAt: -1 })
      .toArray();

    // 2. Fetch saved jobs
    const savedJobsCount = await db
      .collection("saved_jobs")
      .countDocuments({ firebaseUid: uid });

    // 3. User profile (for skills comparison and profile completion)
    const user = await db.collection("users").findOne({ firebaseUid: uid });
    const userSkills = user?.skills || [];

    // Calculate profile completion
    const profileCompletion = calculateProfileCompletion(user);

    // 4. Mock Skill Gap Detection (Logic can be improved later)
    // Find missing skills from the last 3 jobs applied
    let missingSkills = [];
    if (applications.length > 0) {
      const recentJobIds = applications.slice(0, 3).map((app) => app.jobId);
      const recentJobs = await db
        .collection("find_jobs")
        .find({ _id: { $in: recentJobIds } })
        .toArray();

      recentJobs.forEach((job) => {
        if (job.skills) {
          job.skills.forEach((skill) => {
            if (!userSkills.includes(skill) && !missingSkills.includes(skill)) {
              missingSkills.push(skill);
            }
          });
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        stats: {
          applied: applications.length,
          saved: savedJobsCount,
          shortlisted: applications.filter((a) => a.status === "shortlisted")
            .length,
          rejected: applications.filter((a) => a.status === "rejected").length,
          interviews: applications.filter((a) => a.status === "interviewing")
            .length,
          pendingTasks: applications.filter((a) => ["task_sent", "task_accepted"].includes(a.status)).length,
        },
        applications: applications.slice(0, 5), // Recent 5
        missingSkills: missingSkills.slice(0, 5),
        profileCompletion,
        profile: user, // Include full profile for checking missing fields
      },
    });
  } catch (error) {
    console.error("Candidate Dashboard Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Recruiter Dashboard ---
router.get("/api/dashboard/recruiter/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    // 1. Get recruiter info
    const user = await db.collection("users").findOne({ firebaseUid: uid });
    if (!user || (user.role !== "recruiter" && user.role !== "employer")) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // 2. Fetch jobs posted by this recruiter (using postedBy field or company fallback)
    const jobs = await db
      .collection("find_jobs")
      .find({
        $or: [
          { postedBy: uid },
          { company: user.companyName || user.displayName },
        ],
      })
      .toArray();

    const jobIds = jobs.map((j) => j._id);

    // 3. Fetch applications for these jobs
    const applications = await db
      .collection("applications")
      .find({ jobId: { $in: jobIds } })
      .toArray();

    // 4. Add applicant counts to jobs
    const jobsWithCounts = await Promise.all(
      jobs.map(async (job) => {
        const applicantCount = applications.filter((app) =>
          app.jobId.equals(job._id),
        ).length;
        return {
          ...job,
          applicantsCount: applicantCount,
        };
      }),
    );

    // 5. Calculate dynamic stats
    const stats = {
      activeJobs: jobs.length,
      totalApplicants: applications.length,
      shortlisted: applications.filter((a) => a.status === "shortlisted")
        .length,
      interviews: applications.filter((a) => a.status === "interviewing")
        .length,
    };

    // 6. Top Candidates ranked by the unified Hiring Fit Score (aiScore.total).
    //    Legacy applications without aiScore fall back to communicationScore.
    const aiTotal = (a) =>
      typeof a?.aiScore?.total === "number" ? a.aiScore.total : -1;
    const topCandidates = applications
      .sort(
        (a, b) =>
          aiTotal(b) - aiTotal(a) ||
          (b.communicationScore || 0) - (a.communicationScore || 0) ||
          b.createdAt - a.createdAt,
      )
      .slice(0, 10)
      .map((a) => ({
        ...a,
        aiScore: a.aiScore ?? null,
        communicationScore: a.communicationScore ?? null,
        communicationStatus: a.communicationStatus ?? "pending",
      }));

    res.status(200).json({
      success: true,
      data: {
        stats,
        jobs: jobsWithCounts.slice(0, 5), // Include applicant counts
        recentApplications: applications.slice(0, 5).map((a) => ({
          ...a,
          communicationScore: a.communicationScore ?? null,
          communicationStatus: a.communicationStatus ?? "pending",
        })),
        topCandidates,
      },
    });
  } catch (error) {
    console.error("Recruiter Dashboard Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Admin Dashboard ---
router.get("/api/dashboard/admin", verifyToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();

    const totalUsers = await db.collection("users").countDocuments();
    const totalJobs = await db.collection("find_jobs").countDocuments();
    const totalApplications = await db
      .collection("applications")
      .countDocuments();
    const totalCompanies = await db
      .collection("companies_info")
      .countDocuments();

    // Real monthly growth (last 6 months) computed from actual documents —
    // never fabricated numbers. Docs without createdAt are simply excluded.
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthKey = (d) => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    };
    const growthBuckets = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      growthBuckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        month: d.toLocaleString("en-US", { month: "short" }),
        users: 0,
        jobs: 0,
      });
    }
    try {
      const [newUsers, newJobs] = await Promise.all([
        db.collection("users").find({ createdAt: { $gte: since } }, { projection: { createdAt: 1 } }).toArray(),
        db.collection("find_jobs").find({ createdAt: { $gte: since } }, { projection: { createdAt: 1 } }).toArray(),
      ]);
      for (const u of newUsers) {
        const b = growthBuckets.find((m) => m.key === monthKey(u.createdAt));
        if (b) b.users += 1;
      }
      for (const j of newJobs) {
        const b = growthBuckets.find((m) => m.key === monthKey(j.createdAt));
        if (b) b.jobs += 1;
      }
    } catch {
      /* zeros are honest */
    }
    const growth = growthBuckets.map(({ month, users, jobs }) => ({ month, users, jobs }));

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalJobs,
          totalApplications,
          totalCompanies,
        },
        growth,
        recentUsers: await db
          .collection("users")
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray(),
        recentJobs: await db
          .collection("find_jobs")
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray(),
        pendingJobs: await db
          .collection("find_jobs")
          .find({ status: "pending" })
          .toArray(),
        deleteRequests: await db
          .collection("find_jobs")
          .find({ status: "delete_requested" })
          .toArray(),
      },
    });
  } catch (error) {
    console.error("Admin Dashboard Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Application Status Update ---
router.put(
  "/api/applications/:id/status",
  validate(objectIdParamSchema, "params"),
  validate(applicationStatusBody),
  async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid application ID" });
    }

    const updateDoc = {
      $set: { status, updatedAt: new Date() },
      $push: { timeline: { status, timestamp: new Date() } },
    };

    if (status === "rejected" && req.body.feedback) {
      updateDoc.$set.feedback = req.body.feedback;
    }

    const result = await db
      .collection("applications")
      .updateOne({ _id: new ObjectId(id) }, updateDoc);

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    // Optional: Create notification for candidate
    // const application = await db.collection("applications").findOne({ _id: new ObjectId(id) });
    // await db.collection("notifications").insertOne({
    //   userId: application.firebaseUid,
    //   message: `Your application status for ${application.jobTitle} has been updated to ${status}.`,
    //   type: "status_update",
    //   isRead: false,
    //   createdAt: new Date()
    // });

    res
      .status(200)
      .json({ success: true, message: "Status updated successfully" });
  } catch (error) {
    console.error("Status Update Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
  },
);

// --- Get Single Application ---
router.get("/api/applications/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid application ID" });
    }

    const application = await db
      .collection("applications")
      .findOne({ _id: new ObjectId(id) });
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    // Automatic "seen" status update if recruiter views it
    if (application.status === "submitted" && req.query.role === "recruiter") {
      const updateDoc = {
        $set: { status: "seen", updatedAt: new Date() },
        $push: { timeline: { status: "seen", timestamp: new Date() } },
      };

      await db
        .collection("applications")
        .updateOne({ _id: new ObjectId(id) }, updateDoc);

      application.status = "seen";
      // Backward-compat: older writes stored timeline as a single object
      // (the $set bug fixed in PUT /api/applications/:id/status). Coerce to
      // an array before pushing so reads never crash on legacy documents.
      if (!Array.isArray(application.timeline)) {
        application.timeline = application.timeline ? [application.timeline] : [];
      }
      application.timeline.push({ status: "seen", timestamp: new Date() });

      // Optional: send firestore notification to candidate...
    }

    res.status(200).json({ success: true, data: application });
  } catch (error) {
    console.error("Get Application Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Admin: All Users ---
router.get("/api/admin/users", verifyToken, requireAdmin, validate(adminUsersQuery, "query"), async (req, res) => {
  try {
    const db = getDB();
    const { search = "", role = "", page = 1, limit = 20 } = req.query;

    const query = {};
    if (role) query.role = role;
    if (search) {
      // Escape regex special characters to prevent regex injection / ReDoS.
      const safeSearch = escapeRegExp(search);
      query.$or = [
        { email: { $regex: safeSearch, $options: "i" } },
        { displayName: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      db.collection("users").find(query, {
        projection: { firebaseUid: 1, email: 1, displayName: 1, role: 1, photoURL: 1, createdAt: 1, isSkillVerified: 1, title: 1, location: 1 }
      }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      db.collection("users").countDocuments(query),
    ]);

    res.status(200).json({ success: true, users, total, page, limit });
  } catch (error) {
    console.error("Admin Users Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

// Helper function to calculate profile completion
function calculateProfileCompletion(user) {
  if (!user) return 0;

  const fields = [
    { key: "displayName", weight: 8 },
    { key: "photoURL", weight: 8 },
    { key: "title", weight: 8 },
    { key: "location", weight: 4 },
    { key: "phone", weight: 4 },
    { key: "bio", weight: 12 },
    { key: "skills", weight: 12, isArray: true },
    { key: "experience", weight: 12, isArray: true },
    { key: "education", weight: 8, isArray: true },
    { key: "projects", weight: 8, isArray: true },
    { key: "certificates", weight: 6, isArray: true },
    { key: "portfolioUrl", weight: 4 },
    { key: "linkedin", weight: 3 },
    { key: "github", weight: 3 },
  ];

  let totalScore = 0;
  let maxScore = 0;

  fields.forEach((field) => {
    maxScore += field.weight;
    const value = user[field.key];

    if (field.isArray) {
      if (Array.isArray(value) && value.length > 0) {
        totalScore += field.weight;
      }
    } else {
      if (value && value.toString().trim() !== "") {
        totalScore += field.weight;
      }
    }
  });

  return Math.round((totalScore / maxScore) * 100);
}
