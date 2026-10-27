// routes/compliance.routes.js — Compliance Center data APIs (Phase 5).
// ---------------------------------------------------------------------------
//   GET /api/compliance/disclosure        (public)  AI/score disclosure facts
//   GET /api/compliance/me/score-export   (auth)     full JSON export of own data
//   GET /api/compliance/me/audit-log      (auth)     own audit entries
//   GET /api/compliance/admin/bias-metrics (admin)   REAL aggregate metrics only
//
// Bias metrics are computed from actual documents. We deliberately do NOT
// report demographic/gender/ethnicity statistics: the platform does not
// collect protected attributes, so any such numbers would be fabricated —
// the `note` field states this honestly.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";
import { getDB } from "../config/db.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { Certificate, UserProgress } from "../models/index.js";
import { ownAuditEntries, auditLog } from "../services/auditLog.js";

const router = Router();

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── GET /disclosure — public, factual (no dynamic claims) ────────────────────

router.get("/api/compliance/disclosure", (req, res) => {
  res.json({
    success: true,
    data: {
      scoreModelVersion: "fit-v1",
      weights: {
        skillMatch: 45,
        assessment: 25,
        experience: 15,
        education: 10,
        additional: 5,
      },
      howItWorks:
        "The Hiring Fit Score is a deterministic weighted blend of skill match, assessment results, experience, education and additional factors. Every score ships with an evidence list quoting the source of each factor, and candidates can see their own breakdown in the Fit Map.",
      dataUsed: [
        "Resume and profile skills",
        "Micro-assessment results",
        "Stated experience and education",
        "Learning Hub completions (verified skills)",
      ],
      demographics:
        "No protected or demographic attributes (gender, ethnicity, age) are collected or used in scoring. Demographic bias audits would require separate, opt-in data collection.",
      humanInTheLoop:
        "The score is a recommendation aid — recruiters make all hiring decisions; the platform never auto-rejects candidates.",
      contactPath: "/contact",
    },
  });
});

// ── GET /me/score-export — auth, own data only ───────────────────────────────

router.get("/api/compliance/me/score-export", verifyToken, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.uid;

    const [user, applications, certificates, progress] = await Promise.all([
      db.collection("users").findOne({ firebaseUid: uid }, {
        projection: { email: 1, role: 1, displayName: 1, plan: 1, skills: 1, createdAt: 1 },
      }),
      db.collection("applications").find({ candidateId: uid }).toArray().catch(() => []),
      Certificate.find({ userId: uid }).lean().catch(() => []),
      UserProgress.findOne({ userId: uid }).lean().catch(() => null),
    ]);

    // Enrich applications with job titles (best-effort).
    let jobsById = {};
    try {
      const jobIds = [...new Set((applications || []).map((a) => String(a.jobId)).filter(Boolean))];
      if (jobIds.length) {
        const { ObjectId } = await import("mongodb");
        const valid = jobIds.filter((id) => /^[a-f\d]{24}$/i.test(id));
        if (valid.length) {
          const jobs = await db
            .collection("find_jobs")
            .find({ _id: { $in: valid.map((id) => new ObjectId(id)) } })
            .project({ title: 1, company: 1 })
            .toArray();
          jobsById = Object.fromEntries(jobs.map((j) => [String(j._id), j]));
        }
      }
    } catch {
      jobsById = {};
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      user: {
        email: user?.email || req.user.email || "",
        role: user?.role || "candidate",
        plan: user?.plan || "free",
        displayName: user?.displayName || "",
        createdAt: user?.createdAt || null,
      },
      skills: user?.skills || [],
      applications: (applications || []).map((a) => ({
        jobId: String(a.jobId || ""),
        jobTitle: jobsById[String(a.jobId)]?.title || a.jobTitle || "",
        company: jobsById[String(a.jobId)]?.company || a.company || "",
        status: a.status || "",
        appliedAt: a.appliedAt || a.createdAt || null,
        aiScore: a.aiScore
          ? {
              total: a.aiScore.total,
              breakdown: a.aiScore.breakdown,
              evidence: a.aiScore.evidence,
              computedAt: a.aiScore.computedAt,
              modelVersion: a.aiScore.modelVersion,
            }
          : null,
      })),
      certificates: (certificates || []).map((c) => ({
        skillSlug: c.skillSlug,
        skillName: c.skillName,
        verifiableCode: c.verifiableCode,
        score: c.score,
        issuedAt: c.issuedAt,
      })),
      learning: progress
        ? {
            xp: progress.xp || 0,
            streakDays: progress.streakDays || 0,
            badges: progress.badges || [],
            enrollments: (progress.enrollments || []).map((e) => ({
              pathId: String(e.pathId || ""),
              percent: e.percent || 0,
              completedAt: e.completedAt || null,
            })),
          }
        : null,
    };

    await auditLog({ userId: uid, action: "data_export", entity: "user", entityId: uid });

    res.json({ success: true, data: payload });
  } catch (err) {
    console.error("score export failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not build your data export." });
  }
});

