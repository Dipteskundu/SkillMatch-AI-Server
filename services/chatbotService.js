import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDB } from "../config/db.js";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);
const systemKnowledge = _require("../config/systemKnowledge.json");

const apiKey = process.env.GEMINI_API_KEY?.trim();
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Normalizing input
function normalizeInput(input) {
  return String(input || "").trim().toLowerCase().replace(/[.,?!]/g, "");
}

// Intent Classification mapping (simple keyword based)
function classifyIntent(normalizedInput) {
  const input = normalizedInput;
  
  if (input.includes("apply") || input.includes("upload") || input.includes("save") || input.includes("create profile")) {
    return "platform_help";
  }
  if (input.includes("after signup") || input.includes("what should i do")) {
    return "candidate_workflow_help";
  }
  if (input.includes("post a job") || input.includes("review applicant") || input.includes("shortlist")) {
    return "recruiter_workflow_help";
  }
  if (input.includes("my recent application") || input.includes("how many job") || input.includes("my matched") || input.includes("my saved") || input.includes("my profile complete") || input.includes("my active job") || input.includes("applicant do i have") || input.includes("missing")) {
    return "user_data_summary";
  }
  if (input.includes("learning plan") || input.includes("skills should i improve") || input.includes("skill gap") || input.includes("courses")) {
    return "learning_guidance";
  }
  if (input.includes("why is this job recommended") || input.includes("match score")) {
    return "job_matching_explanation";
  }
  if (input.includes("where can i find") || input.includes("dashboard")) {
    return "dashboard_navigation_help";
  }
  if (input.includes("next") || input.includes("improve")) {
    return "safe_next_step_guidance";
  }
  
  // If no specific match, we default to platform help or general, let Gemini decide mostly
  return "general";
}

// Context Builders
async function getCandidateContext(uid) {
  const db = getDB();
  const user = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { displayName: 1, email: 1, skills: 1, title: 1 } });
  const applications = await db.collection("applications").countDocuments({ firebaseUid: uid });
  const savedJobs = await db.collection("saved_jobs").countDocuments({ firebaseUid: uid });
  return {
    role: "candidate",
    profile: user,
    applicationsCount: applications,
    savedJobsCount: savedJobs
  };
}

async function getRecruiterContext(uid) {
  const db = getDB();
  const user = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { displayName: 1, email: 1, companyName: 1 } });
  const companyJobs = await db.collection("find_jobs").find({ $or: [{ postedBy: uid }, { company: user?.companyName || user?.displayName }] }).toArray();
  
  let totalApplicants = 0;
  for (const job of companyJobs) {
    const apps = await db.collection("applications").countDocuments({ jobId: job._id });
    totalApplicants += apps;
  }
  
  return {
    role: "recruiter",
    profile: user,
    activeJobsCount: companyJobs.length,
    totalApplicants
  };
}

export async function askChatbot(uid, role, question) {
  if (!genAI) throw new Error("Gemini API not configured.");
  
  const normalized = normalizeInput(question);
  const intent = classifyIntent(normalized);
  
  let userContext = {};
  try {
    if (role === "recruiter" || role === "employer") {
      userContext = await getRecruiterContext(uid);
    } else {
      userContext = await getCandidateContext(uid);
    }
  } catch (err) {
    console.error("Failed to build context:", err);
  }

  // Build the prompt for Gemini
  const prompt = `
You are the JobMatch AI Assistant, a helpful, read-only AI for a hiring platform.
Your ONLY job is to help the user navigate the platform, explain features, provide guidance on hiring/applying, and read their data.

SECURITY RULES:
1. You CANNOT perform actions (e.g., you cannot apply to jobs, update profiles, or post jobs). If asked to do so, politely decline and tell the user how to do it in the UI.
2. You only have READ access to the user's data provided below. Do not invent data.
3. If the user asks something completely outside the scope of a hiring platform, reply EXACTLY with:
"Sorry, I do not have relevant information about that right now. I can help you with platform features, your data in this system, learning plans, and job matching guidance."
4. Never say "I updated your data", "I deleted your application", or "I posted the job".

---
USER DATA CONTEXT:
${JSON.stringify(userContext, null, 2)}

PLATFORM KNOWLEDGE BASE:
${JSON.stringify(systemKnowledge, null, 2)}

---
USER QUESTION: "${question}"

Provide a clean, conversational, and direct answer. Do not use Markdown headers, just simple paragraphs.
`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  let responseText = result.response.text().trim();

  // Sanitize response
  const forbiddenPhrases = [
    "i updated your", "i deleted your", "i posted the", "i have applied", "i created"
  ];
  
  const lowerResponse = responseText.toLowerCase();
  for (const phrase of forbiddenPhrases) {
    if (lowerResponse.includes(phrase)) {
      responseText = "I cannot perform actions directly, but I can guide you on how to do it in the platform.";
      break;
    }
  }

  return responseText;
}
