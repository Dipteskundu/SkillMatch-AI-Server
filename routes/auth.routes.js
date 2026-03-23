// routes/auth.routes.js
// Sync authenticated Firebase user into MongoDB "users" collection

import express from "express";
import { getDB } from "../config/db.js";

const router = express.Router();

// POST /api/auth/sync-user
// Called from frontend AFTER Firebase login/register succeeds.
router.post("/api/auth/sync-user", async (req, res) => {
  try {
    const db = getDB();
    const users = db.collection("users");

    const {
      uid,
      email,
      displayName,
      provider,
      photoURL,
      role,
    } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    const now = new Date();

    const update = {
      $setOnInsert: {
        createdAt: now,
      },
      $set: {
        firebaseUid: uid,
        email,
        displayName: displayName || "",
        provider: provider || "password",
        photoURL: photoURL || "",
        role: role || "candidate",
        lastLoginAt: now,
      },
    };

    const result = await users.updateOne(
      { firebaseUid: uid },
      update,
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "User synced successfully",
      upsertedId: result.upsertedId,
    });
  } catch (error) {
    console.error("SYNC USER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error while syncing user",
    });
  }
});

// GET /api/auth/profile/:uid
// Fetch user details from MongoDB with profile completion calculation
router.get("/api/auth/profile/:uid", async (req, res) => {
  try {
    const db = getDB();
    const users = db.collection("users");
    const { uid } = req.params;

    const user = await users.findOne({ firebaseUid: uid });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Calculate profile completion percentage
    const profileCompletion = calculateProfileCompletion(user);
    
    res.status(200).json({ 
      success: true, 
      data: { ...user, profileCompletion } 
    });
  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Helper function to calculate profile completion
function calculateProfileCompletion(user) {
  const fields = [
    { key: 'displayName', weight: 8 },
    { key: 'photoURL', weight: 8 },
    { key: 'title', weight: 8 },
    { key: 'location', weight: 4 },
    { key: 'phone', weight: 4 },
    { key: 'bio', weight: 12 },
    { key: 'skills', weight: 12, isArray: true },
    { key: 'experience', weight: 12, isArray: true },
    { key: 'education', weight: 8, isArray: true },
    { key: 'projects', weight: 8, isArray: true },
    { key: 'certificates', weight: 6, isArray: true },
    { key: 'portfolioUrl', weight: 4 },
    { key: 'linkedin', weight: 3 },
    { key: 'github', weight: 3 },
  ];

  let totalScore = 0;
  let maxScore = 0;

  fields.forEach(field => {
    maxScore += field.weight;
    const value = user[field.key];
    
    if (field.isArray) {
      if (Array.isArray(value) && value.length > 0) {
        totalScore += field.weight;
      }
    } else {
      if (value && value.toString().trim() !== '') {
        totalScore += field.weight;
      }
    }
  });

  return Math.round((totalScore / maxScore) * 100);
}

// PUT /api/auth/profile/:uid
// Update user details in MongoDB
router.put("/api/auth/profile/:uid", async (req, res) => {
  try {
    const db = getDB();
    const users = db.collection("users");
    const { uid } = req.params;
    const updateData = req.body;

    // Filter out restricted fields
    const { _id, firebaseUid, email, createdAt, isSkillVerified, verifiedSkills, ...allowedUpdates } = updateData;

    const user = await users.findOne({ firebaseUid: uid });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (allowedUpdates.skills && Array.isArray(allowedUpdates.skills) && !user.isSkillVerified) {
      const currentVerifiedSkills = user.verifiedSkills || [];
      const unverified = allowedUpdates.skills.filter(s => !currentVerifiedSkills.includes(s));
      
      if (unverified.length > 0) {
        allowedUpdates.isSkillVerified = false;
      } else if (currentVerifiedSkills.length > 0 && allowedUpdates.skills.length > 0) {
        allowedUpdates.isSkillVerified = true;
      }
    }

    const result = await users.updateOne(
      { firebaseUid: uid },
      { $set: { ...allowedUpdates, updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

