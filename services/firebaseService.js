import admin from "firebase-admin";
import { loadEnv } from "../config/env.js";

const globalCache = globalThis.__firebaseService || {
  service: null,
  warnedMissing: false,
  warnedInit: false,
};
globalThis.__firebaseService = globalCache;

function tryParseServiceAccountJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow base64-encoded JSON for safer env var storage.
  const maybeJson = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

export function getFirebaseService() {
  if (globalCache.service) return globalCache.service;

  try {
    const { env, firebaseErrors, isProd } = loadEnv();

    if (firebaseErrors?.length) {
      if (!globalCache.warnedInit) {
        globalCache.warnedInit = true;
        firebaseErrors.forEach((msg) =>
          console.warn(`ENV FIREBASE: ${msg}`),
        );
      }
      return null;
    }

    const serviceAccount =
      tryParseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
      (env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY
        ? {
            project_id: env.FIREBASE_PROJECT_ID,
            client_email: env.FIREBASE_CLIENT_EMAIL,
            private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          }
        : null);

    if (!serviceAccount) {
      // Firebase is optional for most routes. Avoid noisy startup warnings when not configured.
      return null;
    }

    const databaseURL =
      env.FIREBASE_DATABASE_URL ||
      (serviceAccount.project_id
        ? `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
        : undefined);

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        ...(databaseURL ? { databaseURL } : {}),
      });
    }

    const db = admin.database();

    async function sendNotification(userId, notification) {
      try {
        const ref = db.ref(`notifications/${userId}`).push();
        await ref.set({
          id: ref.key,
          ...notification,
          createdAt: admin.database.ServerValue.TIMESTAMP,
          read: false,
        });
        console.log(`Notification sent to user ${userId}`);
      } catch (err) {
        console.error("Firebase sendNotification error:", err);
      }
    }

    async function updateApplicantCount(jobId, count) {
      try {
        await db.ref(`jobApplicants/${jobId}`).set({ count });
      } catch (err) {
        console.error("Firebase updateApplicantCount error:", err);
      }
    }

    globalCache.service = { admin, db, sendNotification, updateApplicantCount };
    return globalCache.service;
  } catch (err) {
    // If firebase is configured but init fails, surface it once.
    if (!globalCache.warnedInit) {
      globalCache.warnedInit = true;
      console.error("Firebase Admin init error:", err);
    }
    return null;
  }
}
