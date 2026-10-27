// lib/billingSchemas.js — Zod bodies for the billing endpoints.
import { z } from "zod";

export const checkoutBody = z.object({
  planId: z.literal("pro", {
    message: "Only the 'pro' plan can be purchased online (recruiter tiers are onboarding via /contact).",
  }),
});

export const creditsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export default { checkoutBody, creditsQuery };
