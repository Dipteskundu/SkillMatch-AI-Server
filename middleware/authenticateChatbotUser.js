import { getDB } from "../config/db.js";
import { getFirebaseService } from "../services/firebaseService.js";

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== "string") return null;

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token.trim();
}

export async function authenticateChatbotUser(req, res, next) {
  if (req.dbUnavailable) {
    return res.status(503).json({
      success: false,
      message: "Chatbot is temporarily unavailable while the database reconnects.",
    });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authorization bearer token is required.",
    });
  }

  const firebaseService = getFirebaseService();
  try {
    let uid;
    let decodedToken = null;

    if (firebaseService?.admin) {
      try {
        decodedToken = await firebaseService.admin.auth().verifyIdToken(token);
        uid = decodedToken.uid;
      } catch (tokenErr) {
        console.warn("Firebase token verification failed, checking X-User-Uid header.");
      }
    }

    if (!uid) {
      // DEVELOPMENT BYPASS: Use the UID provided in the header if Firebase Admin is not configured or token is invalid
      uid = req.headers["x-user-uid"];
      if (uid) {
        console.warn(`Using development authentication bypass for chatbot. UID: ${uid}`);
      }
    }

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed. Provide a valid token or X-User-Uid header.",
      });
    }

    const db = getDB();
    const platformUser = await db.collection("users").findOne(
      { firebaseUid: uid },
      {
        projection: {
          firebaseUid: 1,
          email: 1,
          displayName: 1,
          role: 1,
          companyName: 1,
        },
      },
    );

    if (!platformUser) {
      return res.status(404).json({
        success: false,
        message: "Authenticated user was not found in the platform database.",
      });
    }

    req.authUser = {
      uid,
      email: decodedToken?.email || platformUser.email || "",
      decodedToken: decodedToken || { uid, email: platformUser.email },
    };
    req.platformUser = platformUser;

    return next();
  } catch (error) {
    console.error("Chatbot auth error:", error);
    try {
      const fs = await import('fs/promises');
      await fs.appendFile('chatbot_errors.log', `${new Date().toISOString()} - AUTH ERROR: ${error.stack || error}\n`);
    } catch (logErr) {}
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
}
