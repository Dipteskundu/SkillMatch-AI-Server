import "../config/dotenv.js";
import express from "express";
import cors from "cors";

import { connectDB, getDB } from "../config/db.js";
import { loadEnv } from "../config/env.js";
import { migrateDemoPasswords } from "../services/passwordMigration.js";

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
import learningRoutes from "../routes/learning.routes.js";
import { ensureLearningIndexes } from "../config/learningIndexes.js";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/recruiterGate.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Learning Hub indexes: create once per process, after the first successful
// connection, without blocking boot on failure.
let indexPromise = null;
function ensureIndexesOnce() {
  if (!indexPromise) {
    indexPromise = ensureLearningIndexes(getDB()).catch((error) => {
      console.warn("Learning Hub index setup skipped:", error.message);
    });
  }
  return indexPromise;
}

const { env, errors, warnings, isProd } = loadEnv();

if (warnings.length) {
  warnings.forEach((msg) => console.warn(`ENV WARN: ${msg}`));
}
if (errors.length) {
  errors.forEach((msg) =>
    (isProd ? console.error : console.warn)(`ENV ERROR: ${msg}`),
  );
}

const hasFatalEnv = errors.length > 0;

const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : null;

const localhostOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server or same-origin requests (no Origin header)
      if (!origin) return callback(null, true);
      // Local dev convenience: allow localhost / 127.0.0.1 on any port
      if (!isProd && localhostOrigin.test(origin)) {
        return callback(null, true);
      }
      // If no allowlist specified, allow all
      if (!corsOrigins) return callback(null, true);
      // Otherwise, enforce allowlist
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

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
    await ensureIndexesOnce();
    await migrateDemoPasswords(getDB());
    return next();
  } catch (error) {
    error.status = error.status || 500;
    return next(error);
  }
});

// Everything under /api needs a JWT except the guest-browsable reads below.
const PUBLIC_GET = [
  /^\/jobs$/,
  /^\/jobs\/[^/]+$/,
  /^\/jobs\/[^/]+\/fit$/,
  /^\/companies$/,
  /^\/v1\/companies$/,
  /^\/v1\/learning\/paths$/,
  /^\/v1\/learning\/paths\/[^/]+$/,
  /^\/v1\/assessments$/,
];

const ADMIN_ONLY = [/^\/admin\//, /^\/dashboard\/admin$/, /^\/v1\/admin\//];

app.use("/api", (req, res, next) => {
  const path = req.path.replace(/\/+$/, "") || "/";

  if (req.method === "POST" && ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(path)) {
    return next();
  }
  if (req.method === "GET" && PUBLIC_GET.some((re) => re.test(path))) {
    return next();
  }

  return verifyToken(req, res, () => {
    if (ADMIN_ONLY.some((re) => re.test(path))) return requireAdmin(req, res, next);
    return next();
  });
});

app.use("/api/auth", authRoutes);
app.use(jobsRoutes);
app.use(companiesRoutes);
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
app.use(learningRoutes);

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
