const MUTATION_KEYWORDS = [
  "update",
  "delete",
  "remove",
  "approve",
  "reject",
  "change",
  "edit",
  "modify",
  "create",
  "submit",
  "apply for me",
  "post",
  "approve",
  "reject",
  "perform",
  "action",
];

const OUT_OF_SCOPE_KEYWORDS = [
  "weather",
  "news",
  "stock",
  "bitcoin",
  "google search",
  "internet",
  "world cup",
  "recipe",
  "movie",
  "medical",
  "legal",
  "financial",
  "politics",
  "diet",
];

const JOB_MATCH_KEYWORDS = [
  "match score",
  "job matching",
  "recommended jobs",
  "job matches",
  "matching logic",
  "skill match",
  "match criteria",
];

const LEARNING_KEYWORDS = [
  "skill gap",
  "missing skill",
  "missing skills",
  "learning plan",
  "learning suggestion",
  "recommendation",
  "recommendations",
  "learning guidance",
  "training path",
  "skill improvement",
];

const USER_DATA_KEYWORDS = [
  "my ",
  "how many",
  "application count",
  "applications",
  "saved jobs",
  "interviews",
  "notifications",
  "profile completion",
  "resume",
  "dashboard stats",
  "my data",
];

const RECRUITER_KEYWORDS = [
  "recruiter",
  "applicant",
  "candidates",
  "job postings",
  "postings",
  "hire",
  "shortlist",
  "interviewee",
];

const WORKFLOW_KEYWORDS = [
  "how do i",
  "how to",
  "step",
  "process",
  "where can i",
  "where do i",
  "workflow",
  "next steps",
];

const PLATFORM_KEYWORDS = [
  "feature",
  "dashboard",
  "profile",
  "notifications",
  "resume page",
  "upload resume",
  "skill test",
  "companies page",
  "learning plan",
  "skill gap",
  "job match",
  "system",
];

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyQuestion(message) {
  const normalized = String(message || "").toLowerCase().trim();

  if (!normalized) {
    return { type: "out_of_scope", reason: "empty_message" };
  }

  if (includesAny(normalized, MUTATION_KEYWORDS)) {
    return { type: "out_of_scope", reason: "mutation_request" };
  }

  if (includesAny(normalized, OUT_OF_SCOPE_KEYWORDS)) {
    return { type: "out_of_scope", reason: "external_knowledge" };
  }

  if (includesAny(normalized, JOB_MATCH_KEYWORDS)) {
    return { type: "job_matching_explanation", reason: "job_matching_keywords" };
  }

  if (includesAny(normalized, LEARNING_KEYWORDS)) {
    return { type: "learning_guidance", reason: "learning_keywords" };
  }

  if (includesAny(normalized, RECRUITER_KEYWORDS)) {
    return { type: "recruiter_data_summary", reason: "recruiter_keywords" };
  }

  if (includesAny(normalized, USER_DATA_KEYWORDS)) {
    return { type: "user_data_summary", reason: "user_data_keywords" };
  }

  if (includesAny(normalized, WORKFLOW_KEYWORDS)) {
    return { type: "workflow_help", reason: "workflow_keywords" };
  }

  if (includesAny(normalized, PLATFORM_KEYWORDS)) {
    return { type: "platform_help", reason: "platform_keywords" };
  }

  return { type: "platform_help", reason: "default_internal_help" };
}
