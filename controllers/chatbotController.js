import { askChatbot } from "../services/chatbotService.js";

export const handleAskChatbot = async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    // req.user should be populated by the verifyToken middleware
    const uid = req.user?.uid;
    const role = req.user?.role || "candidate";

    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized. JWT Token missing." });
    }

    const answer = await askChatbot(uid, role, prompt);
    
    return res.status(200).json({
      success: true,
      assistant: answer
    });

  } catch (error) {
    console.error("Chatbot Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "I encountered an error while processing your request. Please try again."
    });
  }
};
