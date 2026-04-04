// routes/notifications.routes.js
// Handles notification-related API routes

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// GET: Get User Notifications
// =======================================
router.get("/api/notifications/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Fetch notifications for the user, sorted by creation date (newest first)
    const notifications = await db
      .collection("notifications")
      .find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(50) // Limit to last 50 notifications
      .toArray();

    const unreadCount = notifications.filter(n => !n.read).length;

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error) {
    console.error("GET Notifications Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
});

// PATCH: Mark Notification as Read
// =======================================
router.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    // Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    // Update notification as read
    const result = await db
      .collection("notifications")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { read: true, readAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark Notification as Read Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while marking notification as read",
    });
  }
});

// PATCH: Mark All Notifications as Read for User
// =======================================
router.patch("/api/notifications/read-all/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Mark all unread notifications for the user as read
    const result = await db
      .collection("notifications")
      .updateMany(
        { userId: uid, read: false },
        { $set: { read: true, readAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Mark All Notifications as Read Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while marking all notifications as read",
    });
  }
});

// DELETE: Delete Notification
// =======================================
router.delete("/api/notifications/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    // Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    // Delete notification
    const result = await db
      .collection("notifications")
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete Notification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting notification",
    });
  }
});

export default router;
