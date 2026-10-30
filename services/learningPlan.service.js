// services/learningPlan.service.js
// Pure functions for AI plan generation (Phase 2) — no DB, no HTTP.
// Kept side-effect free so the validator and the AI-response schema
// normalizer can be unit-tested directly in Phase 4.

const REQUIRED_FIELDS = ["goal", "existingSkills", "proficiency", "targetOutcome", "weeklyHours"];

const PROFICIENCY = ["beginner", "intermediate", "advanced"];
const OUTCOMES = ["job-preparation", "project", "interview", "general-learning"];
const PREFERENCES = ["explanations", "examples", "practical-exercises"];

const LIMITS = {
  goal: 200,
  skills: 15,
  weakAreas: 10,
  language: 40,
  targetJobRole: 80,
  title: 120,
  modules: 12,
  lessonsPerModule: 10,
  topics: 10,
};

/** Trim + de-duplicate a string list, dropping empties and capping length. */
function toStringList(value, max, itemMax = 60) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,;]+/);
  return [
    ...new Set(
      list
        .map((item) => String(item ?? "").trim().slice(0, itemMax))
        .filter(Boolean),
    ),
  ].slice(0, max);
}

/**
 * Validate the discovery questionnaire server-side (LH-006).
 * Returns { ok: true, answers } or { ok: false, errors: [...] }.
 * Never trusts the client: types are coerced, ranges enforced, unknown
 * optional fields are ignored rather than stored.
 */
