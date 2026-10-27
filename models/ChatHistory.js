// models/ChatHistory.js
// Mongoose schema for the existing "chat_histories" collection, plus the
// raw-driver collection helper used elsewhere (kept for compatibility).

import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export const CHAT_HISTORY_COLLECTION = "chat_histories";

const chatMessageSchema = new Schema(
  {
    sender: { type: String, enum: ["user", "bot"], default: "user" },
    text: { type: String, default: "" },
    // Phase 3 career-agent analytics (optional — older docs simply lack them).
    sourcesCount: { type: Number, default: null },
    intent: { type: String, default: null },
    grounded: { type: Boolean, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const chatHistorySchema = new Schema(
  {
    userId: { type: String, required: true, unique: true }, // firebaseUid
    role: { type: String, default: "candidate" },
    // Controller keeps only the last 100 messages ($slice: -100).
    messages: { type: [chatMessageSchema], default: [] },
  },
  {
    timestamps: true,
    collection: CHAT_HISTORY_COLLECTION,
  },
);

export const ChatHistory =
  models.ChatHistory || model("ChatHistory", chatHistorySchema);

/**
 * Returns the raw collection reference (assumes db is already connected).
 * @param {import("mongodb").Db} db
 */
export function getChatHistoryCollection(db) {
  return db.collection(CHAT_HISTORY_COLLECTION);
}
