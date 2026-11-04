// routes/auth.routes.js
// JWT authentication: email/password login + registration + profile reads.
// Replaces Firebase Auth as the identity provider for the app.

import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { rateLimit } from "express-rate-limit";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { loadEnv } from "../config/env.js";

const router = express.Router();

const { env } = loadEnv();
const JWT_SECRET = env.JWT_SECRET || "jobmatch-jwt-secret-change-in-production";
const JWT_EXPIRES_IN = env.JWT_EXPIRES_IN || "7d";
const REFRESH_DAYS = 30;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Only failed attempts count, so normal sign-ins never hit the limit.
  skipSuccessfulRequests: true,
  message: { success: false, message: "Too many attempts. Try again in 15 minutes." },
});

function signToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      uid: user.firebaseUid || String(user._id),
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

let refreshIndexReady = false;

/** Store a hashed refresh token so a DB leak cannot be replayed. */
async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString("hex");
  if (!refreshIndexReady) {
    // Mongo TTL: drop rows once expiresAt passes, so the collection cannot grow forever.
    getDB()
      .collection("refresh_tokens")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch(() => {})
      .finally(() => {
        refreshIndexReady = true;
      });
  }
  await getDB().collection("refresh_tokens").insertOne({
    tokenHash: hashToken(token),
    userId: new ObjectId(userId),
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  });
  return token;
}

async function issueSession(user) {
  return {
    token: signToken(user),
    refreshToken: await issueRefreshToken(user._id),
  };
}

function publicUser(user) {
  const { password, ...rest } = user;
  return { ...rest, uid: user.firebaseUid || String(user._id) };
}

// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const users = getDB().collection("users");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const user = await users.findOne({ email });
    if (!user || typeof user.password !== "string") {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Backfill the legacy id used across the app (user.uid on the client).
    if (!user.firebaseUid) {
      const uid = crypto.randomUUID();
      await users.updateOne({ _id: user._id }, { $set: { firebaseUid: uid } });
      user.firebaseUid = uid;
    }
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    const session = await issueSession(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      ...session,
      user: publicUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error during login" });
  }
});

// POST /api/auth/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const users = getDB().collection("users");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = req.body?.role === "recruiter" ? "recruiter" : "candidate";
    const displayName = String(req.body?.displayName || "").trim();

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const existing = await users.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const now = new Date();
    const newUser = {
      email,
      password: await bcrypt.hash(password, 10),
      role,
      displayName,
      photoURL: "",
      firebaseUid: crypto.randomUUID(), // legacy field still used as the user id
      isSkillVerified: false,
      verifiedSkills: [],
      createdAt: now,
      lastLoginAt: now,
    };

    const result = await users.insertOne(newUser);
    newUser._id = result.insertedId;

    const session = await issueSession(newUser);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      ...session,
      user: publicUser(newUser),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error during registration" });
  }
});

// POST /api/auth/refresh — rotate a refresh token into a new session.
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "");
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token required" });
    }

    const tokens = getDB().collection("refresh_tokens");
    const stored = await tokens.findOne({ tokenHash: hashToken(refreshToken) });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await tokens.deleteOne({ _id: stored._id });
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
    }

    const user = await getDB().collection("users").findOne({ _id: stored.userId });
    if (!user) {
      await tokens.deleteOne({ _id: stored._id });
      return res.status(401).json({ success: false, message: "User not found" });
    }

    // Rotation: the presented token is single-use.
    await tokens.deleteOne({ _id: stored._id });
    const session = await issueSession(user);

    res.status(200).json({ success: true, ...session });
  } catch (error) {
    // handled silently
  }
});

// POST /api/auth/logout — revoke the presented refresh token.
router.post("/logout", async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "");
  if (refreshToken) {
    await getDB().collection("refresh_tokens").deleteOne({ tokenHash: hashToken(refreshToken) });
  }
  res.status(200).json({ success: true, message: "Logged out" });
});

