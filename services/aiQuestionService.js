// services/aiQuestionService.js
// Gemini access goes through services/llm.js (single client + fallback chain).
//
// LLM generation is the PRIMARY path. When it is unavailable (missing/invalid
// GEMINI_API_KEY, quota, unparseable output) we fall back to a small
// deterministic offline bank so the skill-test flow stays usable and
// testable — never fail hard on question generation.

import { generateJSON } from "./llm.js";

// ─────────────────────────────────────────────────────────────
// Offline fallback bank (deterministic, 3 beginner MCQs per skill)
// ─────────────────────────────────────────────────────────────

const SKILL_ALIASES = {
  js: "javascript",
  ecmascript: "javascript",
  ts: "typescript",
  typescript: "javascript",
  reactjs: "react",
  nodejs: "node",
  express: "node",
  npm: "node",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",
  sqlite: "sql",
  tailwind: "css",
  tailwindcss: "css",
  github: "git",
  k8s: "docker",
  kubernetes: "docker",
};

const FALLBACK_BANK = {
  javascript: [
    {
      text: "Which keyword declares a block-scoped variable in JavaScript?",
      options: ["variable", "let", "scope", "bind"],
      correctAnswer: "let",
    },
    {
      text: 'What does typeof "" return in JavaScript?',
      options: ['"string"', '"undefined"', '"empty"', '"number"'],
      correctAnswer: '"string"',
    },
    {
      text: "Which method converts a JSON string into a JavaScript object?",
      options: ["JSON.parse()", "JSON.stringify()", "Object.create()", "Array.from()"],
      correctAnswer: "JSON.parse()",
    },
  ],
  react: [
    {
      text: "What is the main purpose of a React component?",
      options: ["Store files", "Build reusable UI parts", "Compile JavaScript", "Manage DNS"],
      correctAnswer: "Build reusable UI parts",
    },
    {
      text: "Which hook manages state in a React function component?",
      options: ["useEffect", "useState", "useRoute", "useMount"],
      correctAnswer: "useState",
    },
    {
      text: "What does JSX stand for?",
      options: ["JavaScript XML", "JSON Xchange Syntax", "Java Source Extended", "JS Extra"],
      correctAnswer: "JavaScript XML",
    },
  ],
  node: [
    {
      text: "Which keyword imports code in modern Node.js (ES modules)?",
      options: ["require", "import", "include", "use"],
      correctAnswer: "import",
    },
    {
      text: "Node.js is best described as:",
      options: [
        "A database",
        "A JavaScript runtime built on the V8 engine",
        "A CSS framework",
        "A package registry",
      ],
      correctAnswer: "A JavaScript runtime built on the V8 engine",
    },
    {
      text: "Which built-in module handles HTTP requests in Node.js servers?",
      options: ["http", "gui", "style", "render"],
      correctAnswer: "http",
    },
  ],
  python: [
    {
      text: "Which keyword defines a function in Python?",
      options: ["func", "def", "function", "fn"],
      correctAnswer: "def",
    },
    {
      text: "What is the file extension for Python source files?",
      options: [".py", ".python", ".pt", ".rb"],
      correctAnswer: ".py",
    },
    {
      text: "Which of these is a Python list literal?",
      options: ["(1, 2, 3)", "[1, 2, 3]", "{1, 2, 3}", "<1, 2, 3>"],
      correctAnswer: "[1, 2, 3]",
    },
  ],
  java: [
    {
      text: "Which keyword defines a class in Java?",
      options: ["class", "def", "struct", "module"],
      correctAnswer: "class",
    },
    {
      text: "What is the entry point method of a Java application?",
      options: ["start()", "main()", "init()", "boot()"],
      correctAnswer: "main()",
    },
    {
      text: "Java is primarily:",
      options: [
        "A scripting language for web pages",
        "A language compiled to bytecode that runs on the JVM",
        "A database query language",
        "A markup language",
      ],
      correctAnswer: "A language compiled to bytecode that runs on the JVM",
    },
  ],
  html: [
    {
      text: "Which tag creates a hyperlink in HTML?",
      options: ["<link>", "<a>", "<href>", "<url>"],
      correctAnswer: "<a>",
    },
    {
      text: "What does HTML stand for?",
      options: [
        "HyperText Markup Language",
        "High Tech Modern Language",
        "Hyperlink Text Management Language",
        "Home Tool Markup Language",
      ],
      correctAnswer: "HyperText Markup Language",
    },
    {
      text: "Which element represents the main content of an HTML page?",
      options: ["<head>", "<main>", "<meta>", "<title>"],
      correctAnswer: "<main>",
    },
  ],
  css: [
    {
      text: "Which CSS property changes the text color?",
      options: ["font-color", "text-style", "color", "fill"],
      correctAnswer: "color",
    },
    {
      text: "What does CSS stand for?",
      options: [
        "Cascading Style Sheets",
        "Computer Style System",
        "Creative Style Syntax",
        "Coded Sheet Styling",
      ],
      correctAnswer: "Cascading Style Sheets",
    },
    {
      text: "Which unit is relative to the parent element's font size?",
      options: ["px", "em", "vh", "pt"],
      correctAnswer: "em",
    },
  ],
  sql: [
    {
      text: "Which SQL statement reads rows from a table?",
      options: ["GET", "SELECT", "FETCH", "READ"],
      correctAnswer: "SELECT",
    },
    {
      text: "Which clause filters rows in a SQL query?",
      options: ["ORDER BY", "WHERE", "AS", "JOIN"],
      correctAnswer: "WHERE",
    },
    {
      text: "What does the SQL function COUNT() do?",
      options: ["Adds rows", "Counts rows", "Sorts rows", "Deletes rows"],
      correctAnswer: "Counts rows",
    },
  ],
  git: [
    {
      text: "Which command creates a new local Git repository?",
      options: ["git init", "git new", "git start", "git create"],
      correctAnswer: "git init",
    },
    {
      text: "Which command saves staged changes to the repository?",
      options: ["git save", "git commit", "git push", "git store"],
      correctAnswer: "git commit",
    },
    {
      text: "Which command downloads a remote repository to your computer?",
      options: ["git clone", "git copy", "git get", "git download"],
      correctAnswer: "git clone",
    },
  ],
  docker: [
    {
      text: "A Docker image is best described as:",
      options: [
        "A running container",
        "A read-only template used to create containers",
        "A Git branch",
        "A cloud database",
      ],
      correctAnswer: "A read-only template used to create containers",
    },
    {
      text: "Which command builds an image from a Dockerfile?",
      options: ["docker build", "docker make", "docker create", "docker run"],
      correctAnswer: "docker build",
    },
    {
      text: "Which command lists running containers?",
      options: ["docker ps", "docker ls", "docker show", "docker state"],
      correctAnswer: "docker ps",
    },
  ],
};

