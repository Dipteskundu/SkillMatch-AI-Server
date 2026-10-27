// Express app smoke tests — no DB, no network, no listening socket.
//
// `api/index.js` exports the app without calling listen() (the listener lives
// in index.js behind the `!process.env.VERCEL` guard), so supertest can drive
// it directly. config/db.js and config/mongoose.js are mocked so importing the
// app never touches MongoDB.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../config/db.js", () => ({
  connectDB: vi.fn(async () => {}),
  getDB: vi.fn(() => globalThis.__testDb),
}));

vi.mock("../config/mongoose.js", () => ({
  connectMongoose: vi.fn(async () => null),
  syncAllIndexes: vi.fn(async () => ({ total: 0, synced: 0, failed: [] })),
}));

import app from "../api/index.js";
import { connectDB } from "../config/db.js";

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__testDb = {
    collection: vi.fn(() => ({
      find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      findOne: vi.fn(async () => null),
      insertOne: vi.fn(async () => ({ insertedId: "new-id" })),
      updateOne: vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    })),
  };
});

describe("GET /", () => {
  it("responds 200 with the service banner", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      service: "JobMatch-AI-Server",
    });
    expect(typeof res.body.timestamp).toBe("string");
  });
});

describe("GET /health", () => {
  it("responds 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "ok" });
  });
});

describe("request pipeline", () => {
  it("runs the connectDB middleware before routing and 404s unknown routes", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");

    expect(connectDB).toHaveBeenCalled();
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "Route not found" });
  });

  it("400s malformed JSON with a clear message instead of crashing", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .set("Content-Type", "application/json")
      .send("{ this is not json");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Invalid JSON payload.",
    });
  });
});
