import express from "express";
import { askChatbotController } from "../controllers/chatbot.controller.js";
import { authenticateChatbotUser } from "../middleware/authenticateChatbotUser.js";

const router = express.Router();

// Health check endpoint
router.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "chatbot"
  });
});

router.post("/api/chatbot/ask", authenticateChatbotUser, askChatbotController);

export default router;
