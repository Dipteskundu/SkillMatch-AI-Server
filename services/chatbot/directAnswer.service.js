function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function getDirectAnswer({ message, classification, context, role }) {
  const normalized = String(message || "").toLowerCase();

  if (classification === "user_data_summary") {
    if (hasAny(normalized, ["how many", "application count", "applications"])) {
      return {
        matched: true,
        answer: `You have ${context.applicationSummary.total} applications in the system. ${context.applicationSummary.statusLine}`,
      };
    }

    if (hasAny(normalized, ["saved jobs", "saved job"])) {
      return {
        matched: true,
        answer: `You have ${context.savedJobs.count} saved jobs right now.`,
      };
    }

    if (hasAny(normalized, ["interview", "interviews"])) {
      return {
        matched: true,
        answer: `You currently have ${context.applicationSummary.interviews} applications in interview status.`,
      };
    }

    if (hasAny(normalized, ["notification", "notifications"])) {
      return {
        matched: true,
        answer: `You have ${context.notifications.total} notifications, including ${context.notifications.unread} unread.`,
      };
    }

    if (hasAny(normalized, ["profile completion"])) {
      return {
        matched: true,
        answer: `Your profile completion is ${context.profile.profileCompletion}%.`,
      };
    }

    if (hasAny(normalized, ["dashboard", "dashboard stats"])) {
      return {
        matched: true,
        answer: context.dashboardSummaryLine,
      };
    }

    if (hasAny(normalized, ["skill gap", "learning plan"])) {
      return {
        matched: true,
        answer: context.skillGapSummaryLine,
      };
    }
  }

  if (classification === "learning_guidance") {
    if (hasAny(normalized, ["skill gap", "missing skill", "missing skills"])) {
      return {
        matched: true,
        answer: context.skillGapSummaryLine,
      };
    }

    if (hasAny(normalized, ["match score"])) {
      return {
        matched: true,
        answer: `Your latest stored match score summary is: ${context.skillGapSummary.matchScoreLine}`,
      };
    }

    if (hasAny(normalized, ["resume summary", "resume"])) {
      return {
        matched: true,
        answer: context.resumeSummaryLine,
      };
    }
  }

  if (classification === "job_matching_explanation") {
    if (hasAny(normalized, ["match score", "match logic", "job matching"])) {
      return {
        matched: true,
        answer: `Job matching uses your profile, skills, and resume data against job requirements.  It ranks potential jobs based on skill overlap, experience alignment, and application activity. ${context.dashboardSummaryLine}`,
      };
    }
  }

  if (role === "recruiter" && classification === "recruiter_data_summary") {
    if (hasAny(normalized, ["applicant", "applicants", "recruiter dashboard", "posted jobs"])) {
      return {
        matched: true,
        answer: context.dashboardSummaryLine,
      };
    }
  }

  if (role === "admin" && hasAny(normalized, ["platform stats", "admin dashboard", "total users", "total jobs"])) {
    return {
      matched: true,
      answer: context.dashboardSummaryLine,
    };
  }

  return { matched: false };
}
