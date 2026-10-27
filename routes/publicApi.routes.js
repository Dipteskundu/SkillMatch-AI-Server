// routes/publicApi.routes.js — Public REST API v1 (API-key authenticated).
// ---------------------------------------------------------------------------
//   GET /api/public/v1/jobs      q, location, skills (csv), employmentType, page, limit
//   GET /api/public/v1/jobs/:id  full public detail (approved jobs only)
//   GET /api/public/v1/skills    canonical skills ranked by demand
//
// Envelope: { success, data }. Only `status: "approved"` jobs are exposed.
// Auth: Authorization: Bearer smk_... (or X-API-Key) via middleware/apiKeyAuth.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { authenticateApiKey } from "../middleware/apiKeyAuth.js";
import { validate } from "../middleware/validate.js";
import { jobsQuery, objectIdParam } from "../lib/publicApiSchemas.js";
import { Skill } from "../models/index.js";

const router = Router();

router.use(authenticateApiKey);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toListShape(job) {
  return {
    _id: String(job._id),
    title: job.title || "",
    company: { name: job.company || "" },
    location: job.location || "",
    employmentType: job.employmentType || "",
    salary: job.salary || job.salaryRange || "",
    skills: Array.isArray(job.skills) ? job.skills : [],
    requiredSkills: Array.isArray(job.skills) ? job.skills : [],
    postedAt: job.createdAt || job.postedAt || null,
  };
}

// GET /api/public/v1/jobs — filtered, paginated, approved only.
router.get("/jobs", validate(jobsQuery, "query"), async (req, res) => {
  try {
    const db = getDB();
    const { q, location, skills, employmentType, page, limit } = req.query;

    const query = { status: "approved" };
    if (q) {
      const re = new RegExp(escapeRegExp(q), "i");
      query.$or = [{ title: re }, { description: re }];
    }
    if (location) query.location = new RegExp(escapeRegExp(location), "i");
    if (employmentType) query.employmentType = employmentType;
    if (skills && skills.length) {
      // Case-insensitive exact match of every requested skill against the
      // job's live `skills` array (alias handling: see docs/PUBLIC_API.md).
      query.skills = { $in: skills.map((s) => new RegExp(`^${escapeRegExp(s)}$`, "i")) };
    }

    const [jobs, total] = await Promise.all([
      db
        .collection("find_jobs")
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      db.collection("find_jobs").countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        jobs: jobs.map(toListShape),
        page,
        total,
        hasMore: page * limit < total,
      },
    });
  } catch (err) {
    console.error("public jobs list failed:", err?.message || err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR" } });
  }
});

// GET /api/public/v1/jobs/:id — full public detail.
router.get("/jobs/:id", validate(objectIdParam, "params"), async (req, res) => {
  try {
    const db = getDB();
    const job = await db
      .collection("find_jobs")
      .findOne({ _id: new ObjectId(req.params.id), status: "approved" });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Job not found or not approved." },
      });
    }

    res.json({
      success: true,
      data: {
        job: {
          ...toListShape(job),
          description: job.description || "",
          responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
          niceToHaveSkills: Array.isArray(job.niceToHaveSkills) ? job.niceToHaveSkills : [],
          experienceMin: job.experienceMin ?? null,
          experienceMax: job.experienceMax ?? null,
          education: job.education || "",
          deadline: job.deadline || null,
          postedAt: job.createdAt || job.postedAt || null,
        },
      },
    });
  } catch (err) {
    console.error("public job detail failed:", err?.message || err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR" } });
  }
});

// GET /api/public/v1/skills — canonical skill vocabulary.
router.get("/skills", async (req, res) => {
  try {
    const skills = await Skill.find({})
      .sort({ demand: -1, name: 1 })
      .select("name slug category demand")
      .lean();
    res.json({
      success: true,
      data: { skills: (skills || []).map((s) => ({ ...s, _id: String(s._id) })) },
    });
  } catch (err) {
    console.error("public skills failed:", err?.message || err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR" } });
  }
});

export default router;
