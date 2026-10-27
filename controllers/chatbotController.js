import { askChatbot } from "../services/chatbotService.js";
import { getDB } from "../config/db.js";

const MAX_HISTORY_MESSAGES = 100;
const MAX_QUESTION_LENGTH = 2000;

// POST /api/chatbot/ask  — career agent (grounded answer + sources).
export const handleAskChatbot = async (req, res) => {
  try {
    // Contract field is `question`; `prompt` is accepted as a legacy alias.
    const raw = typeof req.body?.question === "string"
      ? req.body.question
      : typeof req.body?.prompt === "string"
        ? req.body.prompt
        : "";
    const question = raw.trim();

    if (!question) {
      return res.status(400).json({ success: false, message: "Question is required" });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Question is too long (max ${MAX_QUESTION_LENGTH} characters)`,
      });
    }

    const uid = req.user?.uid;
    const role = req.user?.role || "candidate";

    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized. Token missing." });
    }

    const { answer, sources, grounded, intent } = await askChatbot(uid, role, question);

    // Persist to chat history (fire-and-forget — don't block the response).
    // Bot messages carry optional analytics fields (sourcesCount / intent /
    // grounded) — additive only, existing history docs stay valid.
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
                { sender: "user", text: question, createdAt: new Date() },
                {
                  sender: "bot",
                  text: answer,
                  createdAt: new Date(),
                  sourcesCount: Array.isArray(sources) ? sources.length : 0,
                  intent: intent || null,
                  grounded: Boolean(grounded),
                },
              ],
              $slice: -MAX_HISTORY_MESSAGES, // keep last 100 messages
            },
          },
        },
        { upsert: true }
      );
    } catch (histErr) {
      console.error("Chat history save error (non-fatal):", histErr.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        answer,
        sources: Array.isArray(sources) ? sources : [],
        grounded: Boolean(grounded),
        intent,
      },
    });
  } catch (error) {
    console.error("Chatbot Controller Error:", error);
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
    console.error("Get Chat History Error:", error);
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
    console.error("Delete Chat History Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete chat history." });
  }
};
