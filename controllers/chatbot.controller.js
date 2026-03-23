import { askChatbot } from "../services/chatbot/chatbot.service.js";

const MAX_MESSAGE_LENGTH = 1200;

export async function askChatbotController(req, res) {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "message is required",
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      });
    }

    const conversationHistory = Array.isArray(req.body?.history)
      ? req.body.history.slice(-5)
      : [];

    const result = await askChatbot({
      message,
      authUser: req.authUser,
      platformUser: req.platformUser,
      conversationHistory,
    });

    return res.status(200).json({
      success: true,
      classification: result.classification,
      answer: result.answer,
      source: result.source,
      meta: result.meta || undefined,
    });
  } catch (error) {
    console.error("Chatbot controller error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while processing chatbot request",
    });
  }
}
