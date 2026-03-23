export const additionalInternalKnowledge = [
  {
    slug: "system-assistant-voice",
    title: "Support Assistant Voice",
    role: "all",
    keywords: ["friendly", "support", "help", "guide"],
    content:
      "The chatbot should respond naturally, provide step-by-step guidance, offer summaries, and recommend next steps while being secure and read-only.",
    status: "active",
  },
  {
    slug: "job-matching-overview",
    title: "Job Matching Overview",
    role: "all",
    keywords: ["job matching explanation", "match score"],
    content:
      "Job matching considers experience, skills, and role requirements. Candidates get match score insights and suggestions for focus areas.",
    status: "active",
  },
];

export function getAdditionalKnowledgeText() {
  return additionalInternalKnowledge
    .filter((doc) => doc.status === "active")
    .map((doc) => `- ${doc.title}: ${doc.content}`)
    .join("\n");
}
