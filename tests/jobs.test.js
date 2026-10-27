// GET/POST /api/jobs with a mocked raw-Driver collection — proves the route
// contract (shape, approved-only filter, validation) without a database.
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

let find;
let insertOne;

beforeEach(() => {
  vi.clearAllMocks();
  find = vi.fn(() => ({ toArray: vi.fn(async () => []) }));
  insertOne = vi.fn(async () => ({ insertedId: "new-id" }));
  globalThis.__testDb = {
    collection: vi.fn(() => ({ find, insertOne })),
  };
});

describe("GET /api/jobs", () => {
  it("returns 200 with {success, count, data} and queries only approved jobs", async () => {
    const approved = [
      { _id: "1", title: "Frontend Dev", status: "approved" },
      { _id: "2", title: "Backend Dev", status: "approved" },
    ];
    find = vi.fn(() => ({ toArray: vi.fn(async () => approved) }));
    globalThis.__testDb = { collection: vi.fn(() => ({ find, insertOne })) };

    const res = await request(app).get("/api/jobs");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.data).toEqual(approved);
    // Public listing must only ever expose approved jobs.
    expect(find).toHaveBeenCalledWith({ status: "approved" });
    expect(globalThis.__testDb.collection).toHaveBeenCalledWith("find_jobs");
  });

  it("returns 500 with the error shape when the collection query fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.__testDb = {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({
          toArray: vi.fn(async () => {
            throw new Error("db down");
          }),
        })),
      })),
    };

    const res = await request(app).get("/api/jobs");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      message: "Server error while fetching jobs",
    });
    consoleError.mockRestore();
  });
});

describe("POST /api/jobs", () => {
  it("400s without title/company/location via Zod validation and inserts nothing", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ title: "Only a title" });

    // middleware/validate.js contract: 400 + {success:false, message, issues}
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Invalid request body",
    });
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["company", "location"]),
    );
    expect(insertOne).not.toHaveBeenCalled();
  });
});
