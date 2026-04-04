import { getFirebaseService } from "../services/firebaseService.js";
import { getDB } from "../config/db.js";

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }

    const token = authHeader.split(" ")[1];
    
    // Using Firebase Admin to verify the JWT
    const firebaseService = getFirebaseService();
    if (!firebaseService || !firebaseService.admin) {
      return res.status(500).json({
        success: false,
        message:
          "Server configuration error: Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON (recommended) or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY on the backend.",
      });
    }

    const decodedToken = await firebaseService.admin.auth().verifyIdToken(token);
    
    // Fetch user from DB to attach role
    const db = getDB();
    const user = await db.collection("users").findOne({ firebaseUid: decodedToken.uid });
    
    req.user = {
      uid: decodedToken.uid,
      email: user?.email || decodedToken.email || "",
      role: user?.role || "candidate",
    };

    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid Token" });
  }
};
