// lib/publicApiSchemas.js — Zod query/param schemas for the public API + admin keys.
import { z } from "zod";

export const jobsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  skills: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    ),
  employmentType: z.enum(["full-time", "part-time", "contract", "internship"]).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const apiKeyBody = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  rateLimitPerMin: z.coerce.number().int().min(1).max(10000).optional(),
});

export const objectIdParam = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "invalid id") });

export default { jobsQuery, apiKeyBody, objectIdParam };