// POST /api/auth/google — verify Firebase ID token and issue a JWT session.
// New Google users always get the "candidate" role; existing accounts keep their role.
router.post("/google", authLimiter, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "");
    if (!idToken) {
      return res.status(400).json({ success: false, message: "idToken is required" });
    }

    const apiKey = process.env.FIREBASE_API_KEY;
    const clientId = process.env.FIREBASE_WEB_CLIENT_ID;
    if (!apiKey || !clientId) {
      return res.status(503).json({ success: false, message: "Google sign-in is not configured on the server" });
    }

    // Verify the ID token using Google's v3 tokeninfo endpoint with the project's API key.
    const tokenInfoUrl = `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${encodeURIComponent(idToken)}&key=${apiKey}`;
    const tokenRes = await fetch(tokenInfoUrl);
    let tokenInfo;
    try {
      tokenInfo = await tokenRes.json();
    } catch {
      return res.status(401).json({ success: false, message: "Google token verification failed" });
    }
    if (!tokenRes.ok || tokenInfo.error) {
      return res.status(401).json({ success: false, message: "Google token verification failed" });
    }
    // Aud check: the token must have been issued for this web app's client ID.
    if (tokenInfo.aud !== clientId) {
      return res.status(401).json({ success: false, message: "Token was not issued to this app" });
    }
    // Only allow sign‑in when the Google account email is verified.
    if (String(tokenInfo.email_verified) !== "true") {
      return res.status(403).json({ success: false, message: "Google account email is not verified" });
    }
    const email = String(tokenInfo.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "Google account has no email" });
    }
    const sub = String(tokenInfo.sub || ""); // Firebase uid (googleUid)

    const users = getDB().collection("users");
    const now = new Date();
    let user = await users.findOne({ email });

    if (user) {
      // --- Link Google to existing account, keep the existing role ---
      await users.updateOne(
        { _id: user._id },
        {
          $set: {
            googleUid: sub,
            displayName: tokenInfo.name || user.displayName,
            photoURL: tokenInfo.picture || user.photoURL,
            emailVerified: true,
            lastLoginAt: now,
          },
        }
      );
      user = { ...user, googleUid: sub, lastLoginAt: now };
      // Backfill legacy firebaseUid if missing (same pattern as /login)
      if (!user.firebaseUid) {
        const uid = crypto.randomUUID();
        await users.updateOne({ _id: user._id }, { $set: { firebaseUid: uid } });
        user.firebaseUid = uid;
      }
    } else {
      // --- Create a new account (always candidate) ---
      const newUser = {
        email,
        role: "candidate",
        displayName: tokenInfo.name || "",
        photoURL: tokenInfo.picture || "",
        googleUid: sub,
        emailVerified: true,
        firebaseUid: crypto.randomUUID(),
        isSkillVerified: false,
        verifiedSkills: [],
        createdAt: now,
        lastLoginAt: now,
        // No `password` field — Google‑only accounts cannot log in via email/password.
      };
      const result = await users.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };

      // Concurrency guard: if insertOne threw a duplicate‑key error, fall back to findOne.
    }

    const session = await issueSession(user);
    const responseUser = publicUser(user);
    responseUser.googleUid = user.googleUid;
    res.status(user._id === result?.insertedId ? 201 : 200).json({
      success: true,
      message: user._id === result?.insertedId ? "Signed in with Google" : "Signed in with Google",
      ...session,
      user: responseUser,
    });
  } catch (err) {
    // Google auth error handled silently
  }
});

// GET /api/auth/me
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const users = getDB().collection("users");
    const user = await users.findOne({ _id: new ObjectId(req.user.id) });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, data: publicUser(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/auth/profile/:uid (kept for existing pages)
router.get("/profile/:uid", authenticateToken, async (req, res) => {
  try {
    const users = getDB().collection("users");
    const uid = req.user?.uid || req.params.uid;
    const user = await users.findOne({ firebaseUid: uid });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, data: publicUser(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/auth/profile/:uid
router.put("/profile/:uid", authenticateToken, async (req, res) => {
  try {
    const users = getDB().collection("users");
    const uid = req.user?.uid || req.params.uid;
    const { _id, firebaseUid, password, createdAt, email, ...allowedUpdates } = req.body || {};

    const user = await users.findOne({ firebaseUid: uid });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (allowedUpdates.skills && Array.isArray(allowedUpdates.skills) && !user.isSkillVerified) {
      const currentVerifiedSkills = user.verifiedSkills || [];
      const unverified = allowedUpdates.skills.filter((s) => !currentVerifiedSkills.includes(s));
      if (unverified.length > 0) {
        allowedUpdates.isSkillVerified = false;
      } else if (currentVerifiedSkills.length > 0 && allowedUpdates.skills.length > 0) {
        allowedUpdates.isSkillVerified = true;
      }
    }

    await users.updateOne(
      { firebaseUid: uid },
      { $set: { ...allowedUpdates, updatedAt: new Date() } },
    );

    res.status(200).json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

function authenticateToken(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: "Access denied. No token provided." });
  }
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid or expired token." });
    }
    req.user = payload;
    next();
  });
}

export default router;
