import { getDB } from "../../config/db.js";
import { COLLECTION as SYSTEM_KNOWLEDGE_COLLECTION } from "../../models/SystemKnowledge.js";
import { getAdditionalKnowledgeText } from "./internalKnowledge.service.js";

function formatStatusLine(statuses) {
  return `Submitted: ${statuses.submitted}, shortlisted: ${statuses.shortlisted}, interviewing: ${statuses.interviewing}, rejected: ${statuses.rejected}.`;
}

function pickLatestSkillGap(skillGaps) {
  return skillGaps.length ? skillGaps[0] : null;
}

function summarizeKnowledge(docs) {
  return docs
    .map((doc) => `- ${doc.title}: ${doc.content}`)
    .join("\n");
}

function summarizeRecentApplications(applications) {
  if (!applications.length) return "No recent applications found.";

  return applications
    .slice(0, 5)
    .map((application) => {
      const title = application.jobTitle || "Unknown role";
      const status = application.status || "unknown";
      return `${title} (${status})`;
    })
    .join(", ");
}

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
    } else if (value && String(value).trim() !== "") {
      totalScore += field.weight;
    }
  });

  return Math.round((totalScore / maxScore) * 100);
}

export async function buildChatbotContext({ platformUser, classification, message }) {
  const db = getDB();
  const uid = platformUser.firebaseUid;
  const role = platformUser.role || "candidate";

  const knowledgeFilter = {
    status: "active",
    role: { $in: ["all", role] },
  };

  const keywordTerms = String(message || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 12);

  const knowledgeDocs = await db
    .collection(SYSTEM_KNOWLEDGE_COLLECTION)
    .find({
      ...knowledgeFilter,
      $or: [
        { keywords: { $in: keywordTerms } },
        { title: { $regex: keywordTerms.join("|"), $options: "i" } },
      ],
    })
    .project({
      slug: 1,
      title: 1,
      role: 1,
      keywords: 1,
      content: 1,
    })
    .limit(5)
    .toArray();

  const profile = await db.collection("users").findOne(
    { firebaseUid: uid },
    {
      projection: {
        firebaseUid: 1,
        displayName: 1,
        email: 1,
        role: 1,
        companyName: 1,
        title: 1,
        location: 1,
        photoURL: 1,
        phone: 1,
        bio: 1,
        skills: { $slice: 10 },
        experience: { $slice: 5 },
        education: { $slice: 5 },
        projects: { $slice: 5 },
        certificates: { $slice: 5 },
        portfolioUrl: 1,
        linkedin: 1,
        github: 1,
        resumeUploaded: 1,
        yearsOfExperience: 1,
      },
    },
  );

  const applications = await db
    .collection("applications")
    .find(
      role === "candidate"
        ? { firebaseUid: uid }
        : role === "recruiter"
          ? {}
          : {},
    )
    .project({
      jobId: 1,
      jobTitle: 1,
      status: 1,
      createdAt: 1,
      communicationScore: 1,
      firebaseUid: 1,
    })
    .sort({ createdAt: -1 })
    .limit(role === "candidate" ? 10 : 50)
    .toArray();

  let recruiterJobIds = [];
  let recruiterJobs = [];
  let recruiterApplications = [];

  if (role === "recruiter") {
    recruiterJobs = await db
      .collection("find_jobs")
      .find({
        company: profile?.companyName || profile?.displayName || platformUser.companyName || platformUser.displayName,
      })
      .project({
        title: 1,
        company: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    recruiterJobIds = recruiterJobs.map((job) => job._id).filter(Boolean);
    recruiterApplications = recruiterJobIds.length
      ? await db
          .collection("applications")
          .find({ jobId: { $in: recruiterJobIds } })
          .project({
            jobId: 1,
            jobTitle: 1,
            status: 1,
            communicationScore: 1,
            createdAt: 1,
          })
          .sort({ createdAt: -1 })
          .limit(25)
          .toArray()
      : [];
  }

  const savedJobs = await db
    .collection("saved_jobs")
    .find({ firebaseUid: uid })
    .project({
      jobId: 1,
      createdAt: 1,
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  const resumes = await db
    .collection("resumes")
    .find({ candidateId: uid })
    .project({
      originalName: 1,
      extractedSkills: { $slice: 10 },
      extractedTechnologies: { $slice: 10 },
      extractedExperience: 1,
      extractedRoles: { $slice: 5 },
      createdAt: 1,
    })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  const skillGaps = await db
    .collection("skillGaps")
    .find({ candidateId: uid })
    .project({
      matchScore: 1,
      matchedSkills: { $slice: 8 },
      missingSkills: { $slice: 8 },
      learningSuggestions: { $slice: 5 },
      createdAt: 1,
      jobId: 1,
    })
    .sort({ createdAt: -1 })
    .limit(3)
    .toArray();

  const notifications = await db
    .collection("notifications")
    .find({ userId: uid })
    .project({
      message: 1,
      type: 1,
      read: 1,
      createdAt: 1,
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  let adminStats = null;
  if (role === "admin") {
    const [totalUsers, totalJobs, totalApplications, totalCompanies] = await Promise.all([
      db.collection("users").countDocuments(),
      db.collection("find_jobs").countDocuments(),
      db.collection("applications").countDocuments(),
      db.collection("companies_info").countDocuments(),
    ]);

    adminStats = {
      totalUsers,
      totalJobs,
      totalApplications,
      totalCompanies,
    };
  }

  const applicationSource = role === "recruiter" ? recruiterApplications : applications;
  const applicationStatuses = {
    submitted: applicationSource.filter((item) => item.status === "submitted").length,
    shortlisted: applicationSource.filter((item) => item.status === "shortlisted").length,
    interviewing: applicationSource.filter((item) => item.status === "interviewing").length,
    rejected: applicationSource.filter((item) => item.status === "rejected").length,
  };

  const latestResume = resumes[0] || null;
  const latestSkillGap = pickLatestSkillGap(skillGaps);

  const skillGapSummaryLine = latestSkillGap
    ? `Your latest stored skill gap shows a ${latestSkillGap.matchScore ?? 0}% match score, missing skills: ${(latestSkillGap.missingSkills || []).join(", ") || "none"}, and learning suggestions: ${(latestSkillGap.learningSuggestions || []).join("; ") || "none recorded"}.`
    : "I could not find a stored skill gap or learning-plan record for your account.";

  const resumeSummaryLine = latestResume
    ? `Your latest resume is ${latestResume.originalName || "an uploaded resume"} with skills ${(latestResume.extractedSkills || []).join(", ") || "none recorded"}, technologies ${(latestResume.extractedTechnologies || []).join(", ") || "none recorded"}, and ${latestResume.extractedExperience || 0} years of extracted experience.`
    : "I could not find a stored resume summary for your account.";

  let dashboardSummaryLine = `Your dashboard summary shows ${applicationSource.length} applications. ${formatStatusLine(applicationStatuses)}`;
  if (role === "recruiter") {
    dashboardSummaryLine = `Your recruiter dashboard summary shows ${recruiterJobs.length} jobs and ${recruiterApplications.length} applicants. ${formatStatusLine(applicationStatuses)}`;
  }
  if (role === "admin" && adminStats) {
    dashboardSummaryLine = `The admin dashboard currently shows ${adminStats.totalUsers} users, ${adminStats.totalJobs} jobs, ${adminStats.totalApplications} applications, and ${adminStats.totalCompanies} companies.`;
  }

  const summarizedContext = {
    role,
    classification,
    profile: {
      displayName: profile?.displayName || platformUser.displayName || "",
      role,
      profileCompletion: calculateProfileCompletion(profile),
      title: profile?.title || "",
      location: profile?.location || "",
      skills: profile?.skills || [],
      yearsOfExperience: profile?.yearsOfExperience || 0,
      resumeUploaded: Boolean(profile?.resumeUploaded),
    },
    applicationSummary: {
      total: applicationSource.length,
      interviews: applicationStatuses.interviewing,
      shortlisted: applicationStatuses.shortlisted,
      rejected: applicationStatuses.rejected,
      statusLine: formatStatusLine(applicationStatuses),
      recent: summarizeRecentApplications(applicationSource),
    },
    savedJobs: {
      count: savedJobs.length,
    },
    notifications: {
      total: notifications.length,
      unread: notifications.filter((item) => !item.read).length,
    },
    resumeSummary: latestResume,
    resumeSummaryLine,
    skillGapSummary: {
      latestExists: Boolean(latestSkillGap),
      matchScoreLine: latestSkillGap
        ? `${latestSkillGap.matchScore ?? 0}% with missing skills ${(latestSkillGap.missingSkills || []).join(", ") || "none"}`
        : "No stored skill gap found.",
    },
    skillGapSummaryLine,
    recruiterSummary: role === "recruiter"
      ? {
          jobsCount: recruiterJobs.length,
          applicantsCount: recruiterApplications.length,
          recentJobs: recruiterJobs.slice(0, 5).map((job) => job.title || "Untitled job"),
        }
      : null,
    adminStats,
    dashboardSummaryLine,
    featureKnowledge: [
      summarizeKnowledge(knowledgeDocs),
      getAdditionalKnowledgeText(),
    ]
      .filter(Boolean)
      .join("\n"),
  };

  return summarizedContext;
}