// ── GET /me/audit-log — auth, own entries only ───────────────────────────────

router.get("/api/compliance/me/audit-log", verifyToken, validate(pageQuery, "query"), async (req, res) => {
  const result = await ownAuditEntries(req.user.uid, {
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result });
});

// ── GET /admin/bias-metrics — admin, REAL aggregates only ────────────────────

router.get("/api/compliance/admin/bias-metrics", verifyToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const apps = await db
      .collection("applications")
      .find({}, { projection: { aiScore: 1, status: 1, createdAt: 1 } })
      .limit(5000)
      .toArray();

    const bands = { "0-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
    let scored = 0;
    let withAssessment = 0;
    const sourceCounts = { resume: 0, assessment: 0, learning: 0, self: 0 };

    for (const a of apps) {
      const total = a.aiScore?.total;
      if (typeof total === "number") {
        scored += 1;
        if (total < 40) bands["0-40"] += 1;
        else if (total < 60) bands["40-60"] += 1;
        else if (total < 80) bands["60-80"] += 1;
        else bands["80-100"] += 1;
        if ((a.aiScore?.breakdown?.assessment ?? 0) > 0) withAssessment += 1;
      }
    }

    // Skill-provenance coverage across candidate profiles (real counts).
    try {
      const users = await db
        .collection("users")
        .find({ role: "candidate" }, { projection: { skills: 1 } })
        .limit(5000)
        .toArray();
      for (const u of users) {
        for (const s of u.skills || []) {
          const source = typeof s === "string" ? "self" : (s.source || "self");
          if (sourceCounts[source] !== undefined) sourceCounts[source] += 1;
        }
      }
    } catch {
      /* keep zeros */
    }

    const totalApps = apps.length;
    const bandsArr = Object.entries(bands).map(([band, count]) => ({
      band,
      count,
      pct: totalApps ? Math.round((count / totalApps) * 100) : 0,
    }));

    const jobsWithScores = scored;
    let jobsTotal = 0;
    try {
      jobsTotal = await db.collection("find_jobs").countDocuments({ status: "approved" });
    } catch {
      jobsTotal = 0;
    }

    res.json({
      success: true,
      data: {
        scoreBands: bandsArr,
        assessmentCoveragePct: scored ? Math.round((withAssessment / scored) * 100) : 0,
        coverageBySkillSource: sourceCounts,
        jobs: { withScores: jobsWithScores, total: jobsTotal },
        sampleSize: { applications: totalApps, scoredApplications: scored },
        note:
          "Aggregate metrics only — this platform does not collect demographic attributes (gender, ethnicity, age), so demographic bias statistics cannot be reported without a separate opt-in data collection program. Compute framework: score-band distribution + skill-provenance coverage over real documents.",
      },
    });
  } catch (err) {
    console.error("bias metrics failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not compute metrics." });
  }
});

export default router;
