// lib/schemas.js
// Shared Zod schemas + helpers for request validation.

import { z } from "zod";
import { USER_ROLES, USER_STATUSES } from "../models/User.js";
import { APPLICATION_STATUSES } from "../models/Application.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Escape regex special characters (prevents regex injection / ReDoS). */
export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────

/** Firebase UID param — 1-128 chars (Firebase's own limit). */
export const uidParam = z
  .string({ required_error: "uid is required" })
  .trim()
  .min(1)
  .max(128);

/** MongoDB ObjectId param (24-char hex string). */
export const objectIdParam = z
  .string({ required_error: "id is required" })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a valid MongoDB ObjectId");

/** Email (basic format + length). */
export const emailField = z
  .string({ required_error: "email is required" })
  .trim()
  .min(3)
  .max(254)
  .email("must be a valid email address");

// ─────────────────────────────────────────────────────────────
// Enums (kept in sync with models/ via import)
// ─────────────────────────────────────────────────────────────

export const userRoleEnum = z.enum(USER_ROLES);
export const userStatusEnum = z.enum(USER_STATUSES);
export const applicationStatusEnum = z.enum(APPLICATION_STATUSES);

// ─────────────────────────────────────────────────────────────
// Query schemas
// ─────────────────────────────────────────────────────────────

/** Pagination query (page >= 1, 1 <= limit <= 100). */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Search query: bounded length, regex-safe (escape before using in $regex). */
export const searchQuery = z
  .string()
  .trim()
  .max(100, "search must be at most 100 characters");

// ─────────────────────────────────────────────────────────────
// Body schemas
// ─────────────────────────────────────────────────────────────

/** Profile update: whitelist only — never role/verifiedSkills/isSkillVerified/firebaseUid/email. */
export const profileUpdateBody = z.object({
  displayName: z.string().trim().max(200).optional(),
  photoURL: z.string().trim().max(1000).optional(),
  title: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  bio: z.string().trim().max(2000).optional(),
  companyName: z.string().trim().max(200).optional(),
  skills: z.array(z.string().trim().max(100)).max(200).optional(),
  experience: z.array(z.any()).max(200).optional(),
  education: z.array(z.any()).max(100).optional(),
  projects: z.array(z.any()).max(100).optional(),
  certificates: z.array(z.any()).max(100).optional(),
  portfolioUrl: z.string().trim().max(500).optional(),
  linkedin: z.string().trim().max(500).optional(),
  github: z.string().trim().max(500).optional(),
  yearsOfExperience: z.number().min(0).max(60).optional(),
  resumeUploaded: z.boolean().optional(),
  isCommunicationVerified: z.boolean().optional(),
});

/** User sync: role accepted but only honored on insert (see auth.routes.js). */
export const syncUserBody = z.object({
  uid: uidParam,
  email: emailField,
  displayName: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(50).optional(),
  photoURL: z.string().trim().max(1000).optional(),
  role: userRoleEnum.optional(),
});

/** Create job: required title/company/location + bounded optional fields. */
export const createJobBody = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(200),
  salary: z.union([z.string().trim().max(100), z.number()]).optional(),
  skills: z.array(z.string().trim().max(100)).max(50).optional(),
  salaryRange: z.string().trim().max(100).optional(),
  experienceLevel: z.string().trim().max(100).optional(),
  employmentType: z.string().trim().max(100).optional(),
  posted: z.string().trim().max(100).optional(),
  postedBy: uidParam.optional(),
  description: z.string().trim().max(10000).optional(),
  responsibilities: z.array(z.string().trim().max(1000)).max(50).optional(),
  requirements: z.array(z.string().trim().max(1000)).max(50).optional(),
  niceToHaveSkills: z.array(z.string().trim().max(100)).max(50).optional(),
  vacancies: z.union([z.number().int().min(0).max(10000), z.string().trim().max(10), z.null()]).optional(),
  deadline: z.union([z.string().trim().max(50), z.null()]).optional(),
});

/** Apply to job: uid + email required, snapshot fields optional. */
export const applyJobBody = z.object({
  uid: uidParam,
  email: emailField,
  jobTitle: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
});

/** Skill test generate: candidateId + skills (or single skill) required. */
export const skillTestGenerateBody = z
  .object({
    candidateId: uidParam,
    skills: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    skill: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => (data.skills && data.skills.length > 0) || data.skill, {
    message: "skills array or single skill is required",
    path: ["skills"],
  });

/** Skill test submit: testId (ObjectId) + candidateId + answers[] required. */
export const skillTestSubmitBody = z.object({
  testId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "testId must be a valid MongoDB ObjectId"),
  candidateId: uidParam,
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(100),
        answer: z.string().trim().max(5000),
      }),
    )
    .max(100),
});

/** Application status update (shared by PUT + PATCH handlers). */
export const applicationStatusBody = z.object({
  status: applicationStatusEnum,
  feedback: z.string().trim().max(2000).optional(),
  recruiterNote: z.string().trim().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────
// Full route schemas (params + body / query)
// ─────────────────────────────────────────────────────────────

/** GET /api/admin/users query. */
export const adminUsersQuery = z.object({
  search: searchQuery.optional().default(""),
  role: userRoleEnum.or(z.literal("")).optional().default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/jobs/:id/fit query. */
export const jobFitQuery = z.object({
  uid: uidParam,
});

/** POST /api/applications/:id/recalculate query — uid of the recruiter/admin. */
export const applicationRecalculateQuery = z.object({
  uid: uidParam,
});

/** Params: { id } where id is an ObjectId. */
export const objectIdParamSchema = z.object({ id: objectIdParam });

/** Params: { uid } — Firebase UID path param. */
export const uidParamSchema = z.object({ uid: uidParam });

/** Params: { jobId } — ObjectId path param (pre-apply check). */
export const jobIdParamSchema = z.object({ jobId: objectIdParam });

// ─────────────────────────────────────────────────────────────
// Recruiter copilot (Phase 3 — PLAN §4.7, recommendation-only drafts)
// ─────────────────────────────────────────────────────────────

/** POST /api/copilot/pipeline-summary — recruiter uid + optional job scope. */
export const pipelineSummaryBody = z.object({
  uid: uidParam,
  jobId: objectIdParam.optional(),
});

/** POST /api/copilot/outreach-draft — one draft for one application. */
export const outreachDraftBody = z.object({
  uid: uidParam,
  applicationId: objectIdParam,
  tone: z.enum(["warm", "professional", "enthusiastic"]).optional(),
});

/** POST /api/copilot/interview-questions — job-scoped, candidate optional. */
export const interviewQuestionsBody = z.object({
  uid: uidParam,
  jobId: objectIdParam,
  applicationId: objectIdParam.optional(),
});
