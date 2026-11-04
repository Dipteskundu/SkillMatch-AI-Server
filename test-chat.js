import { askChatbot } from "./services/chatbotService.js";
import { connectDB } from "./config/db.js";
import "dotenv/config";
import { loadEnv } from "./config/env.js";

loadEnv();

(async () => {
    try {
        await connectDB();
        // Fake UID to test how it builds context and calls Gemini
        const ans = await askChatbot("test-uid", "candidate", "how many jobs?");
        // test output removed
    } catch(err) {
        // test output removed
        // test output removed
    } finally {
        process.exit(0);
    }
})();