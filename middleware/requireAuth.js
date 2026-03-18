// middleware/requireAuth.js
// Verifies Firebase ID token from Authorization header and attaches user to req

import admin from "firebase-admin";
import { getFirebaseService } from "../services/firebaseService.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthenticated: No token provided" 
      });
    }

    const token = authHeader.split(" ")[1];
    
    // Ensure firebase admin is initialized
    getFirebaseService(); 
    
    const decoded = await admin.auth().verifyIdToken(token);
    
    // Attach user info to request
    req.user = { 
      uid: decoded.uid, 
      email: decoded.email,
      email_verified: decoded.email_verified
    };
    
    next();
  } catch (err) {
    console.error("Auth Middleware Error:", err.message);
    return res.status(401).json({ 
      success: false, 
      message: "Unauthenticated: Invalid or expired token" 
    });
  }
}
