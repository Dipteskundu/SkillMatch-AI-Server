import { classifyQuestion } from "./questionClassifier.service.js";
import { buildChatbotContext } from "./contextBuilder.service.js";
import { getDirectAnswer } from "./directAnswer.service.js";
import { generateChatbotAnswer } from "./geminiChatbot.service.js";
import { sanitizeChatbotAnswer } from "./responseGuard.service.js";

const OUT_OF_SCOPE_MESSAGE =
  "I can only help with internal platform features, your own read-only account data, and stored learning-plan information inside this system.";

export async function askChatbot({ message, authUser, platformUser, conversationHistory = [] }) {
  const classificationResult = classifyQuestion(message);
  const classification = classificationResult.type;

  if (classification === "out_of_scope") {
    return {
      classification,
      answer: OUT_OF_SCOPE_MESSAGE,
      source: "fallback",
      meta: {
        reason: classificationResult.reason,
      },
    };
  }

  const context = await buildChatbotContext({
    platformUser,
    authUser,
    classification,
    message,
  });

  const direct = getDirectAnswer({
    message,
    classification,
    context,
    role: platformUser.role || "candidate",
  });

  if (direct.matched) {
    const sanitized = sanitizeChatbotAnswer(direct.answer);
    return {
      classification,
      answer: sanitized.answer,
      source: sanitized.source || "direct",
    };
  }

  try {
    const aiResult = await generateChatbotAnswer({
      message,
      classification,
      role: platformUser.role || "candidate",
      featureKnowledge: context.featureKnowledge,
      summarizedContext: JSON.stringify(
        {
          profile: context.profile,
          applicationSummary: context.applicationSummary,
          savedJobs: context.savedJobs,
          notifications: context.notifications,
          resumeSummaryLine: context.resumeSummaryLine,
          skillGapSummaryLine: context.skillGapSummaryLine,
          recruiterSummary: context.recruiterSummary,
          adminStats: context.adminStats,
          dashboardSummaryLine: context.dashboardSummaryLine,
        },
        null,
        2,
      ),
      conversationHistory: conversationHistory.slice(-5),
    });

    const sanitized = sanitizeChatbotAnswer(aiResult.answer);

    return {
      classification,
      answer: sanitized.answer,
      source: sanitized.source || "gemini",
      meta: sanitized.source ? undefined : { modelUsed: aiResult.modelUsed },
    };
  } catch (error) {
    console.error("Chatbot Gemini fallback error:", error);
    return {
      classification,
      answer:
        "I can only answer from available platform information, and I could not complete a safe explanatory answer right now.",
      source: "fallback",
    };
  }
}
