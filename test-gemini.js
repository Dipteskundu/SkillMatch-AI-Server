// backend/test-gemini.js
// Standalone script to verify Gemini API connectivity through the shared
// client (services/llm.js — official @google/genai SDK + fallback chain).

import "dotenv/config";
import { generateText, getModelList } from "./services/llm.js";

const apiKey = process.env.GEMINI_API_KEY?.trim();

if (!apiKey) {
    console.error("GEMINI_API_KEY NOT FOUND in .env");
    console.log("\nPlease add your API key to the .env file:");
    console.log("GEMINI_API_KEY=your_api_key_here");
    console.log("\nGet your API key from: https://ai.google.dev/");
    process.exit(1);
}

async function runTest() {
    console.log("Testing Gemini API connection via services/llm.js...");
    console.log(`Model fallback chain: ${getModelList().join(" -> ")}\n`);

    const testPrompt = "Say 'Gemini API is working perfectly!' if you can hear me.";

    try {
        const text = await generateText({ prompt: testPrompt, promptTag: "test.ping" });

        console.log("SUCCESS!");
        console.log(`Response: ${text}`);
        console.log("\n============================================================");
        console.log("Gemini API is working perfectly!");
        console.log("============================================================");
    } catch (error) {
        const errorMsg = error.message || String(error);

        if (errorMsg.includes("quota") || errorMsg.includes("429")) {
            console.log("API Key quota exceeded");
            console.log("\nThis usually means:");
            console.log("- Free tier daily limit reached");
            console.log("- Wait 24 hours or upgrade your plan");
            console.log("- Check usage: https://ai.google.dev/");
            console.log("- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits");
        } else {
            console.log(`Error: ${errorMsg.substring(0, 200)}`);
            console.log("\nTroubleshooting:");
            console.log("- Verify your API key is correct");
            console.log("- Check your internet connection");
            console.log("- Visit: https://ai.google.dev/");
        }
        process.exitCode = 1;
    }
}

runTest();
