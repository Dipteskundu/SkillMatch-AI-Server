import express from "express";
import { handleAskChatbot } from "../controllers/chatbotController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/api/chatbot/ask", verifyToken, handleAskChatbot);

export default router;
