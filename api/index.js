import "dotenv/config";
import express from "express";
import cors from "cors";
import { URL } from "url";

import { connectDB } from "../config/db.js";
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
import chatbotRoutes from "../routes/chatbot.routes.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const { env, errors, warnings, firebaseErrors, isProd } = loadEnv();

if (warnings.length) {
  warnings.forEach((msg) => console.warn(`ENV WARN: ${msg}`));
}
if (firebaseErrors.length) {
  firebaseErrors.forEach((msg) => console.warn(`ENV FIREBASE: ${msg}`));
}
if (errors.length) {
  errors.forEach((msg) => console.error(`ENV ERROR: ${msg}`));
}

const hasFatalEnv = errors.length > 0;

const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : null;

function isAllowedVercelFrontend(origin) {
  if (!origin) return false;

  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:") return false;

    if (hostname === "hiring-platform-ai.vercel.app") return true;
    if (hostname === "hiring-platform-ai-prosuns-projects.vercel.app")
      return true;

    return /^hiring-platform-[a-z0-9-]+-prosuns-projects\.vercel\.app$/i.test(
      hostname,
    );
  } catch {
    return false;
  }
}

function resolveCorsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (
    !corsOrigins ||
    corsOrigins.includes(origin) ||
    isAllowedVercelFrontend(origin)
  ) {
    callback(null, true);
    return;
  }

  callback(new Error(`CORS blocked for origin: ${origin}`));
}

app.use(
  cors({
    origin: resolveCorsOrigin,
    credentials: false,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/debug-log", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Debug route active",
    time: new Date().toISOString(),
    env: {
      hasGemini: !!process.env.GEMINI_API_KEY,
      port: process.env.PORT,
    }
  });
});

app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "SkillMatch AI API is running." });
});

// Health check — both paths for compatibility
app.get("/health", (req, res) => {
  res.status(200).json({ success: true, status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, status: "ok", timestamp: new Date().toISOString() });
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
    req.dbUnavailable = true;
    console.warn(`DB unavailable for ${req.method} ${req.originalUrl}: ${error.message}`);
    return next();
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
app.use(chatbotRoutes);

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
