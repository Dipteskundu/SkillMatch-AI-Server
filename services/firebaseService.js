import { createRequire } from "module";
import { loadEnv } from "../config/env.js";

const require = createRequire(import.meta.url);
let admin = null;
try {
  admin = require("firebase-admin");
} catch (error) {
  admin = null;
}

const globalCache = globalThis.__firebaseService || {
  service: null,
};

globalThis.__firebaseService = globalCache;

function buildDatabaseUrl(serviceAccount) {
  const projectId = serviceAccount?.project_id;
  if (!projectId) return null;
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

export function getFirebaseService() {
  if (globalCache.service) return globalCache.service;

  if (!admin) {
    console.warn(
      "Firebase Admin not installed. Firebase features are disabled. Add firebase-admin to enable."
    );
    return null;
  }

  const { env, firebaseErrors } = loadEnv();
  const hasFirebaseError = firebaseErrors.some((e) =>
    e.includes("FIREBASE_SERVICE_ACCOUNT")
  );

  if (hasFirebaseError) {
    console.error("Firebase Admin disabled due to invalid FIREBASE_SERVICE_ACCOUNT.");
    return null;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn("Firebase Admin disabled: FIREBASE_SERVICE_ACCOUNT not set.");
    return null;
  }

  if (!admin.apps.length) {
    const databaseURL = buildDatabaseUrl(env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(env.FIREBASE_SERVICE_ACCOUNT),
      ...(databaseURL ? { databaseURL } : {}),
    });
  }

  const db = admin.database();

  async function sendNotification(userId, notification) {
    try {
      const ref = db.ref(`notifications/${userId}`).push();
      const fullNotification = {
        id: ref.key,
        ...notification,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        read: false,
      };
      await ref.set(fullNotification);
      console.log(`Real-time notification sent to user ${userId}`);
    } catch (error) {
      console.error("Firebase sendNotification error:", error);
    }
  }

  async function updateApplicantCount(jobId, count) {
    try {
      const ref = db.ref(`jobApplicants/${jobId}`);
      await ref.set({ count });
      console.log(`Updated applicant count for job ${jobId} to ${count}`);
    } catch (error) {
      console.error("Firebase updateApplicantCount error:", error);
    }
  }

  globalCache.service = {
    admin,
    db,
    sendNotification,
    updateApplicantCount,
  };

  return globalCache.service;
}
