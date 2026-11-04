// controllers/skillGapController.js

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { analyzeSkillGap } from "../services/skillGapService.js";

/**
 * Controller to handle skill gap analysis before applying to a job.
 */
const getSkillGapAnalysis = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;

    if (!jobId || !candidateId) {
      return res.status(400).json({
        success: false,
        message: "jobId and candidateId are required",
      });
    }

    if (!ObjectId.isValid(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID format",
      });
    }

    const db = getDB();

    // Fetch Job to get required skills
    const job = await db.collection("find_jobs").findOne({ _id: new ObjectId(jobId) });
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Fetch Candidate to get their skills
    const candidate = await db.collection("users").findOne({ firebaseUid: candidateId });
    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    const jobSkills = job.skills || [];
    const candidateSkills = candidate.skills || [];

    // Analyze gap using our existing service (which calls Gemini for learning suggestions)
    const result = await analyzeSkillGap(candidateSkills, jobSkills);

    res.status(200).json({
      success: true,
      data: {
        matchScore: result.matchScore,
        matchedSkills: result.matchedSkills,
        missingSkills: result.missingSkills,
        suggestions: result.learningSuggestions, // Returns the AI generated suggestions array
      },
    });

  } catch (error) {
    // error handled silently
    res.status(500).json({
      success: false,
      message: "Server error while analyzing skill gap",
    });
  }
};

export { getSkillGapAnalysis };
