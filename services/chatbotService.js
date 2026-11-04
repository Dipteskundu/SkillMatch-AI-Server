import { GoogleGenerativeAI } from "@google/generative-ai";
import { createRequire } from "module";

import { classifyIntent, INTENTS } from "./classifier.service.js";
import { getCandidateContext, getRecruiterContext, getLearningContext, getUserName } from "./context.service.js";
import { sanitizeResponse, stripPII, stripPIIFromText } from "./sanitizer.service.js";
import { getLinkForIntent } from "../utils/linkMapper.js";
import { normalizeInput } from "../utils/normalizeInput.js";

const _require = createRequire(import.meta.url);
let systemKnowledge = {};
try {
  systemKnowledge = _require("../config/systemKnowledge.json");
} catch (_) {
  // systemKnowledge.json is optional
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
let genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
let warnedGeminiDisabled = false;

const FALLBACK_MESSAGE =
  "Sorry, I do not have relevant information about that right now. I can help you with platform features, your data in this system, learning plans, and job matching guidance.";

function isRecruiterRole(role) {
  return role === "recruiter" || role === "employer";
}

function roleLabel(role) {
  return isRecruiterRole(role) ? "Recruiter" : "Candidate";
}

function buildRoleMismatchMessage(loggedInRole) {
  const label = roleLabel(loggedInRole);
  if (isRecruiterRole(loggedInRole)) {
    return `You are logged in as a ${label}, and that question looks like a Candidate feature, so it isn’t related to your ${label} profile. How can I help you with ${label} features (job posts, applicants, interviews) for your logged-in role?`;
  }
  return `You are logged in as a ${label}, and that question looks like a Recruiter feature, so it isn’t related to your ${label} profile. How can I help you with ${label} features (applications, resume, skill tests, skill gap, learning plan) for your logged-in role?`;
}

/**
 * Best-effort role detection based on the question text + intent.
 * Returns "candidate" | "recruiter" | null (unknown/shared).
 */
function detectRequestedRole(question, intent) {
  const normalized = normalizeInput(question);

  // Explicit role words
  if (/\b(recruiter|employer|hiring|hire|job post|job posting|post a job|applicants?)\b/i.test(normalized)) {
    return "recruiter";
  }
  if (/\b(candidate|my applications?|saved jobs?|resume|skill gap|learning plan|skill test)\b/i.test(normalized)) {
    return "candidate";
  }

  // Intent-based defaults
  const recruiterIntents = new Set([
    INTENTS.CREATE_JOB,
    INTENTS.VIEW_APPLICANTS,
    INTENTS.SCHEDULE_INTERVIEW,
    INTENTS.RECRUITER_WORKFLOW,
    INTENTS.DELETE_JOB_EXPLAIN,
    INTENTS.EDIT_JOB_EXPLAIN,
    INTENTS.SHORTLIST_EXPLAIN,
  ]);

  const candidateIntents = new Set([
    INTENTS.APPLY_JOB,
    INTENTS.SAVE_JOB,
    INTENTS.VIEW_APPLICATIONS,
    INTENTS.LEARNING_PLAN,
    INTENTS.SKILL_GAP,
    INTENTS.SKILL_TEST,
    INTENTS.UPLOAD_RESUME,
    INTENTS.CANDIDATE_WORKFLOW,
  ]);

  if (recruiterIntents.has(intent)) return "recruiter";
  if (candidateIntents.has(intent)) return "candidate";

  // Ambiguous intents: try a tiny heuristic
  if (intent === INTENTS.USER_DATA_SUMMARY) {
    if (/\b(applicants?|active job posts?|job performance|job post)\b/i.test(normalized)) return "recruiter";
    if (/\b(applications?|matched jobs?|saved jobs?)\b/i.test(normalized)) return "candidate";
  }

  if (intent === INTENTS.JOB_MATCHING) {
    if (/\b(best candidates?|top matched candidates?|ranking)\b/i.test(normalized)) return "recruiter";
    return "candidate";
  }

  return null;
}

/**
 * Build a personalized static fallback (used when Gemini is unavailable).
 * @param {string} intent
 * @param {object} userContext
 * @param {string} role
 * @param {string} name  - user's first name (e.g. "John")
 */
function buildFallback(intent, userContext, role, name) {
  const hi = name && name !== "there" ? `${name}, ` : "";
  const you = name && name !== "there" ? name : "you";

  switch (intent) {
    case INTENTS.USER_DATA_SUMMARY:
      if (role === "recruiter" || role === "employer") {
        return `${hi}you currently have ${userContext.activeJobsCount ?? 0} active job post(s) with a total of ${userContext.totalApplicants ?? 0} applicant(s).`;
      }
      return `${hi}you have submitted ${userContext.applicationsCount ?? 0} application(s), saved ${userContext.savedJobsCount ?? 0} job(s), and matched with ${userContext.matchedJobsCount ?? 0} job(s).`;

    case INTENTS.APPLY_JOB:
      return `${hi}I can guide you through the steps, but I cannot perform actions directly. Go to the Jobs page, find a role you like, and click the "Apply" button.`;

    case INTENTS.CREATE_JOB:
      return `${hi}I can guide you through the steps, but I cannot perform actions directly. Open your Dashboard, click "Post a Job", fill in the details, and submit.`;

    case INTENTS.SCHEDULE_INTERVIEW:
      return `${hi}I can guide you through the steps, but I cannot perform actions directly. Head to the Interviews section in your Dashboard, pick a candidate, and set a time.`;

    case INTENTS.UPLOAD_RESUME:
      return `${hi}I can guide you through the steps, but I cannot perform actions directly. Visit the Resume page, click "Upload Resume", and select your PDF.`;

    case INTENTS.LEARNING_PLAN:
      return `${hi}visit your Learning Plan page to see personalized skills and courses recommended for your target role (${userContext.recentTargetRole || "your field"}).`;

    case INTENTS.SKILL_GAP:
      return `${hi}your skill gap analysis compares your current skills to what jobs in your target role require. Visit the Skill Gap Analysis page to see the details.`;

    case INTENTS.SKILL_TEST:
      return `${hi}you can take skill assessments from the Skill Tests page to verify your abilities and improve your profile ranking.`;

    case INTENTS.PLATFORM_HELP:
      return `JobMatch helps candidates find and apply for jobs, manage learning plans, and take skill tests. Recruiters can post jobs, review applicants, and schedule interviews. Let me know what ${you} need help with!`;

    case INTENTS.NEXT_STEPS:
      return `${hi}here are your best next steps: complete your profile, verify your skills with a skill test, and browse matched jobs on the Jobs page.`;

    case INTENTS.CANDIDATE_WORKFLOW:
      return `${hi}after signing up, complete your profile, upload your resume, take a skill test, and then browse the Jobs page to apply for positions.`;

    case INTENTS.RECRUITER_WORKFLOW:
      return `${hi}post a job from your Dashboard, then review applicants under your job post, shortlist the best candidates, and schedule interviews.`;

    case INTENTS.DASHBOARD:
      return `${hi}use the top navigation bar or sidebar to access your Dashboard, Jobs, Applications, Profile, and Learning Plan.`;

    case INTENTS.JOB_MATCHING:
      return `${hi}your match score is calculated by comparing your profile skills to each job's requirements. Keeping your profile complete and up-to-date maximises your match percentage.`;

    case INTENTS.PROFILE:
      return `${hi}visit your Profile page to update your personal details, skills, job title, and resume.`;

    case INTENTS.VIEW_APPLICATIONS:
      return `${hi}you can view all your submitted applications from the My Applications section in your Dashboard.`;

    case INTENTS.VIEW_APPLICANTS:
      return `${hi}you can review all applicants for each of your job posts from the Applicants section in your Recruiter Dashboard.`;

    case INTENTS.SAVE_JOB:
      return `${hi}click the bookmark icon on any job card to save it. You can find all saved jobs in the Saved Jobs section.`;

    case INTENTS.WHO_AM_I:
      return name && name !== "there" 
        ? `Your name is ${name}! I'm here to help you with your ${role} dashboard.`
        : "I'm sorry, I don't have your specific name in my records right now, but I'm here to help you!";

    case INTENTS.DELETE_JOB_EXPLAIN:
      return `${hi}to delete a job post, go to "My Jobs" in your dashboard, find the job, and click the "Delete" icon. Note that this action cannot be undone.`;

    case INTENTS.EDIT_JOB_EXPLAIN:
      return `${hi}to edit a job post, go to "My Jobs", find the job you want to change, and click the "Edit" button to update its details.`;

    case INTENTS.SHORTLIST_EXPLAIN:
      return `${hi}you can shortlist candidates by viewing the applicants for a specific job post and clicking the "Shortlist" button on their profile card.`;

    default:
      return FALLBACK_MESSAGE;
  }
}

/**
 * Main chatbot entry point.
 * Returns { answer: string, link: { label, path } | null }
 */
export async function askChatbot(uid, role, question) {
  const { intent, isActionRequest } = classifyIntent(question);

  // Enforce role-based access in the chatbot layer (read-only): if user asks about the other role,
  // respond with a role-aware guidance message instead of leaking cross-role features.
  const requestedRole = detectRequestedRole(question, intent);
  if (requestedRole) {
    const loggedInRole = isRecruiterRole(role) ? "recruiter" : "candidate";
    if (requestedRole !== loggedInRole) {
      return { answer: buildRoleMismatchMessage(role), link: null };
    }
  }

  // Always fetch the user's name for personalization (after role enforcement)
  const name = await getUserName(uid).catch(() => "there");

  if (intent === INTENTS.OUT_OF_SCOPE) {
    return { answer: FALLBACK_MESSAGE, link: null };
  }

  const needsActionPrefix =
    isActionRequest ||
    [INTENTS.APPLY_JOB, INTENTS.CREATE_JOB, INTENTS.SCHEDULE_INTERVIEW, INTENTS.UPLOAD_RESUME].includes(intent);

  // Build context
  let userContext = {};
  let docsContext = null;

  try {
    const isRecruiter = role === "recruiter" || role === "employer";
    if (intent === INTENTS.USER_DATA_SUMMARY || intent === INTENTS.NEXT_STEPS) {
      userContext = isRecruiter
        ? await getRecruiterContext(uid)
        : await getCandidateContext(uid);
    } else if (
      intent === INTENTS.LEARNING_PLAN ||
      intent === INTENTS.SKILL_GAP ||
      intent === INTENTS.JOB_MATCHING
    ) {
      userContext = await getLearningContext(uid);
      docsContext = systemKnowledge;
    } else {
      docsContext = systemKnowledge;
      userContext = { userRole: role };
    }
  } catch (err) {
    console.error("Context build error (using fallback):", err.message);
    userContext = { userRole: role };
  }

  const link = getLinkForIntent(intent);

  let answer = "";

  if (!genAI) {
    answer = buildFallback(intent, userContext, role, name);
  } else {
    const actionInstruction = needsActionPrefix
      ? `IMPORTANT: Start your response with "I can guide you through the steps, but I cannot perform actions directly." then provide clear steps.\n`
      : "";

    const nameInstruction =
      name && name !== "there"
        ? `USERNAME: The user's first name is "${name}". IF they ask who they are or what their name is, tell them directly. Otherwise, address them by name naturally — in the greeting or data summary. Do NOT repeat the name more than once per response.`
        : `USERNAME: The user's name is unknown. If they ask for their name, tell them you don't have it in your records yet. Use friendly but impersonal language otherwise.`;

    const prompt = `You are the JobMatch AI Assistant — a helpful, friendly, read-only support assistant for a job-matching platform.

SECURITY RULES:
- You CANNOT perform actions (apply to jobs, update profiles, post jobs, delete data). If asked, start with: "I can guide you through the steps, but I cannot perform actions directly."
- Use ONLY the user data and platform knowledge provided below. Never invent facts.
- If the question is completely outside the scope of a job platform, reply EXACTLY: "${FALLBACK_MESSAGE}"
- Never say "I updated", "I deleted", "I applied", "I posted", "I created", "I scheduled".
- Keep replies concise, friendly, and in plain paragraphs (no markdown headers).

${nameInstruction}
${actionInstruction}
USER ROLE: ${role}

USER CONTEXT (read-only snapshot of this user's data):
${JSON.stringify(stripPII(userContext), null, 2)}

PLATFORM KNOWLEDGE:
${JSON.stringify(docsContext, null, 2)}

USER QUESTION: ${stripPIIFromText(question)}

Respond naturally and helpfully. When suggesting a page, say "visit [page name]" — the UI adds navigation links automatically.`;

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      answer = result.response.text().trim();
    } catch (apiError) {
      const msg = String(apiError?.message || "");
      const isInvalidKey =
        /API key not valid/i.test(msg) ||
        /API_KEY_INVALID/i.test(msg) ||
        /api_key_invalid/i.test(msg);

      if (isInvalidKey) {
        genAI = null;
        if (!warnedGeminiDisabled) {
          warnedGeminiDisabled = true;
          console.warn(
            "Gemini is disabled: invalid GEMINI_API_KEY. Set a valid GEMINI_API_KEY in environment variables to enable AI responses.",
          );
        }
      } else {
        // Avoid spamming logs on transient Gemini errors.
        if (!warnedGeminiDisabled && !process.env.VERCEL) {
          warnedGeminiDisabled = true;
          console.warn("Gemini error — using fallback:", msg);
        }
      }
      answer = buildFallback(intent, userContext, role, name);
    }
  }

  answer = sanitizeResponse(answer);
  return { answer, link };
}
