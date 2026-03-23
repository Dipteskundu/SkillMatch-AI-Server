// routes/notifications.routes.js
// Handles email notifications and communication

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

const router = express.Router();

// GET: Get notifications for user
// =======================================
router.get("/api/notifications/:uid", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;
    const { limit = 20, unreadOnly = false } = req.query;

    const query = { recipientId: uid };
    if (unreadOnly === "true") {
      query.read = false;
    }

    const notifications = await db
      .collection("notifications")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .toArray();

    const unreadCount = await db
      .collection("notifications")
      .countDocuments({ recipientId: uid, read: false });

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

// POST: Create notification
// =======================================
router.post("/api/notifications", async (req, res) => {
  try {
    const db = getDB();
    const {
      recipientId,
      recipientEmail,
      title,
      message,
      type = "general",
      link = null,
      metadata = {},
    } = req.body;

    if (!recipientId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: recipientId, title, message",
      });
    }

    const notification = {
      recipientId,
      recipientEmail,
      title,
      message,
      type,
      link,
      metadata,
      read: false,
      createdAt: new Date(),
    };

    const result = await db.collection("notifications").insertOne(notification);

    res.status(201).json({
      success: true,
      message: "Notification created successfully",
      data: {
        _id: result.insertedId,
        ...notification,
      },
    });
  } catch (error) {
    console.error("POST Notification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating notification",
    });
  }
});

// PUT: Mark notification as read
// =======================================
router.put("/api/notifications/:id/read", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const result = await db.collection("notifications").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
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
    console.error("PUT Notification Read Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating notification",
    });
  }
});

// PUT: Mark all notifications as read
// =======================================
router.put("/api/notifications/:uid/read-all", async (req, res) => {
  try {
    const db = getDB();
    const { uid } = req.params;

    const result = await db.collection("notifications").updateMany(
      { recipientId: uid, read: false },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error("PUT Read All Notifications Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating notifications",
    });
  }
});

// DELETE: Delete notification
// =======================================
router.delete("/api/notifications/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

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
    console.error("DELETE Notification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting notification",
    });
  }
});

// POST: Send email notification
// =======================================
router.post("/api/notifications/send", async (req, res) => {
  try {
    const { recipientEmail, subject, body, type = "general" } = req.body;

    // Basic validation
    if (!recipientEmail || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: recipientEmail, subject, body",
      });
    }

    // For now, just return success (in production, you'd integrate with email service)
    console.log("Email notification:", {
      to: recipientEmail,
      subject,
      body,
      type,
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      data: {
        recipientEmail,
        subject,
        body,
        type,
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Send Notification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while sending notification",
    });
  }
});

export default router;
