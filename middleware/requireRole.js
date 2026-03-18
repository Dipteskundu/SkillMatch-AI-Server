// middleware/requireRole.js
// Checks that the authenticated user has one of the required roles from MongoDB

import { getDB } from "../config/db.js";

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.uid) {
        return res.status(401).json({ 
          success: false, 
          message: "Unauthenticated: No user info found in request" 
        });
      }

      const db = getDB();
      const user = await db.collection("users").findOne({ firebaseUid: req.user.uid });

      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: "User not found in database" 
        });
      }

      const userRole = user.role || "candidate";

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: This action requires one of the following roles: ${allowedRoles.join(", ")}`,
        });
      }

      // Attach role and full DB user object for subsequent middlewares/controllers
      req.user.role = userRole;
      req.user.dbUser = user;
      
      next();
    } catch (err) {
      console.error("Role Middleware Error:", err.message);
      return res.status(500).json({ 
        success: false, 
        message: "Server error during role verification" 
      });
    }
  };
}
