import express from "express";
import { rateLimit } from "express-rate-limit";
import { handleAskPublicChatbot, handleAskChatbot, getChatHistory, deleteChatHistory } from "../controllers/chatbotController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

const publicChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "The assistant is temporarily rate limited. Please try again in a few minutes.",
  },
});

router.post("/api/chatbot/ask-public", publicChatLimiter, handleAskPublicChatbot);
router.post("/api/chatbot/ask",     verifyToken, handleAskChatbot);
router.get("/api/chatbot/history",  verifyToken, getChatHistory);
router.delete("/api/chatbot/history", verifyToken, deleteChatHistory);

export default router;
