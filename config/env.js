// config/env.js
// Centralized environment validation and normalization

import "dotenv/config";

function cleanEnvValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

function buildMongoUriFromPieces() {
  const user = cleanEnvValue(process.env.DB_USER);
  const pass = cleanEnvValue(process.env.DB_PASS);
  const host = cleanEnvValue(process.env.DB_HOST);
  const dbName = cleanEnvValue(process.env.DB_NAME);
  const options = cleanEnvValue(process.env.DB_OPTIONS);

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
    cleanEnvValue(process.env.MONGODB_URI) ||
    cleanEnvValue(process.env.MONGO_URI) ||
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

  return {
    env: {
      MONGODB_URI,
      MONGO_DB_NAME:
        cleanEnvValue(process.env.MONGO_DB_NAME) ||
        cleanEnvValue(process.env.DB_NAME) ||
        "skillmatchai",
      NODE_ENV: cleanEnvValue(process.env.NODE_ENV) || "development",
      CORS_ORIGIN: cleanEnvValue(process.env.CORS_ORIGIN) || "",
      PORT: cleanEnvValue(process.env.PORT) || "5000",
      GEMINI_API_KEY: cleanEnvValue(process.env.GEMINI_API_KEY) || "",
    },
    errors,
    warnings,
    firebaseErrors,
    isProd: cleanEnvValue(process.env.NODE_ENV) === "production",
  };
}
