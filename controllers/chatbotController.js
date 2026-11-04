import { askChatbot } from "../services/chatbotService.js";
import { getDB } from "../config/db.js";

const MAX_HISTORY_MESSAGES = 100;

// POST /api/chatbot/ask
export const handleAskChatbot = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    const uid = req.user?.uid;
    const role = req.user?.role || "candidate";

    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized. Token missing." });
    }

    const { answer, link } = await askChatbot(uid, role, prompt.trim());

    // Persist to chat history (fire-and-forget — don't block the response)
    try {
      const db = getDB();
      const col = db.collection("chat_histories");
      await col.updateOne(
        { userId: uid },
        {
          $set: { role, updatedAt: new Date() },
          $setOnInsert: { userId: uid, createdAt: new Date() },
          $push: {
            messages: {
              $each: [
                { sender: "user", text: prompt.trim(), createdAt: new Date() },
                { sender: "bot",  text: answer,        createdAt: new Date() },
              ],
              $slice: -MAX_HISTORY_MESSAGES, // keep last 100 messages
            },
          },
        },
        { upsert: true }
      );
    } catch (histErr) {
      // error handled silently
    }

    return res.status(200).json({ success: true, assistant: answer, link });
  } catch (error) {
    // error handled silently
    return res.status(500).json({
      success: false,
      message: "I encountered an error while processing your request. Please try again.",
    });
  }
};

// GET /api/chatbot/history
export const getChatHistory = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const db = getDB();
    const record = await db
      .collection("chat_histories")
      .findOne({ userId: uid }, { projection: { messages: 1, _id: 0 } });

    return res.status(200).json({
      success: true,
      messages: record?.messages || [],
    });
  } catch (error) {
    // error handled silently
    return res.status(500).json({ success: false, message: "Failed to fetch chat history." });
  }
};

// DELETE /api/chatbot/history
export const deleteChatHistory = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const db = getDB();
    await db.collection("chat_histories").updateOne(
      { userId: uid },
      { $set: { messages: [], updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true, message: "Chat history cleared." });
  } catch (error) {
    // error handled silently
    return res.status(500).json({ success: false, message: "Failed to delete chat history." });
  }
};
