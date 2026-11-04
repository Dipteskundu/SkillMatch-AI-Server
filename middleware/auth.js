import jwt from "jsonwebtoken";
import { getDB } from "../config/db.js";

/**
 * Bearer JWT auth. Tokens are issued by routes/auth.routes.js and signed with
 * JWT_SECRET; there is no Firebase Admin dependency any more.
 */

function bearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

function secret() {
  return process.env.JWT_SECRET || "jobmatch-jwt-secret-change-in-production";
}

/** Resolve a token into { uid, email, role }. Throws on invalid/expired. */
async function resolveUserFromToken(token) {
  const payload = jwt.verify(token, secret());
  const user = await getDB().collection("users").findOne({ firebaseUid: payload.uid });

  return {
    id: payload.id,
    uid: payload.uid,
    email: user?.email || payload.email || "",
    role: user?.role || payload.role || "candidate",
  };
}

export const verifyToken = async (req, res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }

    req.user = await resolveUserFromToken(token);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid Token" });
  }
};

/**
 * Populates req.user when a valid token is present, otherwise continues as a
 * guest. For endpoints guests may read but enrolled users see differently.
 * Never rejects — absence of auth is a valid state here.
 */
export const optionalVerifyToken = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = await resolveUserFromToken(token);
  } catch {
    req.user = null;
  }
  return next();
};