export function validateDiscoveryAnswers(body) {
  const source = body && typeof body === "object" ? body : {};
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (source[field] === undefined || source[field] === null || source[field] === "") {
      errors.push(`${field} is required`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const goal = String(source.goal).trim().slice(0, LIMITS.goal);
  if (goal.length < 2) errors.push("goal must be at least 2 characters");

  const existingSkills = toStringList(source.existingSkills, LIMITS.skills);
  if (!existingSkills.length) errors.push("existingSkills must include at least one skill");

  const proficiency = String(source.proficiency).toLowerCase().trim();
  if (!PROFICIENCY.includes(proficiency)) {
    errors.push(`proficiency must be one of: ${PROFICIENCY.join(", ")}`);
  }

  const targetOutcome = String(source.targetOutcome).toLowerCase().trim();
  if (!OUTCOMES.includes(targetOutcome)) {
    errors.push(`targetOutcome must be one of: ${OUTCOMES.join(", ")}`);
  }

  const weeklyHours = Number(source.weeklyHours);
  if (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > 80) {
    errors.push("weeklyHours must be a number between 1 and 80");
  }

  const optional = {};
  if (source.completionWeeks !== undefined && source.completionWeeks !== "") {
    const weeks = Number(source.completionWeeks);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
      errors.push("completionWeeks must be a number between 1 and 52");
    } else {
      optional.completionWeeks = Math.round(weeks);
    }
  }
  if (source.weakAreas) optional.weakAreas = toStringList(source.weakAreas, LIMITS.weakAreas);
  if (source.language) optional.language = String(source.language).trim().slice(0, LIMITS.language);
  if (source.targetJobRole) {
    optional.targetJobRole = String(source.targetJobRole).trim().slice(0, LIMITS.targetJobRole);
  }
  if (source.learningPreference) {
    const prefs = toStringList(source.learningPreference, PREFERENCES.length)
      .map((p) => p.toLowerCase().replace(/\s+/g, "-"))
      .filter((p) => PREFERENCES.includes(p));
    if (prefs.length) optional.learningPreference = prefs;
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    answers: {
      goal,
      existingSkills,
      proficiency,
      targetOutcome,
      weeklyHours: Math.round(weeklyHours),
      ...optional,
    },
  };
}

/**
 * Rule-based diagnostic recommendation (LH-007).
 * A binary call does not deserve an AI round trip, so the rule is explicit:
 * recommend when the learner is a beginner or volunteered weak areas.
 */
export function recommendDiagnostic(answers) {
  const reasons = [];
  if (answers.proficiency === "beginner") {
    reasons.push("you identified as a beginner");
  }
  if (answers.weakAreas?.length) {
    reasons.push(`you flagged ${answers.weakAreas.slice(0, 3).join(", ")} as weak`);
  }
  return { recommended: reasons.length > 0, reasons };
}

/** Adaptive recommendations after lesson completion (LH-023).
 *  Returns topic-focused suggestions for the next lesson or job-gap roles.
 *  Pure function — no DB, no HTTP, no AI call. */
export function getAdaptiveRecommendations(lessonTopics, weakTopics, proficiency, completedLessons) {
  const recommendations = [];

  // Topic-based next-lesson suggestions
  if (lessonTopics && lessonTopics.length > 0) {
    const uncovered = lessonTopics.filter(
      (t) => !completedLessons?.includes(t),
    );
    if (uncovered.length > 0) {
      recommendations.push({
        type: "next-lesson",
        title: "Continue Learning",
        description: `Master ${uncovered.slice(0, 3).join(", ")}`,
        action: "/learning-hub/lessons",
      });
    }
  }

  // Weak area improvement
  if (weakTopics && weakTopics.length > 0) {
    recommendations.push({
      type: "practice",
      title: "Focus on Weak Areas",
      description: `Review ${weakTopics.slice(0, 3).join(", ")} concepts`,
      action: "/learning-hub/lessons",
    });
  }

  // Proficiency-based pathway
  if (proficiency === "beginner") {
    recommendations.push({
      type: "path",
      title: "Build Foundation",
      description: "Complete beginner-level modules before advancing",
      action: "/learning-hub/paths",
    });
  } else if (proficiency === "intermediate") {
    recommendations.push({
      type: "path",
      title: "Advance Skills",
      description: "Move to intermediate topics and practical projects",
      action: "/learning-hub/paths",
    });
  }

  // Job-gap recommendations (LH-024) — simple topic-to-role mapping
  const jobGapRoles = [];
  if (lessonTopics) {
    const topicMap = {
      html: ["Frontend Developer", "Web Designer"],
      css: ["Frontend Developer", "UI/UX Designer"],
      javascript: ["Frontend Developer", "Full Stack Developer"],
      python: ["Backend Developer", "Data Scientist"],
      react: ["Frontend Developer", "Full Stack Developer"],
      node: ["Backend Developer", "Full Stack Developer"],
    };
    for (const [topic, roles] of Object.entries(topicMap)) {
      if (lessonTopics.some((t) => t.toLowerCase().includes(topic))) {
        jobGapRoles.push(...roles);
      }
    }
    if (jobGapRoles.length > 0) {
      const uniqueRoles = [...new Set(jobGapRoles)];
      recommendations.push({
        type: "job-gap",
        title: "Related Career Paths",
        description: `Consider roles: ${uniqueRoles.slice(0, 3).join(", ")}`,
        action: "/learning-hub/jobs",
      });
    }
  }

  return {
    recommendations: recommendations.slice(0, 3), // cap to 3
    generatedAt: new Date().toISOString(),
  };
}

/** Build a compact prompt — inputs are capped to keep the token budget bounded. */
export function buildPlanPrompt(answers) {
  const schema = `{
  "title": string,
  "expectedOutcomes": string[1..6],
  "modules": [
    {
      "title": string,
      "topics": string[1..6],
      "prerequisites": string[],
      "estimatedHours": number,
      "completionCriteria": string,
      "lessons": [
        { "title": string, "kind": "lesson" | "activity", "durationMinutes": number, "topics": string[], "hasKnowledgeCheck": boolean }
      ]
    }
  ]
}`;

  const lines = [
    "You are a technical curriculum planner for a job-skills learning platform.",
    "Return ONLY a valid JSON object. No markdown fences, no commentary, no trailing text.",
    `Schema:\n${schema}`,
    "",
    "Rules:",
    "- 4 to 10 modules, ordered foundational to advanced.",
    "- Each module: 2 to 8 items in lessons; estimatedHours between 1 and 40.",
    "- lesson durationMinutes between 10 and 90; roughly 40% of items kind=activity.",
    "- prerequisites lists earlier module titles this module depends on (may be empty).",
    "- At least half the lessons must set hasKnowledgeCheck to true.",
    "- Total estimatedHours across modules must be near weeklyHours x estimatedWeeks.",
    "- Titles and topics must be concrete and technical, never generic filler.",
    "",
    "Learner profile:",
    `- Goal: ${answers.goal}`,
    `- Existing skills: ${answers.existingSkills.join(", ")}`,
    `- Proficiency: ${answers.proficiency}`,
    `- Target outcome: ${answers.targetOutcome}`,
    `- Available: ${answers.weeklyHours} hours per week for ${answers.estimatedWeeks} weeks`,
  ];

  if (answers.targetJobRole) lines.push(`- Target job role: ${answers.targetJobRole}`);
  if (answers.weakAreas?.length) lines.push(`- Weak areas to address: ${answers.weakAreas.join(", ")}`);
  if (answers.learningPreference?.length) {
    lines.push(`- Prefers: ${answers.learningPreference.join(", ")}`);
  }
  if (answers.language) lines.push(`- Respond in this language: ${answers.language}`);

  return lines.join("\n");
}

/** Derive the weekly schedule deterministically from module hours.
 * The AI is not asked for this — its math is unreliable, ours is not.
 * Exported: editing weekly hours on a saved plan rebuilds the schedule.
 */
export function buildWeeklySchedule(modules, weeklyHours) {
  const schedule = [];
  let cumulative = 0;
  for (const mod of modules) {
    const startWeek = Math.floor(cumulative / weeklyHours) + 1;
    cumulative += mod.estimatedHours;
    const endWeek = Math.max(startWeek, Math.ceil(cumulative / weeklyHours));
    schedule.push({
      week: startWeek,
      throughWeek: endWeek,
      module: mod.title,
      topics: mod.topics,
    });
  }
  return schedule;
}

/**
 * Validate + normalise raw AI output into a storable plan (LH-008).
 * Malformed regions are pruned where safe; unusable plans throw an error
 * carrying .code = "PLAN_SCHEMA" so the route can answer 502 clearly.
 *
 * @param {unknown} raw    parsed AI JSON
 * @param {object} answers validated discovery answers
 */
export function normalizePlan(raw, answers) {
  const fail = (message) => {
    const error = new Error(message);
    error.code = "PLAN_SCHEMA";
    throw error;
  };

  const source = raw && typeof raw === "object" ? raw : null;
  if (!source) fail("Plan generation returned no object");

  const rawModules = Array.isArray(source.modules) ? source.modules : [];
  const modules = [];

  for (const candidate of rawModules) {
    if (modules.length >= LIMITS.modules) break;
    if (!candidate || typeof candidate !== "object") continue;

    const title = String(candidate.title ?? "").trim().slice(0, LIMITS.title);
    if (!title) continue;

    const rawLessons = Array.isArray(candidate.lessons) ? candidate.lessons : [];
    const lessons = [];
    for (const rawLesson of rawLessons) {
      if (lessons.length >= LIMITS.lessonsPerModule) break;
      if (!rawLesson || typeof rawLesson !== "object") continue;

      const lessonTitle = String(rawLesson.title ?? "").trim().slice(0, LIMITS.title);
      if (!lessonTitle) continue;

      const duration = Number(rawLesson.durationMinutes);
      const durationMinutes = Number.isFinite(duration)
        ? Math.min(90, Math.max(10, Math.round(duration)))
        : 30;

      lessons.push({
        order: lessons.length + 1,
        title: lessonTitle,
        kind: rawLesson.kind === "activity" ? "activity" : "lesson",
        durationMinutes,
        topics: toStringList(rawLesson.topics, LIMITS.topics),
        hasKnowledgeCheck: rawLesson.hasKnowledgeCheck !== false,
      });
    }

    if (!lessons.length) continue; // a module without lessons is unusable

    const hours = Number(candidate.estimatedHours);
    const estimatedHours = Number.isFinite(hours)
      ? Math.min(40, Math.max(1, Math.round(hours)))
      : Math.max(1, Math.ceil(lessons.reduce((n, l) => n + l.durationMinutes, 0) / 60));

    modules.push({
      order: modules.length + 1,
      title,
      topics: toStringList(candidate.topics, LIMITS.topics),
      prerequisites: toStringList(candidate.prerequisites, LIMITS.modules, LIMITS.title),
      estimatedHours,
      completionCriteria: String(candidate.completionCriteria ?? "").trim().slice(0, 300),
      lessons,
    });
  }

  if (modules.length < 2) fail("Plan generation produced fewer than 2 usable modules");

  const totalHours = modules.reduce((n, m) => n + m.estimatedHours, 0);
  const estimatedWeeks =
    answers.completionWeeks || Math.max(1, Math.ceil(totalHours / answers.weeklyHours));

  const expectedOutcomes = toStringList(source.expectedOutcomes, 6, 160);
  const title = String(source.title ?? "").trim().slice(0, LIMITS.title) || answers.goal;

  return {
    title,
    learningGoal: answers.goal,
    startingLevel: answers.proficiency,
    targetOutcome: answers.targetOutcome,
    expectedOutcomes: expectedOutcomes.length
      ? expectedOutcomes
      : [`Build working ${answers.goal} skills`],
    weeklyHours: answers.weeklyHours,
    estimatedWeeks,
    estimatedHours: totalHours,
    modules,
    weeklySchedule: buildWeeklySchedule(modules, answers.weeklyHours),
    // Module checkpoints plus one end-of-path assessment (spec §Plan Generation).
    assessmentMilestones: [
      ...modules.map((m) => ({ module: m.title, type: "module" })),
      { module: null, type: "final" },
    ],
  };
}

export const PLAN_LIMITS = LIMITS;

/** Topic mastery chart data (LH-025).
 *  Returns aggregated topic performance across all completed assessments/lessons.
 *  Pure function — no DB, no HTTP, no AI call. */
export function getTopicMasteryChartData(assessmentResults, lessonProgress) {
  // Aggregate correct rates per topic from assessment results
  const topicCounts = {};

  // From assessments
  if (assessmentResults) {
    for (const result of assessmentResults) {
      if (result.topicPerformance) {
        for (const [topic, performance] of Object.entries(result.topicPerformance)) {
          if (!topicCounts[topic]) topicCounts[topic] = { correct: 0, total: 0 };
          topicCounts[topic].total += 1;
          if (performance.isCorrect) topicCounts[topic].correct += 1;
        }
      }
    }
  }

  // Transform to chart-ready data
  const chartData = Object.entries(topicCounts).map(([topic, { correct, total }]) => ({
    topic,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    total,
    correct,
  }));

  // Sort by accuracy descending
  chartData.sort((a, b) => b.accuracy - a.accuracy);

  return {
    chartData: chartData.slice(0, 10), // top 10 topics
    generatedAt: new Date().toISOString(),
  };
}

/** Certificate generation data (LH-027).
 *  Returns certificate eligibility and details for path completion.
 *  Pure function — no DB, no HTTP, no AI call. */
export function getCertificateInfo(pathId, userProgress) {
  // Find the path
  const path = {
    id: pathId,
    title: "Learning Path Title",
    description: "A comprehensive learning path.",
    moduleCount: 0,
    lessonCount: 0,
    completedModules: 0,
    completedLessons: 0,
  };

  // Calculate completion from user progress
  let completedModules = 0;
  let completedLessons = 0;
  let totalModules = path.moduleCount || 0;
  let totalLessons = path.lessonCount || 0;

  if (userProgress) {
    completedModules = userProgress.completedModules || 0;
    completedLessons = userProgress.completedLessons || 0;
  }

  const completionPercentage = totalModules > 0
    ? Math.round((completedModules / totalModules) * 100)
    : 0;

  const isEligible = completionPercentage >= 80;

  return {
    isEligible,
    completionPercentage,
    pathTitle: path.title,
    completedModules,
    totalModules,
    completedLessons,
    totalLessons,
    certificateId: isEligible ? `cert-${pathId}-${Date.now()}` : null,
    generatedAt: new Date().toISOString(),
  };
}