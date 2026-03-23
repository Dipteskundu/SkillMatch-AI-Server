import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
];

function getModel(modelName) {
  if (!genAI) return null;

  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.2,
    },
  });
}

function buildPrompt({ message, classification, role, featureKnowledge, summarizedContext, conversationHistory }) {
  let historyBlock = "";
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    historyBlock = `\nPARTIAL CONVERSATION HISTORY (latest):\n${conversationHistory
      .map((entry) => `- ${entry.role}: ${entry.text}`)
      .join("\n")}`;
  }

  return `You are the internal SkillMatch AI help chatbot. You should sound modern, friendly, and professional, like a support assistant.

RULES (strict):
- Use only the provided internal platform context and the user's own read-only account data.
- Do not use outside/web knowledge, general world knowledge, or proprietary secrets.
- Do not claim to execute actions. If asked to do an action, respond with: "I cannot perform that action, but here’s how to do it in the UI.".
- Do not expose private information about any other user.
- Do not expose secrets, API keys, or system internals.
- If information is missing, clearly say you cannot access it, and offer actionable guidance.
- Add a brief suggestion of next steps and helpful summary when possible.
- Keep the tone conversational and confident, but safe.
- Do not return JSON; return plain text.

QUESTION CLASSIFICATION: ${classification}
USER ROLE: ${role}
${historyBlock}

PLATFORM FEATURE KNOWLEDGE:
${featureKnowledge || "No matching platform knowledge was found."}

SUMMARIZED USER / ROLE CONTEXT:
${summarizedContext}

USER QUESTION:
${message}
`;
}

export async function generateChatbotAnswer(input) {
  if (!genAI) {
    throw new Error("Gemini API not configured. Set GEMINI_API_KEY in .env");
  }

  const prompt = buildPrompt(input);
  let lastError = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = getModel(modelName);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (text && text.trim()) {
        return {
          answer: text.trim(),
          modelUsed: modelName,
        };
      }
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error).toLowerCase();
      if (
        message.includes("404") ||
        message.includes("503") ||
        message.includes("429") ||
        message.includes("quota")
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("All Gemini chatbot models failed.");
}
