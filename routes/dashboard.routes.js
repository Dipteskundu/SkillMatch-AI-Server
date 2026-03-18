import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

// --- Candidate Dashboard ---
router.get("/api/dashboard/candidate/:uid", requireAuth, requireRole("candidate", "admin"), async (req, res) => {
    try {
        const db = getDB();
        const { uid } = req.params;

        // 1. Fetch applications
        const applications = await db.collection("applications")
            .find({ firebaseUid: uid })
            .sort({ createdAt: -1 })
            .toArray();

        // 2. Fetch saved jobs
        const savedJobsCount = await db.collection("saved_jobs").countDocuments({ firebaseUid: uid });

        // 3. User profile (for skills comparison and profile completion)
        const user = await db.collection("users").findOne({ firebaseUid: uid });
        const userSkills = user?.skills || [];

        // Calculate profile completion
        const profileCompletion = calculateProfileCompletion(user);

        // 4. Mock Skill Gap Detection (Logic can be improved later)
        // Find missing skills from the last 3 jobs applied
        let missingSkills = [];
        if (applications.length > 0) {
            const recentJobIds = applications.slice(0, 3).map(app => app.jobId);
            const recentJobs = await db.collection("find_jobs")
                .find({ _id: { $in: recentJobIds } })
                .toArray();

            recentJobs.forEach(job => {
                if (job.skills) {
                    job.skills.forEach(skill => {
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
                    shortlisted: applications.filter(a => a.status === "shortlisted").length,
                    rejected: applications.filter(a => a.status === "rejected").length,
                    interviews: applications.filter(a => a.status === "interviewing").length,
                },
                applications: applications.slice(0, 5), // Recent 5
                missingSkills: missingSkills.slice(0, 5),
                profileCompletion,
                profile: user, // Include full profile for checking missing fields
            }
        });
    } catch (error) {
        console.error("Candidate Dashboard Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- Recruiter Dashboard ---
router.get("/api/dashboard/recruiter/:uid", requireAuth, requireRole("recruiter", "admin"), async (req, res) => {
    try {
        const db = getDB();
        const { uid } = req.params;

        // 1. Fetch jobs posted by this recruiter
        // Note: jobs collection might need a recruiterId field. 
        // For now, let's assume jobs posted by this email or a specific field.
        // If jobs don't have recruiterId, we might need to add it or use email as fallback.
        const user = await db.collection("users").findOne({ firebaseUid: uid });

        // Fetching jobs by company or email as a placeholder
        const jobs = await db.collection("find_jobs")
            .find({ company: user?.companyName || user?.displayName })
            .toArray();

        const jobIds = jobs.map(j => j._id);

        // 2. Fetch applications for these jobs
        const applications = await db.collection("applications")
            .find({ jobId: { $in: jobIds } })
            .toArray();

        // 3. Aggregate Stats
        const stats = {
            activeJobs: jobs.length,
            totalApplicants: applications.length,
            shortlisted: applications.filter(a => a.status === "shortlisted").length,
            interviews: applications.filter(a => a.status === "interviewing").length,
        };

        // 4. Top Candidates with Communication Scores
        const topCandidates = applications
            .sort((a, b) => (b.communicationScore || 0) - (a.communicationScore || 0) || b.createdAt - a.createdAt)
            .slice(0, 10)
            .map((a) => ({
                ...a,
                communicationScore: a.communicationScore ?? null,
                communicationStatus: a.communicationStatus ?? "pending",
            }));

        res.status(200).json({
            success: true,
            data: {
                stats,
                jobs: jobs.slice(0, 5),
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
router.get("/api/dashboard/admin", requireAuth, requireRole("admin"), async (req, res) => {
    try {
        const db = getDB();

        const totalUsers = await db.collection("users").countDocuments();
        const totalJobs = await db.collection("find_jobs").countDocuments();
        const totalApplications = await db.collection("applications").countDocuments();
        const totalCompanies = await db.collection("companies_info").countDocuments();

        // Mock growth data
        const growth = [
            { month: "Jan", users: 400, jobs: 240 },
            { month: "Feb", users: 600, jobs: 350 },
            { month: "Mar", users: 800, jobs: 480 },
        ];

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    totalUsers,
                    totalJobs,
                    totalApplications,
                    totalCompanies
                },
                growth,
                recentUsers: await db.collection("users").find().sort({ createdAt: -1 }).limit(5).toArray(),
                recentJobs: await db.collection("find_jobs").find().sort({ createdAt: -1 }).limit(5).toArray(),
            }
        });
    } catch (error) {
        console.error("Admin Dashboard Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- Application Status Update ---
router.put("/api/applications/:id/status", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid application ID" });
        }

        const updateDoc = {
            $set: { status, updatedAt: new Date() },
            $push: { timeline: { status, timestamp: new Date() } }
        };

        if (status === "rejected" && req.body.feedback) {
            updateDoc.$set.feedback = req.body.feedback;
        }

        const result = await db.collection("applications").updateOne(
            { _id: new ObjectId(id) },
            updateDoc
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: "Application not found" });
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

        res.status(200).json({ success: true, message: "Status updated successfully" });
    } catch (error) {
        console.error("Status Update Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- Get Single Application ---
router.get("/api/applications/:id", async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid application ID" });
        }

        const application = await db.collection("applications").findOne({ _id: new ObjectId(id) });
        if (!application) {
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        // Automatic "seen" status update if recruiter views it
        if (application.status === "submitted" && req.query.role === "recruiter") {
            const updateDoc = {
                $set: { status: "seen", updatedAt: new Date() },
                $push: { timeline: { status: "seen", timestamp: new Date() } }
            };

            await db.collection("applications").updateOne(
                { _id: new ObjectId(id) },
                updateDoc
            );

            application.status = "seen";
            application.timeline.push({ status: "seen", timestamp: new Date() });

            // Optional: send firestore notification to candidate...
        }

        res.status(200).json({ success: true, data: application });
    } catch (error) {
        console.error("Get Application Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

export default router;


// Helper function to calculate profile completion
function calculateProfileCompletion(user) {
    if (!user) return 0;

    const fields = [
        { key: 'displayName', weight: 8 },
        { key: 'photoURL', weight: 8 },
        { key: 'title', weight: 8 },
        { key: 'location', weight: 4 },
        { key: 'phone', weight: 4 },
        { key: 'bio', weight: 12 },
        { key: 'skills', weight: 12, isArray: true },
        { key: 'experience', weight: 12, isArray: true },
        { key: 'education', weight: 8, isArray: true },
        { key: 'projects', weight: 8, isArray: true },
        { key: 'certificates', weight: 6, isArray: true },
        { key: 'portfolioUrl', weight: 4 },
        { key: 'linkedin', weight: 3 },
        { key: 'github', weight: 3 },
    ];

    let totalScore = 0;
    let maxScore = 0;

    fields.forEach(field => {
        maxScore += field.weight;
        const value = user[field.key];

        if (field.isArray) {
            if (Array.isArray(value) && value.length > 0) {
                totalScore += field.weight;
            }
        } else {
            if (value && value.toString().trim() !== '') {
                totalScore += field.weight;
            }
        }
    });

    return Math.round((totalScore / maxScore) * 100);
}
