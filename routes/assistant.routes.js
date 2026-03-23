// routes/assistant.routes.js
// AI Assistant with Gemini integration and data access

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System prompt for the assistant
const SYSTEM_PROMPT = `You are SkillMatch AI, a helpful assistant for a job matching platform called SkillMatch. 
You help candidates and recruiters with their questions about jobs, applications, interviews, and platform navigation.

You have access to user data including:
- Job applications and their status
- Saved jobs
- Interview schedules
- Profile information
- Available jobs

Always be helpful, professional, and concise. If you don't have specific data, acknowledge it and provide general guidance.

When answering:
1. Be conversational and friendly
2. Provide specific information when available
3. Guide users to relevant platform features
4. Answer general questions about the platform

Current date: ${new Date().toISOString().split("T")[0]}`;

// POST: AI Assistant endpoint
// =======================================
router.post("/api/assistant", async (req, res) => {
  try {
    const db = getDB();
    const { prompt, userId, userEmail, userRole } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: "Prompt is required",
      });
    }

    // Fetch user context data
    let contextData = {};

    if (userId && userEmail) {
      // Fetch applications
      const applications = await db
        .collection("applications")
        .find({ applicantEmail: userEmail })
        .sort({ createdAt: -1 })
        .toArray();

      // Fetch saved jobs
      const savedJobs = await db
        .collection("saved_jobs")
        .find({ userId })
        .toArray();

      // Fetch interviews for candidates
      let interviews = [];
      if (userRole === "candidate") {
        interviews = await db
          .collection("interviews")
          .find({ applicantEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();
      } else if (userRole === "recruiter") {
        interviews = await db
          .collection("interviews")
          .find({ recruiterId: userId })
          .sort({ createdAt: -1 })
          .toArray();
      }

      // Fetch user profile
      const profile = await db.collection("profiles").findOne({ uid: userId });

      // Get available jobs (last 10)
      const availableJobs = await db
        .collection("find_jobs")
        .find({ status: "active" })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      contextData = {
        applications: applications.map((a) => ({
          jobTitle: a.jobTitle,
          company: a.company,
          status: a.status,
          appliedAt: a.createdAt,
        })),
        savedJobsCount: savedJobs.length,
        interviews: interviews.map((i) => ({
          jobTitle: i.jobTitle,
          date: i.date,
          time: i.time,
          status: i.status,
        })),
        profile: profile
          ? {
              name: profile.name,
              skills: profile.skills,
              experience: profile.experience,
            }
          : null,
        availableJobs: availableJobs.map((j) => ({
          title: j.title,
          company: j.company,
          location: j.location,
        })),
      };
    }

    // Prepare the conversation context
    const contextString = JSON.stringify(contextData, null, 2);
    const fullPrompt = `${SYSTEM_PROMPT}\n\nUser Context:\n${contextString}\n\nUser Question: ${prompt}\n\nProvide a helpful, conversational response:`;

    // Call Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const assistantReply =
      response.text() ||
      "I'm here to help! What would you like to know about your job search or the platform?";

    res.status(200).json({
      success: true,
      assistant: assistantReply,
    });
  } catch (error) {
    console.error("Assistant Error:", error);

    // Return a generic but helpful response instead of error
    res.status(200).json({
      success: true,
      assistant:
        "I'm here to help you with SkillMatch! I can answer questions about jobs, your applications, interviews, or help you navigate the platform. What would you like to know?",
    });
  }
});

export default router;
