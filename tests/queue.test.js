import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the jobs_queue Mongo collection.
// The queue treats persistence as best-effort: any function can be swapped
// for vi.fn() mid-test to simulate a DB outage.
const makeFakeCollection = () => {
  const store = new Map();
  return {
    store,
    insertOne: vi.fn(async (doc) => {
      store.set(doc._id, structuredClone(doc));
      return { acknowledged: true, insertedId: doc._id };
    }),
    findOne: vi.fn(async (query) => {
      const doc = store.get(query._id);
      return doc ? structuredClone(doc) : null;
    }),
    updateOne: vi.fn(async (query, update) => {
      const doc = store.get(query._id);
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, structuredClone(update.$set));
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] ?? 0) + v;
      }
      store.set(query._id, doc);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    find: vi.fn((query = {}) => {
      const docs = [...store.values()].filter((d) =>
        Object.entries(query).every(([k, v]) => d[k] === v)
      );
      return { toArray: async () => structuredClone(docs) };
    }),
  };
};

let jobsQueue = makeFakeCollection();

vi.mock("../config/db.js", () => ({
  getDB: () => ({ collection: (name) => {
    if (name !== "jobs_queue") throw new Error(`unexpected collection: ${name}`);
    return jobsQueue;
  } }),
  connectDB: vi.fn(async () => {}),
}));

const {
  enqueue,
  registerWorker,
  getJob,
  whenIdle,
  resetQueueForTests,
  onQueueEvent,
} = await import("../services/queue.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  resetQueueForTests();
  jobsQueue = makeFakeCollection();
  // keep retries fast in tests
  process.env.QUEUE_BACKOFF_MS = "5";
  await sleep(5);
});

describe("queue basics", () => {
  it("enqueues a job and runs the registered worker to completion", async () => {
    const seen = [];
    registerWorker("test.echo", async (payload) => {
      seen.push(payload.value);
      return { echoed: payload.value };
    });

    const { jobId, status } = await enqueue("test.echo", { value: 42 });
    expect(status).toBe("queued");
    expect(jobId).toBeTypeOf("string");

    await whenIdle();

    const job = await getJob(jobId);
    expect(job.status).toBe("done");
    expect(job.attempts).toBe(1);
    expect(job.result).toEqual({ echoed: 42 });
    expect(job.error).toBeNull();
    expect(job.startedAt).toBeTruthy();
    expect(job.finishedAt).toBeTruthy();
    expect(seen).toEqual([42]);
  });

  it("marks unknown job types as failed after one retry (worker may register late)", async () => {
    const { jobId } = await enqueue("test.nobody.home", { x: 1 });
    await whenIdle();

    const job = await getJob(jobId);
    expect(job.status).toBe("failed");
    expect(String(job.error)).toMatch(/no worker registered/i);
    expect(job.attempts).toBe(2); // 1 try + 1 retry
  });

  it("persists the queued job document to jobs_queue", async () => {
    const { jobId } = await enqueue("test.echo", { value: 1 });
    expect(jobsQueue.insertOne).toHaveBeenCalledTimes(1);
    const doc = await jobsQueue.findOne({ _id: jobId });
    expect(doc.jobType).toBe("test.echo");
    expect(["queued", "running", "done", "failed"]).toContain(doc.status);
    await whenIdle();
  });
});

describe("queue failure handling", () => {
  it("retries a failing worker then marks the job failed", async () => {
    let calls = 0;
    registerWorker("test.flaky", async () => {
      calls += 1;
      throw new Error("boom");
    });

    const { jobId } = await enqueue("test.flaky", {});
    await whenIdle();
    await sleep(30); // let the backoff timer fire another attempt
    await whenIdle();

    const job = await getJob(jobId);
    expect(job.status).toBe("failed");
    expect(calls).toBe(2); // 1 attempt + 1 retry
    expect(job.attempts).toBe(2);
    expect(String(job.error)).toMatch(/boom/);
  });

  it("keeps the queue alive after a failure (next job still runs)", async () => {
    registerWorker("test.pair", async (payload) => {
      if (payload.fail) throw new Error("first fails");
      return "second ok";
    });

    const a = await enqueue("test.pair", { fail: true });
    const b = await enqueue("test.pair", { fail: false });

    await whenIdle();
    await sleep(30);
    await whenIdle();

    expect((await getJob(a.jobId)).status).toBe("failed");
    const jobB = await getJob(b.jobId);
    expect(jobB.status).toBe("done");
    expect(jobB.result).toBe("second ok");
  });
});

describe("queue concurrency", () => {
  it("never runs more than WORKER_CONCURRENCY jobs at once", async () => {
    resetQueueForTests();
    process.env.WORKER_CONCURRENCY = "2";
    resetQueueForTests(); // re-read env

    let running = 0;
    let peak = 0;
    registerWorker("test.slow", async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(25);
      running -= 1;
      return true;
    });

    const ids = [];
    for (let i = 0; i < 6; i++) {
      const { jobId } = await enqueue("test.slow", { i });
      ids.push(jobId);
    }
    await whenIdle();

    expect(peak).toBeLessThanOrEqual(2);
    for (const id of ids) expect((await getJob(id)).status).toBe("done");
    delete process.env.WORKER_CONCURRENCY;
  });
});

describe("queue resilience", () => {
  it("still executes the job when the DB is down", async () => {
    jobsQueue.insertOne.mockRejectedValueOnce(new Error("mongo down"));

    const ran = vi.fn(async () => "ran anyway");
    registerWorker("test.resilient", ran);

    const { jobId } = await enqueue("test.resilient", {});
    await whenIdle();

    expect(ran).toHaveBeenCalledTimes(1);
    expect((await getJob(jobId)).status).toBe("done");
  });

  it("exposes queue events for observability", async () => {
    const events = [];
    const off = onQueueEvent((event) => events.push(event));
    registerWorker("test.events", async () => "x");
    await enqueue("test.events", {});
    await whenIdle();
    off();
    expect(events).toContain("job:queued");
    expect(events).toContain("job:done");
  });

  it("returns null for unknown job ids", async () => {
    expect(await getJob("does-not-exist")).toBeNull();
  });
});
