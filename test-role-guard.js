import { askChatbot } from "./services/chatbotService.js";

async function run() {
  const cases = [
    { role: "candidate", q: "How many active job posts do I have?" },
    { role: "recruiter", q: "Show my skill gap analysis" },
    { role: "candidate", q: "How do I view my applications?" },
    { role: "recruiter", q: "How do I post a job?" },
  ];

  for (const c of cases) {
    const res = await askChatbot("test-uid", c.role, c.q);
    // test output removed
  }
}

run().catch((err) => {
  // test output removed
  process.exitCode = 1;
});