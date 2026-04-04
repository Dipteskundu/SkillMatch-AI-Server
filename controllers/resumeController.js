// controllers/resumeController.js

import { getDB } from "../config/db.js";
import { extractTextFromResume } from "../services/resumeParserService.js";
import { extractSkillsFromResume } from "../services/aiSkillExtractionService.js";

function extractFallbackFromText(text) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const knownTech = [
    "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "MongoDB",
    "PostgreSQL", "MySQL", "Firebase", "Python", "Java", "C++", "C", "Tailwind CSS",
    "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Redux", "HTML", "CSS",
  ];
  const technologies = knownTech.filter((t) => lower.includes(t.toLowerCase()));

  return {
    skills: technologies,
    experience_years: 0,
    technologies,
    role_titles: [],
  };
}

/**
 * Handle resume upload, parsing, AI extraction, and DB updates.
 */
async function uploadResume(req, res) {
  try {
    const { candidateId } = req.body;
    const file = req.file;

    if (!candidateId) {
      return res.status(400).json({ success: false, message: "candidateId is required" });
    }
    if (!file) {
      return res.status(400).json({ success: false, message: "Resume file is required" });
    }

    // 1. Extract raw text from the file
    const extractedText = await extractTextFromResume(file);

    // 2. Perform AI skill extraction (fallback safely if AI is unavailable)
    let extractedData;
    let warning = "";
    try {
      extractedData = await extractSkillsFromResume(extractedText);
    } catch (aiError) {
      console.error("AI extraction failed, using fallback extraction:", aiError);
      extractedData = extractFallbackFromText(extractedText);
      warning = "AI extraction was unavailable, so basic keyword extraction was used.";
    }

    const db = getDB();
    const resumesCollection = db.collection("resumes");
    const usersCollection = db.collection("users");

    // 3. Save Resume record
    const resumeDoc = {
      candidateId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extractedText,
      extractedSkills: extractedData.skills || [],
      extractedExperience: extractedData.experience_years || 0,
      extractedTechnologies: extractedData.technologies || [],
      extractedRoles: extractedData.role_titles || [],
      createdAt: new Date(),
    };

    await resumesCollection.insertOne(resumeDoc);

    // 4. Update Candidate Profile
    // We add new skills, avoiding duplicates
    const candidate = await usersCollection.findOne({ firebaseUid: candidateId });
    
    let existingSkills = [];
    if (candidate && candidate.skills) {
      existingSkills = candidate.skills;
    }

    // Merge skills and deduplicate
    const combinedSkills = Array.from(new Set([
      ...existingSkills,
      ...extractedData.skills,
      ...extractedData.technologies
    ]));

    await usersCollection.updateOne(
      { firebaseUid: candidateId },
      {
        $set: {
          resumeUploaded: true,
          skills: combinedSkills,
          yearsOfExperience: extractedData.experience_years,
          updatedAt: new Date()
        }
      }
    );

    res.status(200).json({
      success: true,
      message: "Resume processed successfully",
      warning: warning || undefined,
      data: {
        skills: extractedData.skills,
        technologies: extractedData.technologies,
        experience_years: extractedData.experience_years,
        role_titles: extractedData.role_titles
      }
    });

  } catch (error) {
    console.error("Upload Resume Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error during resume processing"
    });
  }
}

export { uploadResume };
