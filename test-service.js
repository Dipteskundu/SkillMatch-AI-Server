// backend/test-service.js
// Comprehensive test for the Gemini service functions

import "dotenv/config";
import {
  generateQuestions,
  evaluateAnswers,
  TIME_LIMIT_MINUTES,
  QUESTION_COUNT,
} from "./services/gemini.service.js";

async function testGenerateQuestions() {
    // test output removed
    
    try {
        const jobTitle = "Frontend Developer";
        const company = "Tech Innovations Inc";
        
        // test output removed
        
        const result = await generateQuestions(jobTitle, company);
        
        // test output removed
        // test output removed
        // test output removed
        
        result.questions.forEach((q, index) => {
            // test output removed
        });
        
        return result.questions;
    } catch (error) {
        // test output removed
        return null;
    }
}

async function testEvaluateAnswers(questions) {
    // test output removed
    
    if (!questions || questions.length === 0) {
        return;
    }
    
    try {
        // Create sample answers
        const sampleAnswers = questions.map((q, index) => ({
            questionId: q.id,
            answer: index === 0 
                ? "Dear Team,\n\nI hope this email finds you well. I wanted to follow up on our previous discussion regarding the project timeline. Could you please provide an update on the current status?\n\nBest regards"
                : index === 1
                ? "I would approach this situation by first listening to my teammate's concerns and understanding their perspective. Then, I would present my reasoning clearly and objectively. If we still disagree, I would suggest we present both approaches to the team lead for their input."
                : index === 2
                ? "I believe effective teamwork requires clear communication, mutual respect, and shared goals. I would ensure everyone understands their role and responsibilities, and I would facilitate regular check-ins to address any issues promptly."
                : index === 3
                ? "I would explain the technical issue using simple analogies and avoid jargon. For example, I might compare a server issue to a traffic jam - when too many requests come in at once, things slow down. I would focus on the impact and the solution rather than technical details."
                : "The project is progressing well. We've completed 80% of the planned features and are on track to meet the deadline. However, we encountered a minor issue with the API integration that may require an additional 2 days to resolve."
        ));
        
        
        const scores = await evaluateAnswers(questions, sampleAnswers);
        
        
    } catch (error) {
        
    }
}

async function runAllTests() {
    
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    
    if (!apiKey) {
        process.exit(1);
    }
    
    
    // Test 1: Generate Questions
    const questions = await testGenerateQuestions();
    
    // Test 2: Evaluate Answers (only if questions were generated successfully)
    if (questions) {
        await testEvaluateAnswers(questions);
    }
    
    
    runAllTests();
}