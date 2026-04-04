# Gemini API Setup & Integration Guide

This document is the single source of truth for configuring, testing, and using the Gemini API integration in `JobMatch-AI-Server/`.

Official docs (Node.js quickstart): https://ai.google.dev/gemini-api/docs/get-started/node

## Implementation Status

- Status: Complete and working (Gemini API integrated via the official SDK)
- Primary use case: Communication assessment (question generation + answer evaluation)

## What's Included (Files/Scripts)

Core integration:
- `services/gemini.service.js` - main Gemini service (question generation + evaluation)
- `package.json` - includes `@google/generative-ai`
- `.env` - contains `GEMINI_API_KEY` (kept out of git)

Verification scripts:
- `test-gemini.js` - quick API connection test
- `test-service.js` - tests service functions end-to-end
- `list-models.js` - prints models available to your API key

## Prerequisites

- Node.js 20.x (see `package.json`)
- A Gemini API key from Google AI Studio

## Installation

If you cloned fresh (dependency already declared in `package.json`):

```bash
cd JobMatch-AI-Server
npm install
```

## Configuration

### 1) Get an API key

1. Go to https://ai.google.dev/
2. Sign in
3. Create / copy an API key

### 2) Add `GEMINI_API_KEY` to `.env`

In `JobMatch-AI-Server/.env`:

```env
GEMINI_API_KEY=your_api_key_here
```

Security note: never commit API keys; `.env` is already in `.gitignore`.

## Quick Start (Recommended)

Run these commands from `JobMatch-AI-Server/`:

### 1) Test API connection

```bash
node test-gemini.js
```

Expected (example) output:
```
Gemini API is working perfectly!
```

### 2) Test the service functions

```bash
node test-service.js
```

This validates:
- Question generation for job roles
- Answer evaluation with scoring + feedback

### 3) List models available to your key

```bash
node list-models.js
```

## Models & Fallback Strategy

The service uses a model-priority list and falls back automatically if a model is unavailable or rate-limited.

Model priority (in order):
1. `gemini-2.5-flash` (recommended default)
2. `gemini-flash-latest`
3. `gemini-2.0-flash`
4. `gemini-2.0-flash-001`
5. `gemini-2.5-pro`
6. `gemini-pro-latest`
7. `gemini-2.0-flash-lite`
8. `gemini-2.0-flash-lite-001`

Notes:
- Actual model availability varies by API key, region, and Google changes over time.
- If quota is exceeded on one model, the service attempts the next model automatically.

## Service API (Implementation Details)

Service file: `services/gemini.service.js`

### `generateQuestions(jobTitle, company)`

Generates exactly 5 role-specific communication assessment questions, plus a 10-minute time limit.

Returns:
```js
{
  questions: [
    { id: "q1", text: "Question text...", type: "email" }
  ],
  timeLimit: 10
}
```

### `evaluateAnswers(questions, answers)`

Evaluates candidate responses across all questions and returns scores + short feedback.

Returns:
```js
{
  clarityScore: 85,
  toneScore: 90,
  grammarScore: 80,
  structureScore: 85,
  communicationScore: 84,
  feedback: "Detailed feedback text..."
}
```

### Features implemented

- Model fallback across multiple models
- Retry logic for quota/rate limiting
- Robust error handling with actionable messages
- JSON parsing that tolerates markdown-wrapped JSON

## Usage in the Application

This project uses ESM (`"type": "module"`). Example import:

```js
import { generateQuestions, evaluateAnswers } from "../services/gemini.service.js";

const result = await generateQuestions("Software Engineer", "Tech Corp");
const scores = await evaluateAnswers(result.questions, candidateAnswers);
```

## Security

- API key is read from environment variables only (`GEMINI_API_KEY`)
- Server-side integration only (do not expose keys in client code)

## Performance (Typical)

Exact times vary by model and quota, but expected ballpark:
- Question generation: ~2-3 seconds
- Answer evaluation: ~3-4 seconds

## Rate Limits

Rate limits depend on your plan (free vs paid):
- Docs: https://ai.google.dev/gemini-api/docs/rate-limits

If you hit "quota exceeded" / HTTP 429:
1. Wait and retry (free tier resets periodically)
2. Check usage: https://ai.google.dev/
3. Consider upgrading for higher limits
4. The service will try alternative models automatically

## Troubleshooting

### `GEMINI_API_KEY not set`

- Ensure `JobMatch-AI-Server/.env` contains `GEMINI_API_KEY=...`

### 404 / model not found

- Run `node list-models.js` and update the model list if needed

### 429 quota exceeded

- Wait a few minutes and retry
- Check usage/limits in Google AI Studio

### Invalid API key

- Re-check for extra spaces/characters
- Regenerate a key if needed

## Additional Resources

- Official docs: https://ai.google.dev/gemini-api/docs
- Model docs: https://ai.google.dev/gemini-api/docs/models/gemini
- API reference: https://ai.google.dev/api
- Google AI Forum: https://discuss.ai.google.dev/
- SDK repo: https://github.com/google-gemini/generative-ai-js

