// tests/billing.test.js — Phase 5 Stripe billing + metered credits.
// Stripe is mocked (no network); all tests work with OR without env keys —
// the unconfigured path is asserted explicitly.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../config/db.js", () => ({
  connectDB: vi.fn(async () => {}),
  getDB: vi.fn(() => globalThis.__testDb),
}));

vi.mock("../config/mongoose.js", () => ({
  connectMongoose: vi.fn(async () => null),
  syncAllIndexes: vi.fn(async () => ({ total: 0, synced: 0, failed: [] })),
}));

vi.mock("../services/firebaseService.js", () => ({
  getFirebaseService: vi.fn(() => null),
}));

// Stripe SDK fully mocked — behaviour driven via globalThis.__stripe.
vi.mock("stripe", () => ({
  default: class FakeStripe {
    constructor() {
      this.checkout = {
        sessions: {
          create: async (args) => globalThis.__stripe.createSession(args),
        },
      };
      this.billingPortal = {
        sessions: {
          create: async (args) => globalThis.__stripe.portalSession(args),
        },
      };
      this.subscriptions = {
        retrieve: async (id) => globalThis.__stripe.retrieveSub(id),
      };
      this.webhooks = {
        constructEvent: (body, sig) => {
          if (sig !== "valid-sig") throw new Error("bad signature");
          return JSON.parse(String(body));
        },
      };
    }
  },
}));

vi.mock("../models/index.js", async () => {
  const { makeFakeModel } = await import("./fixtures/fakeModels.js");
  return {
    Technology: makeFakeModel("technologies"),
    LearningPath: makeFakeModel("learning_paths"),
    UserProgress: makeFakeModel("user_progress"),
    Certificate: makeFakeModel("certificates"),
    User: makeFakeModel("users"),
    Job: makeFakeModel("find_jobs"),
    Skill: makeFakeModel("skills"),
    ApiKey: makeFakeModel("api_keys"),
    AuditLog: makeFakeModel("audit_logs"),
    Subscription: makeFakeModel("subscriptions"),
    CreditLedger: makeFakeModel("credit_ledger"),
    generateVerifiableCode: () => "vc-static-code-1",
  };
});

import app from "../api/index.js";
import { getBalance, spend, grant } from "../services/creditService.js";
import { getFakeDocs, resetFakeStore, makeFakeRawDb } from "./fixtures/fakeModels.js";

const UID = "user-uid-1";

function tokenFor(uid = UID) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid, email: `${uid}@test.dev` })).toString("base64");
  return `header.${payload}.signature`;
}

function authed(method, url, body) {
  const req = request(app)[method](url).set("Authorization", `Bearer ${tokenFor()}`);
  return body === undefined ? req : req.send(body);
}

const STRIPE_VARS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTHLY"];

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeStore();
  for (const v of STRIPE_VARS) delete process.env[v];
  delete process.env.CREDIT_ENFORCEMENT;
  process.env.FREE_MONTHLY_AI_CREDITS = "20";
  process.env.PRO_MONTHLY_AI_CREDITS = "500";

  globalThis.__testDb = makeFakeRawDb();
  getFakeDocs("users").push({ firebaseUid: UID, email: `${UID}@test.dev`, role: "candidate", plan: "free" });
  globalThis.__stripe = {
    createSession: async () => ({ url: "https://stripe.test/checkout/cs_1" }),
    portalSession: async () => ({ url: "https://stripe.test/portal/bp_1" }),
    retrieveSub: async () => ({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: { data: [{ price: { id: "price_pro" } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      cancel_at_period_end: false,
      metadata: { userId: UID },
    }),
  };
});

afterEach(() => {
  for (const v of STRIPE_VARS) delete process.env[v];
  delete process.env.CREDIT_ENFORCEMENT;
});

describe("GET /api/billing/plans (public)", () => {
  it("reports configured:false with no Stripe keys", async () => {
    const res = await request(app).get("/api/billing/plans");
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.plans.map((p) => p.id)).toEqual(["free", "pro"]);
    expect(res.body.data.plans[0].price).toBe(0);
  });

  it("reports configured:true when keys exist (price id included)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_abc";
    const res = await request(app).get("/api/billing/plans");
    expect(res.body.data.configured).toBe(true);
    const pro = res.body.data.plans.find((p) => p.id === "pro");
    expect(pro.priceId).toBe("price_abc");
    expect(pro.price).toEqual({ amount: 1900, currency: "usd", interval: "month" });
  });
});

