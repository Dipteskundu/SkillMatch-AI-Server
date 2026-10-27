// routes/stripe.routes.js — Stripe subscriptions + metered credits (Phase 5).
// ─────────────────────────────────────────────────────────────────────────────
// Everything here is ENV-GATED: with no STRIPE_SECRET_KEY the router still
// mounts, `GET /plans` reports `configured:false`, and paid actions return a
// structured 503 BILLING_NOT_CONFIGURED — the server never crashes on missing
// Stripe config and the UI can be honest about it.
//
// Mounted at /api/billing. The webhook handler is exported separately so the
// app can mount it with express.raw() BEFORE express.json() (Stripe signs the
// raw body).
//
//   GET  /plans        (public)  → configured flag + plan cards
//   GET  /subscription (auth)    → local subscription + credits
//   POST /checkout     (auth)    → Stripe Checkout URL (pro)
//   POST /portal       (auth)    → Stripe customer portal URL
//   GET  /credits      (auth)    → balance + recent ledger
//   POST /webhook      (raw)     → signature-verified state sync
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import Stripe from "stripe";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { checkoutBody, creditsQuery } from "../lib/billingSchemas.js";
import { Subscription, User } from "../models/index.js";
import { getBalance, recent } from "../services/creditService.js";

const router = Router();

// ── Lazy Stripe init ─────────────────────────────────────────────────────────

let stripeClient = null;

export function isBillingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!isBillingConfigured()) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
    });
  }
  return stripeClient;
}

function notConfigured(res) {
  return res.status(503).json({
    success: false,
    message: "Billing is not configured yet (payments coming soon).",
    error: { code: "BILLING_NOT_CONFIGURED" },
  });
}

function frontendBase() {
  return (
    process.env.PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000"
  );
}

// ── Plan catalog (single source of truth for the pricing page) ───────────────

export function planCatalog() {
  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY || null;
  return [
    {
      id: "free",
      name: "Free",
      price: 0,
      features: [
        "Profile + resume skill extraction",
        "Job matches with explainable Hiring Fit Score",
        "Skill gap analysis",
        "1 active learning path, 3 lessons/day",
        "Micro-assessments",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      price: { amount: 1900, currency: "usd", interval: "month" },
      priceId: proPriceId,
      features: [
        "Everything in Free",
        "Unlimited learning paths + certificates",
        "Unlimited lessons (no daily cap)",
        "Monthly AI credit grant",
      ],
    },
  ];
}

// ── GET /plans — public (pricing page for guests) ────────────────────────────

router.get("/plans", (req, res) => {
  res.json({
    success: true,
    data: { configured: isBillingConfigured(), plans: planCatalog() },
  });
});

// ── GET /subscription — auth ─────────────────────────────────────────────────

router.get("/subscription", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    let sub = null;
    try {
      sub = await Subscription.findOne({ userId }).lean();
    } catch {
      sub = null;
    }

    let plan = sub?.plan === "pro" ? "pro" : "free";
    // Fall back to users.plan (single source of truth for entitlements).
    try {
      const user = await User.findOne({ firebaseUid: userId })
        .select("plan")
        .lean();
      if (user?.plan === "pro") plan = "pro";
    } catch {
      /* keep sub-derived plan */
    }

    const balance = await getBalance(userId, plan);

    res.json({
      success: true,
      data: {
        plan,
        status: sub?.status || "active",
        currentPeriodEnd: sub?.currentPeriodEnd || null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd || false,
        configured: isBillingConfigured(),
        credits: {
          balance,
          monthlyGrant:
            plan === "pro"
              ? Number(process.env.PRO_MONTHLY_AI_CREDITS) || 500
              : Number(process.env.FREE_MONTHLY_AI_CREDITS) || 20,
        },
      },
    });
  } catch (err) {
    console.error("subscription read failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not read subscription." });
  }
});

// ── POST /checkout — auth ────────────────────────────────────────────────────

