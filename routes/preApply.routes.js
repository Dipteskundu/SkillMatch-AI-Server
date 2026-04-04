import express from "express";
import { getDB } from "../config/db.js";

const router = express.Router();

/**
 * POST /api/jobs/:jobId/pre-apply-check
 * Checks if candidate has passed both Skill + Communication verifications.
 * Body: { uid: string }
 * Returns: { allowed: boolean, redirectTo?: string }
 */
router.post("/api/jobs/:jobId/pre-apply-check", async (req, res) => {
  try {
    const db = getDB();
    const { jobId } = req.params;
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ success: false, message: "uid is required" });
    }

    // Fetch candidate profile
    const candidate = await db.collection("users").findOne({ firebaseUid: uid });

    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    // Candidates must have at least one skill to be verified
    const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills : [];
    const verifiedSkills = Array.isArray(candidate.verifiedSkills) ? candidate.verifiedSkills : [];
    const hasDeclaredSkills = candidateSkills.length > 0;
    const derivedSkillVerified =
      hasDeclaredSkills &&
      candidateSkills.every((skill) => verifiedSkills.includes(skill)) &&
      verifiedSkills.length > 0;
    const effectiveSkillVerified = Boolean(candidate.isSkillVerified) || derivedSkillVerified;

    // --- Step 1: Skill Verification ---
    if (!hasDeclaredSkills || !effectiveSkillVerified) {
      return res.status(200).json({
        success: true,
        allowed: false,
        reason: "skill_not_verified",
        redirectTo: "/verification/skill-intro",
        message: "You must complete the Skill Verification test before applying.",
      });
    }

    // --- Step 2: Communication Verification ---
    if (!candidate.isCommunicationVerified) {
      return res.status(200).json({
        success: true,
        allowed: false,
        reason: "communication_not_verified",
        redirectTo: "/verification/communication-intro",
        message: "You must complete the Communication Verification test before applying.",
      });
    }

    // --- Both passed ---
    return res.status(200).json({
      success: true,
      allowed: true,
      message: "Candidate is verified. Proceed with application.",
    });

  } catch (error) {
    console.error("Pre-Apply Check Error:", error);
    res.status(500).json({ success: false, message: "Server error during verification check" });
  }
});


/**
 * GET /api/verification/status/:uid
 * Returns verification status of a candidate (skill + communication)
 */
router.get("/api/verification/status/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    const candidate = await db.collection("users").findOne({ firebaseUid: uid });

    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        isSkillVerified: candidate.isSkillVerified || false,
        isCommunicationVerified: candidate.isCommunicationVerified || false,
        verifiedSkills: candidate.verifiedSkills || [],
        nextAttemptTime: candidate.nextAttemptTime || null,
        nextCommunicationRetryAt: candidate.nextCommunicationRetryAt || null,
      },
    });
  } catch (error) {
    console.error("Verification Status Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
