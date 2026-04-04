// config/env.js
// Centralized environment validation and normalization

import "dotenv/config";

function buildMongoUriFromPieces() {
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASS;
  const host = process.env.DB_HOST;
  const dbName = process.env.DB_NAME;
  const options = process.env.DB_OPTIONS;

  if (!user || !pass || !host) return null;

  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(pass);
  const dbSegment = dbName ? `/${dbName}` : "";
  const optionsSegment = options ? `?${options}` : "";

  return `mongodb+srv://${encodedUser}:${encodedPass}@${host}${dbSegment}${optionsSegment}`;
}

export function loadEnv() {
  const errors = [];
  const warnings = [];
  const firebaseErrors = [];

  const MONGODB_URI =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    buildMongoUriFromPieces();

  if (!MONGODB_URI) {
    errors.push(
      "Missing MongoDB connection string. Set MONGODB_URI (preferred) or MONGO_URI, or DB_USER/DB_PASS/DB_HOST.",
    );
  }

  if (process.env.DB_USER && !process.env.DB_PASS) {
    warnings.push("DB_USER is set but DB_PASS is missing.");
  }
  if (process.env.DB_PASS && !process.env.DB_USER) {
    warnings.push("DB_PASS is set but DB_USER is missing.");
  }
  if ((process.env.DB_USER || process.env.DB_PASS) && !process.env.DB_HOST) {
    warnings.push("DB_USER/DB_PASS set but DB_HOST is missing.");
  }

  // Firebase Admin (optional). Used for verifying Firebase ID tokens and RTDB notifications.
  // Prefer FIREBASE_SERVICE_ACCOUNT_JSON in serverless (Vercel) environments.
  const FIREBASE_SERVICE_ACCOUNT_JSON =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_ADMIN_SDK_JSON ||
    "";

  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
  const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "";
  const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || "";
  const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "";

  const hasFirebasePieces =
    Boolean(FIREBASE_PROJECT_ID) &&
    Boolean(FIREBASE_CLIENT_EMAIL) &&
    Boolean(FIREBASE_PRIVATE_KEY);

  if (FIREBASE_SERVICE_ACCOUNT_JSON && hasFirebasePieces) {
    warnings.push(
      "Both FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY are set. FIREBASE_SERVICE_ACCOUNT_JSON will be used.",
    );
  }

  // Only flag errors when some firebase vars are present but incomplete (avoid noisy errors by default).
  const anyFirebaseVars =
    Boolean(FIREBASE_SERVICE_ACCOUNT_JSON) ||
    Boolean(FIREBASE_PROJECT_ID) ||
    Boolean(FIREBASE_CLIENT_EMAIL) ||
    Boolean(FIREBASE_PRIVATE_KEY) ||
    Boolean(FIREBASE_DATABASE_URL);

  if (anyFirebaseVars && !FIREBASE_SERVICE_ACCOUNT_JSON && !hasFirebasePieces) {
    firebaseErrors.push(
      "Firebase Admin config incomplete. Set FIREBASE_SERVICE_ACCOUNT_JSON (recommended) or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
    );
  }

  return {
    env: {
      MONGODB_URI,
      MONGO_DB_NAME:
        process.env.MONGO_DB_NAME || process.env.DB_NAME || "skillmatchai",
      NODE_ENV: process.env.NODE_ENV || "development",
      CORS_ORIGIN: process.env.CORS_ORIGIN || "",
      PORT: process.env.PORT || "5000",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
      FIREBASE_SERVICE_ACCOUNT_JSON,
      FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY,
      FIREBASE_DATABASE_URL,
    },
    errors,
    warnings,
    firebaseErrors,
    isProd: process.env.NODE_ENV === "production",
  };
}