describe("POST /api/billing/checkout", () => {
  it("503s BILLING_NOT_CONFIGURED when Stripe keys are absent", async () => {
    const res = await authed("post", "/api/billing/checkout", { planId: "pro" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");
  });

  it("400s on non-pro plan ids (recruiter tiers are onboarding-only)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
    const res = await authed("post", "/api/billing/checkout", { planId: "starter" });
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ planId: "pro" });
    expect(res.status).toBe(401);
  });

  it("returns a Stripe checkout URL when configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
    const res = await authed("post", "/api/billing/checkout", { planId: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe("https://stripe.test/checkout/cs_1");
    expect(globalThis.__stripe.createSession).toBeDefined();
  });
});

describe("GET /api/billing/subscription + credits", () => {
  it("defaults to free with the monthly grant applied exactly once", async () => {
    const first = await authed("get", "/api/billing/subscription");
    expect(first.status).toBe(200);
    expect(first.body.data.plan).toBe("free");
    expect(first.body.data.credits.monthlyGrant).toBe(20);
    expect(first.body.data.credits.balance).toBe(20);

    const second = await authed("get", "/api/billing/subscription");
    expect(second.body.data.credits.balance).toBe(20); // no double grant
    expect(getFakeDocs("credit_ledger").filter((l) => l.reason.startsWith("grant:"))).toHaveLength(1);
  });

  it("gives pro users the larger grant", async () => {
    getFakeDocs("users")[0].plan = "pro";
    const res = await authed("get", "/api/billing/subscription");
    expect(res.body.data.plan).toBe("pro");
    expect(res.body.data.credits.monthlyGrant).toBe(500);
    expect(res.body.data.credits.balance).toBe(500);
  });

  it("returns credit ledger history", async () => {
    await authed("get", "/api/billing/subscription"); // seed grant
    await grant(UID, 5, "purchase:test", "free");
    const res = await authed("get", "/api/billing/credits");
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(25);
    expect(res.body.data.recent.length).toBeGreaterThanOrEqual(2);
  });
});

describe("credit enforcement", () => {
  it("blocks spending beyond balance when CREDIT_ENFORCEMENT=ai", async () => {
    process.env.FREE_MONTHLY_AI_CREDITS = "0";
    process.env.CREDIT_ENFORCEMENT = "ai";
    const bal = await getBalance(UID, "free");
    expect(bal).toBe(0);
    const denied = await spend(UID, 1, "spend:test");
    expect(denied.ok).toBe(false);
    expect(denied.balance).toBe(0);
  });

  it("records but never blocks while enforcement is off (default)", async () => {
    process.env.FREE_MONTHLY_AI_CREDITS = "0";
    const result = await spend(UID, 5, "spend:test");
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(-5); // ledger stays truthful
  });
});

describe("POST /api/billing/webhook (raw body + signature)", () => {
  function postEvent(event, sig = "valid-sig") {
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", sig)
      .send(JSON.stringify(event));
  }

  it("503s without webhook secret configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const res = await postEvent({ type: "customer.subscription.updated" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");
  });

  it("400s on a bad signature", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const res = await postEvent({ type: "customer.subscription.updated" }, "wrong");
    expect(res.status).toBe(400);
  });

  it("activates plan on customer.subscription.updated (active → pro)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";

    const res = await postEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_9",
          customer: "cus_9",
          status: "active",
          items: { data: [{ price: { id: "price_pro" } }] },
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
          metadata: { userId: UID },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const sub = getFakeDocs("subscriptions")[0];
    expect(sub.plan).toBe("pro");
    expect(sub.status).toBe("active");
    expect(getFakeDocs("users")[0].plan).toBe("pro");
  });

  it("downgrades on customer.subscription.deleted", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    getFakeDocs("users")[0].plan = "pro";

    const res = await postEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_9", customer: "cus_9", status: "canceled", metadata: { userId: UID } } },
    });
    expect(res.status).toBe(200);
    expect(getFakeDocs("users")[0].plan).toBe("free");
    expect(getFakeDocs("subscriptions")[0].plan).toBe("free");
  });

  it("retrieves the subscription on checkout.session.completed", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";

    const res = await postEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: { userId: UID },
        },
      },
    });
    expect(res.status).toBe(200);
    const sub = getFakeDocs("subscriptions")[0];
    expect(sub.stripeSubscriptionId).toBe("sub_1");
    expect(sub.plan).toBe("pro");
    expect(sub.priceId).toBe("price_pro");
  });

  it("acknowledges unknown event types (no-op 200)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const res = await postEvent({ type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
