import admin from "firebase-admin";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);

const globalCache = globalThis.__firebaseService || { service: null };
globalThis.__firebaseService = globalCache;

export function getFirebaseService() {
  if (globalCache.service) return globalCache.service;

  try {
    // Try to initialize with environment variables first
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID || "",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || "",
      };

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
        });
      }
    } else {
      // Fallback to JSON file
      let serviceAccount;
      try {
        serviceAccount = _require("../jobmatching-firebase-adminsdk-.json");
      } catch (e) {
        console.warn("Firebase Admin SDK not configured. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL in .env, or provide jobmatching-firebase-adminsdk-.json file.");
        return null;
      }

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
        });
      }
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
    console.error("Firebase Admin init error:", err);
    return null;
  }
}
