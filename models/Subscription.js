// models/Subscription.js
// Phase 5 — Stripe billing. One doc per user mirroring the current Stripe
// subscription state (upserted by the webhook). Absent doc == free plan.

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "trialing",
  "incomplete",
];

const subscriptionSchema = new Schema(
  {
    // Firebase UID (same identity as users.firebaseUid / req.user.uid).
    userId: { type: String, required: true, unique: true, trim: true },
    stripeCustomerId: { type: String, default: null, trim: true },
    stripeSubscriptionId: { type: String, default: null, trim: true },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: "active",
      index: true,
    },
    priceId: { type: String, default: "" },
    // End of the current billing period (from Stripe's current_period_end).
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    // Entitlement tier — kept in sync with users.plan by the webhook.
    plan: { type: String, enum: ["free", "pro"], default: "free" },
  },
  {
    timestamps: true,
    collection: "subscriptions",
  },
);

export const Subscription = models.Subscription || model("Subscription", subscriptionSchema);