router.post("/checkout", verifyToken, validate(checkoutBody), async (req, res) => {
  if (!isBillingConfigured()) return notConfigured(res);

  const stripe = getStripe();
  try {
    const userId = req.user.uid;
    const email = req.user.email || undefined;
    const priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
    if (!priceId) {
      return res.status(503).json({
        success: false,
        message: "Billing price is not configured yet.",
        error: { code: "BILLING_NOT_CONFIGURED" },
      });
    }

    // Reuse the Stripe customer when we already have one.
    let customerId;
    try {
      const existing = await Subscription.findOne({ userId })
        .select("stripeCustomerId")
        .lean();
      customerId = existing?.stripeCustomerId || undefined;
    } catch {
      customerId = undefined;
    }

    const base = frontendBase();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      customer_email: customerId ? undefined : email,
      success_url: `${base}/dashboard/learning?billing=success`,
      cancel_url: `${base}/pricing?billing=cancelled`,
      client_reference_id: userId,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    res.json({ success: true, data: { url: session.url } });
  } catch (err) {
    console.error("checkout failed:", err?.message || err);
    res.status(502).json({
      success: false,
      message: "Could not start checkout. Please try again.",
      error: !process.env.VERCEL ? { code: "STRIPE_ERROR" } : undefined,
    });
  }
});

// ── POST /portal — auth ──────────────────────────────────────────────────────

router.post("/portal", verifyToken, async (req, res) => {
  if (!isBillingConfigured()) return notConfigured(res);

  const stripe = getStripe();
  try {
    const userId = req.user.uid;
    let customerId;
    try {
      const existing = await Subscription.findOne({ userId })
        .select("stripeCustomerId")
        .lean();
      customerId = existing?.stripeCustomerId;
    } catch {
      customerId = null;
    }
    if (!customerId) {
      return res.status(404).json({
        success: false,
        message: "No billing account yet — subscribe first.",
        error: { code: "NO_CUSTOMER" },
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${frontendBase()}/dashboard/learning`,
    });
    res.json({ success: true, data: { url: session.url } });
  } catch (err) {
    console.error("portal failed:", err?.message || err);
    res.status(502).json({ success: false, message: "Could not open billing portal." });
  }
});

// ── GET /credits — auth ──────────────────────────────────────────────────────

router.get("/credits", verifyToken, validate(creditsQuery, "query"), async (req, res) => {
  try {
    const userId = req.user.uid;
    const plan = req.user.plan === "pro" ? "pro" : "free";
    const balance = await getBalance(userId, plan);
    const entries = await recent(userId, req.query.limit || 20);
    res.json({
      success: true,
      data: {
        balance,
        recent: entries.map((e) => ({ delta: e.delta, reason: e.reason, at: e.at })),
      },
    });
  } catch (err) {
    console.error("credits read failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not read credits." });
  }
});

// ── Webhook (raw body; mounted before express.json by api/index.js) ──────────

async function upsertFromStripeSub(sub) {
  const userId = sub.metadata?.userId;
  if (!userId && !sub.client_reference_id) return { ok: false };

  const uid = userId || sub.client_reference_id;
  const statusMap = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    incomplete: "incomplete",
    unpaid: "past_due",
    incomplete_expired: "canceled",
  };
  const status = statusMap[sub.status] || "incomplete";
  const plan = status === "active" || status === "trialing" ? "pro" : "free";

  try {
    await Subscription.updateOne(
      { userId: uid },
      {
        $set: {
          userId: uid,
          stripeCustomerId: sub.customer || null,
          stripeSubscriptionId: sub.id || null,
          status,
          priceId: sub.items?.data?.[0]?.price?.id || "",
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          plan,
        },
      },
      { upsert: true },
    );
    await User.updateOne({ firebaseUid: uid }, { $set: { plan } });
    console.log(
      JSON.stringify({ billing: "webhook", uid, status, plan, sub: sub.id }),
    );
    return { ok: true, plan };
  } catch (err) {
    console.error("billing webhook upsert failed:", err?.message || err);
    return { ok: false };
  }
}

export async function webhookHandler(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isBillingConfigured() || !secret) {
    return res.status(503).json({
      success: false,
      error: { code: "BILLING_NOT_CONFIGURED" },
    });
  }

  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    // express.raw gives us a Buffer — Stripe requires the untouched bytes.
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.warn("stripe webhook signature rejected:", err?.message || err);
    return res.status(400).json({ success: false, message: "Invalid signature." });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertFromStripeSub({
            ...sub,
            metadata: { ...sub.metadata, userId: session.metadata?.userId || session.client_reference_id },
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromStripeSub(event.data.object);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          await Subscription.updateOne(
            { stripeSubscriptionId: subId },
            { $set: { status: "past_due" } },
          );
        }
        break;
      }
      default:
        break; // ignored events still get a 200
    }
  } catch (err) {
    console.error("stripe webhook processing failed:", err?.message || err);
    return res.status(500).json({ success: false, message: "Webhook processing error." });
  }

  res.json({ received: true });
}

export default router;
