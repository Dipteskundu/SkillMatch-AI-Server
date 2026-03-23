import { getFirebaseService } from "../services/firebaseService.js";

const firebaseService = getFirebaseService();

export default async function adminGate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "Missing Authorization token" });
    }

    const idToken = authHeader.split(" ")[1];
    if (!firebaseService || !firebaseService.admin) {
      return res
        .status(500)
        .json({ success: false, message: "Firebase not initialized" });
    }

    const decoded = await firebaseService.admin.auth().verifyIdToken(idToken);
    if (!decoded) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    // Accept either custom claim 'role' === 'admin' or admin === true
    const role = decoded.role || decoded.claims?.role || null;
    const isAdmin =
      role === "admin" ||
      decoded.admin === true ||
      (decoded.claims && decoded.claims.role === "admin");

    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Admin role required" });
    }

    req.user = decoded;
    return next();
  } catch (err) {
    console.error("adminGate error:", err);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
}