// Sensible generic questions for skills without a bank entry.
function genericQuestions(skill) {
  return [
    {
      text: `Which approach works best when learning ${skill} fundamentals?`,
      options: [
        "Skip theory and copy code you don't understand",
        "Build small examples and read the official docs",
        "Memorize syntax without writing code",
        "Avoid asking questions until you are stuck",
      ],
      correctAnswer: "Build small examples and read the official docs",
    },
    {
      text: `Where should you look first when ${skill} code behaves unexpectedly?`,
      options: [
        "Read the error message and the official docs",
        "Change random lines and hope",
        "Delete the project",
        "Ask someone without trying yourself",
      ],
      correctAnswer: "Read the error message and the official docs",
    },
    {
      text: `What is a healthy way to show ${skill} skill to recruiters?`,
      options: [
        "Claim skills you have never used",
        "Show small projects and explain what you learned",
        "Copy a project without understanding it",
        "Only watch videos and never write code",
      ],
      correctAnswer: "Show small projects and explain what you learned",
    },
  ];
}

function normalizeSkillKey(skill) {
  return String(skill || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Deterministic offline questions: 3 per skill (bank hit or generic).
 * Same shape the LLM path produces: { id, text, difficulty, skill, options, correctAnswer }.
 */
function buildFallbackQuestions(skillsArray) {
  const questions = [];
  skillsArray.forEach((skill, si) => {
    const key = normalizeSkillKey(skill);
    const bank = FALLBACK_BANK[key] || FALLBACK_BANK[SKILL_ALIASES[key]] || genericQuestions(skill);
    bank.forEach((q, qi) => {
      questions.push({
        id: `q${si * 3 + qi + 1}`,
        text: q.text,
        difficulty: qi === 0 ? "Simple" : "Medium",
        skill,
        options: [...q.options],
        correctAnswer: q.correctAnswer,
      });
    });
  });
  return questions;
}

/**
 * Generate beginner-friendly MCQ questions for up to 3 skills (3 per skill)
 */
async function generateSkillQuestions(skillsArray) {
  const skills = Array.isArray(skillsArray) ? skillsArray.slice(0, 3) : [skillsArray];
  if (skills.length === 0) throw new Error("At least one skill is required");
  const skillsList = skills.join(", ");

  const prompt = `Generate beginner-friendly multiple choice technical questions for the following skills: ${skillsList}.

Requirements:
- For EACH skill, generate exactly 3 questions.
- Total questions should be exactly ${skills.length * 3}.
- Keep all questions EASY to MODERATE level for entry-level candidates.
- Use simple English and practical basics.
- NO trick questions.
- Keep questions short.
- Return ONLY a valid JSON array. Each object must have:
  - "id" (string)
  - "text" (string)
  - "difficulty" (string, use "Simple" or "Medium" only)
  - "skill" (string)
  - "options" (array of exactly 4 short strings)
  - "correctAnswer" (string, must exactly match one item from options)

Example JSON format:
[
  {
    "id": "q1",
    "text": "What is the main purpose of a React component?",
    "difficulty": "Simple",
    "skill": "React",
    "options": ["Store files", "Build reusable UI parts", "Compile JavaScript", "Manage DNS"],
    "correctAnswer": "Build reusable UI parts"
  }
]

Return ONLY the JSON array, no markdown, no extra text.`;

  let questions;
  try {
    questions = await generateJSON({
      prompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
      promptTag: "skilltest.questions",
    });

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("AI response was not a non-empty array");
    }
  } catch (error) {
    // Offline fallback: never fail the flow hard when Gemini is unavailable.
    console.warn(
      `skilltest.questions: AI question generation unavailable (${error?.message || "unknown error"}). Using offline fallback bank.`,
    );
    return buildFallbackQuestions(skills);
  }

  return questions.map((q, i) => {
    const options = Array.isArray(q.options)
      ? q.options
          .map((opt) => String(opt || "").trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];

    const normalizedDifficulty =
      String(q.difficulty || "").toLowerCase() === "simple" ? "Simple" : "Medium";

    const fallbackOptions = ["Option A", "Option B", "Option C", "Option D"];
    const finalOptions = options.length === 4 ? options : fallbackOptions;
    const givenCorrect = String(q.correctAnswer || "").trim();
    const correctAnswer = finalOptions.includes(givenCorrect) ? givenCorrect : finalOptions[0];

    return {
      id: q.id || `q${i + 1}`,
      text: q.text || "",
      difficulty: normalizedDifficulty,
      skill: q.skill || skills[0],
      options: finalOptions,
      correctAnswer,
    };
  });
}

export { generateSkillQuestions, buildFallbackQuestions };
