import admin from "firebase-admin";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);

const globalCache = globalThis.__firebaseService || { service: null };
globalThis.__firebaseService = globalCache;

export function getFirebaseService() {
  if (globalCache.service) return globalCache.service;

  try {
    const serviceAccount = _require("../jobmatching-firebase-adminsdk-.json");
    const databaseURL = `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL,
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
    console.error("Firebase Admin init error:", err);
    return null;
  }
}
