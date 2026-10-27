import "../config/dotenv.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import { connectDB } from "../config/db.js";
import { connectMongoose } from "../config/mongoose.js";
import { loadEnv } from "../config/env.js";

import jobsRoutes from "../routes/jobs.routes.js";
import companiesRoutes from "../routes/companies.routes.js";
import authRoutes from "../routes/auth.routes.js";
import dashboardRoutes from "../routes/dashboard.routes.js";
import communicationRoutes from "../routes/communication.routes.js";
import transparencyRoutes from "../routes/transparency.routes.js";
import skillTestRoutes from "../routes/skillTest.routes.js";
import resumeRoutes from "../routes/resume.routes.js";
import skillGapRoutes from "../routes/skillGapRoutes.js";
import preApplyRoutes from "../routes/preApply.routes.js";
import commVerificationRoutes from "../routes/commVerification.routes.js";
import applicationsRoutes from "../routes/applications.routes.js";
import interviewsRoutes from "../routes/interviews.routes.js";
import notificationsRoutes from "../routes/notifications.routes.js";
import chatbotRoutes from "../routes/chatbot.routes.js";
import tasksRoutes from "../routes/tasks.routes.js";
import { registerWorker } from "../services/queue.js";
import { resumeExtractHandler } from "../services/resumePipeline.js";
import jobGenRoutes from "../routes/jobGen.routes.js";
import copilotRoutes from "../routes/copilot.routes.js";
import learningRoutes from "../routes/learning.routes.js";
import adminLearningRoutes from "../routes/adminLearning.routes.js";
import billingRoutes, { webhookHandler } from "../routes/stripe.routes.js";
import publicApiRoutes from "../routes/publicApi.routes.js";
import adminApiKeysRoutes from "../routes/adminApiKeys.routes.js";
import complianceRoutes from "../routes/compliance.routes.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security headers (helmet). Keep CSP off — this is a JSON API, and the few
// HTML pages under /public don't need a restrictive CSP to be safe here.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const { env, errors, warnings, firebaseErrors, isProd } = loadEnv();

if (warnings.length) {
  warnings.forEach((msg) => console.warn(`ENV WARN: ${msg}`));
}
if (firebaseErrors.length) {
  firebaseErrors.forEach((msg) => console.warn(`ENV FIREBASE: ${msg}`));
}
if (errors.length) {
  errors.forEach((msg) =>
    (isProd ? console.error : console.warn)(`ENV ERROR: ${msg}`),
  );
}

const hasFatalEnv = errors.length > 0;

// Mongoose schema/index layer: fire-and-forget at startup (covers index.js and
// the Vercel entrypoint). Existing routes keep using the raw MongoDB driver —
// if Mongoose fails to connect, it logs and every route behaves as before.
connectMongoose();

const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : null;

const localhostOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// CORS: only allowlist is enforced when CORS_ORIGIN is set. When it is NOT set
// in production we no longer allow-all *silently* — we warn. On Vercel the
// frontend proxies via rewrites, so CORS isn't needed there; off Vercel you
// should set CORS_ORIGIN explicitly.
if (isProd && !corsOrigins && !process.env.VERCEL) {
  console.warn(
    "CORS WARN: CORS_ORIGIN is not set in production — cross-origin requests " +
      "are currently allowed from any origin. Set CORS_ORIGIN to a comma-separated " +
      "allowlist (e.g. https://your-frontend.vercel.app).",
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server or same-origin requests (no Origin header)
      if (!origin) return callback(null, true);

      // Local dev convenience: allow localhost / 127.0.0.1 on any port
      if (!isProd && localhostOrigin.test(origin)) {
        return callback(null, true);
      }

      // If no allowlist specified, allow all (with a startup warning in prod)
      if (!corsOrigins) return callback(null, true);

      // Otherwise, enforce allowlist
      if (corsOrigins.includes(origin)) return callback(null, true);

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false,
  }),
);

// Stripe webhook MUST see the raw body for signature verification, so it is
// mounted before the JSON body parser consumes the stream.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ────────────────────────────────────────────────────────────
// Global limiter: generous, mostly to blunt scripted abuse. Health/uptime
// probes are exempt so they never trip it.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/" || req.path === "/health",
  message: { success: false, message: "Too many requests. Please try again later." },
});
app.use(globalLimiter);

// Strict limiter on AI endpoints — each call burns Gemini quota.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many AI requests. Please wait a few minutes and try again.",
  },
});
app.use(
  [
    "/api/skill-test/generate",
    "/api/communication",
    "/api/verification/communication",
    "/api/resume/upload",
    "/api/chatbot/ask",
    "/api/jobs/generate-draft",
    "/api/copilot/pipeline-summary",
    "/api/copilot/outreach-draft",
    "/api/copilot/interview-questions",
    // Phase 4: SkillForge content generation burns LLM quota like any AI endpoint.
    "/api/admin/learning/paths/:pathId/generate",
  ],
  aiLimiter,
);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    service: "JobMatch-AI-Server",
    envOk: !hasFatalEnv,
    warnings: !isProd ? warnings : undefined,
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use(async (req, res, next) => {
  if (hasFatalEnv) {
    return res.status(500).json({
      success: false,
      message: "Server is misconfigured. Check environment variables.",
      errors: !isProd ? errors : undefined,
    });
  }

  try {
    await connectDB();
    return next();
  } catch (error) {
    error.status = error.status || 500;
    return next(error);
  }
});

app.use(jobsRoutes);
app.use(companiesRoutes);
app.use(authRoutes);
app.use(dashboardRoutes);
app.use(communicationRoutes);
app.use(transparencyRoutes);
app.use(skillTestRoutes);
app.use(resumeRoutes);
app.use(skillGapRoutes);
app.use(preApplyRoutes);
app.use(commVerificationRoutes);
app.use(applicationsRoutes);
app.use(interviewsRoutes);
app.use(notificationsRoutes);
app.use(chatbotRoutes);
app.use(tasksRoutes);

// Phase 3: async resume pipeline worker (in-process queue, no Redis).
registerWorker("resume.extract", resumeExtractHandler);
app.use(jobGenRoutes);
app.use(copilotRoutes);

// Stripe subscriptions + metered credits (Phase 5) — env-gated billing router.
app.use("/api/billing", billingRoutes);

// Phase 5: public REST API (API-key auth) + admin key management + compliance.
app.use("/api/public/v1", publicApiRoutes);
app.use(adminApiKeysRoutes);
app.use(complianceRoutes);

// Phase 4: SkillForge Learning Hub (learner + admin content pipeline routes).
app.use(learningRoutes);
app.use(adminLearningRoutes);


app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload.",
    });
  }

  const status = err.status || 500;
  console.error("Unhandled error:", err);
  res.status(status).json({
    success: false,
    message: status === 500 ? "Internal server error" : err.message,
    error: !isProd ? err.message : undefined,
    stack: !isProd ? err.stack : undefined,
  });
});

export default app;
