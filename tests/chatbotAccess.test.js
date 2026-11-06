import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import chatbotRoutes from "../routes/chatbot.routes.js";
import { AUTH_REQUIRED_PAYLOAD, requiresLoginForGuestPrompt } from "../services/chatbotAccess.service.js";
import { handleAskPublicChatbot } from "../controllers/chatbotController.js";

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("guest can ask platform how-to questions", () => {
  assert.equal(requiresLoginForGuestPrompt("How do I apply for a job?"), false);
  assert.equal(requiresLoginForGuestPrompt("How do I upload my resume?"), false);
  assert.equal(requiresLoginForGuestPrompt("What does Skill Gap Detection do?"), false);
});

test("guest can ask general knowledge questions", () => {
  assert.equal(requiresLoginForGuestPrompt("Who was Ada Lovelace?"), false);
});

test("guest must sign in for account-specific information", () => {
  assert.equal(requiresLoginForGuestPrompt("How many applications have I submitted?"), true);
  assert.equal(requiresLoginForGuestPrompt("What is my skill gap?"), true);
});

test("guest must sign in before requesting an action", () => {
  assert.equal(requiresLoginForGuestPrompt("Apply for this job for me"), true);
  assert.equal(requiresLoginForGuestPrompt("Please upload my resume"), true);
  assert.equal(requiresLoginForGuestPrompt("Run the auto-apply agent"), true);
});

test("login-required responses have a stable client contract", () => {
  assert.deepEqual(AUTH_REQUIRED_PAYLOAD, {
    success: false,
    code: "AUTH_REQUIRED",
    requiresLogin: true,
    message: "Please sign in first to access your account or use assistant tasks. You can keep asking general questions without signing in.",
  });
});

test("public handler validates prompts and returns the login contract before calling the model", async () => {
  const empty = mockResponse();
  await handleAskPublicChatbot({ body: { prompt: "   " } }, empty);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.code, "PROMPT_REQUIRED");

  const tooLong = mockResponse();
  await handleAskPublicChatbot({ body: { prompt: "x".repeat(2001) } }, tooLong);
  assert.equal(tooLong.statusCode, 413);
  assert.equal(tooLong.body.code, "PROMPT_TOO_LONG");

  const protectedQuestion = mockResponse();
  await handleAskPublicChatbot({ body: { prompt: "How many applications have I submitted?" } }, protectedQuestion);
  assert.equal(protectedQuestion.statusCode, 401);
  assert.deepEqual(protectedQuestion.body, AUTH_REQUIRED_PAYLOAD);
});

test("public route rate-limits after ten requests from one IP per window", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(chatbotRoutes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api/chatbot/ask-public`;
  const statuses = [];
  for (let i = 0; i < 11; i += 1) {
    const response = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: " " }),
    });
    statuses.push(response.status);
    await response.arrayBuffer();
  }

  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429);
});
