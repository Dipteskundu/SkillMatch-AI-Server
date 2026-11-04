// backend/test-gemini.js
// Standalone script to verify Gemini API connection
// Using the official Google Generative AI SDK (@google/generative-ai)
// Documentation: https://ai.google.dev/gemini-api/docs/get-started/node

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();

if (!apiKey) {
    // test output removed
    // test output removed
    // test output removed
    process.exit(1);
}

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(apiKey);

async function runTest() {
    // test output removed
    // test output removed
    // test output removed

    const testPrompt = "Say 'Gemini API is working perfectly!' if you can hear me.";
    
    // List of models to try - using available model names
    // Run 'node list-models.js' to see all available models for your API key
    const modelsToTry = [
        "gemini-2.5-flash",          // Latest stable Flash (recommended)
        "gemini-flash-latest",       // Alias for latest Flash
        "gemini-2.0-flash",          // Gemini 2.0 Flash
        "gemini-2.0-flash-001",      // Stable Gemini 2.0 Flash
        "gemini-2.5-pro",            // Latest stable Pro
        "gemini-pro-latest",         // Alias for latest Pro
        "gemini-2.0-flash-lite",     // Lighter version
        "gemini-2.0-flash-lite-001"  // Stable lite version
    ];

    let successCount = 0;
    let quotaExceeded = false;

    for (const modelName of modelsToTry) {
        try {
            // test output removed
            
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(testPrompt);
            const response = result.response;
            const text = response.text();

            // test output removed
            // test output removed
            // test output removed
            // test output removed
            
            successCount++;
            
            // If we got one successful response, that's enough for the test
            if (successCount === 1) {
                // test output removed
                // test output removed
                // test output removed
                return;
            }
        } catch (error) {
            const errorMsg = error.message || String(error);
            
            // test output removed
            
            if (errorMsg.includes("429") || errorMsg.includes("quota exceeded")) {
                // test output removed
                // test output removed
                // Continue trying other models
            } else if (errorMsg.includes("404") || errorMsg.includes("not found")) {
                // test output removed
            } else if (errorMsg.includes("503") || errorMsg.includes("unavailable")) {
                // test output removed
            } else {
                // test output removed
            }
        }
    }
    
    // test output removed
    if (successCount > 0) {
        // test output removed
    } else if (quotaExceeded) {
        // test output removed
        // test output removed
        // test output removed
        // test output removed
        // test output removed
    } else {
        // test output removed
        // test output removed
        // test output removed
    }
    // test output removed
}

runTest();