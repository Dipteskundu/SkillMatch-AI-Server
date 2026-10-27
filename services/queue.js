// services/queue.js
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-process job queue. NO Redis, no external broker — by design.
//
// Execution: a concurrency-limited async runner (default 2, env
// WORKER_CONCURRENCY) drains jobs via setImmediate, with per-job try/catch,
// one retry with configurable backoff (max 2 attempts).
//
// Jobs are persisted to the `jobs_queue` MongoDB collection
// (status: queued|running|done|failed, attempts, error, result summary,
// timestamps) so state survives restarts. On first use, stale `queued`/
// `running` jobs older than QUEUE_STALE_MINUTES (default 30) are recovered:
// retried once when attempts remain, otherwise marked failed.
//
// If MongoDB is unavailable, jobs still run in-memory (status transitions are
// mirrored in a local cache) — the queue degrades instead of blocking.
//
// Singleton is guarded via globalThis.__queueCache (same pattern as
// config/db.js / config/mongoose.js) so serverless warm invocations reuse it.
//
// Public API:
//   enqueue(jobType, payload, opts?)  -> { jobId, status }
//   registerWorker(jobType, handler)  -> unsubscribe fn
//   getJob(jobId)                     -> job doc (memory first, then DB)
//   recoverStaleJobs(opts?)           -> { recovered, failed }
//   whenIdle()                        -> Promise (test/ops helper)
//   onQueueEvent(event, cb)           -> unsubscribe fn
//   resetQueueForTests()              -> hard reset of the singleton
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { getDB } from "../config/db.js";

export const JOBS_COLLECTION = "jobs_queue";

const DEFAULT_CONCURRENCY = 2;
const MAX_ATTEMPTS = 2; // 1 try + 1 retry
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_STALE_MINUTES = 30;

function state() {
  if (!globalThis.__queueCache) {
    globalThis.__queueCache = {
      workers: new Map(),      // jobType -> handler
      pending: [],             // [{ jobId, jobType, payload, availableAt }]
      active: 0,
      idleWaiters: [],
      jobs: new Map(),         // in-memory mirror (jobId -> doc)
      events: new EventEmitter(),
      anyListeners: new Set(), // catch-all listeners for onQueueEvent(cb)
      timers: new Set(),
      pumpScheduled: false,
      recoveryPromise: null,   // once-per-process stale scan
      recoveryDone: false,
    };
  }
  return globalThis.__queueCache;
}

// ── Config (read at call time so tests / env changes take effect) ────────────

function concurrency() {
  const n = Number(process.env.WORKER_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_CONCURRENCY;
}

function backoffMs() {
  const n = Number(process.env.QUEUE_BACKOFF_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BACKOFF_MS;
}

function staleMinutes() {
  const n = Number(process.env.QUEUE_STALE_MINUTES);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STALE_MINUTES;
}

// ── Persistence (best-effort; memory mirror is authoritative on DB failure) ──

function col() {
  return getDB().collection(JOBS_COLLECTION);
}

function summarizeResult(result) {
  if (result === undefined || result === null) return null;
  try {
    const json = JSON.stringify(result);
    if (typeof json !== "string") return null;
    return json.length > 2000 ? { truncated: true, chars: json.length } : JSON.parse(json);
  } catch {
    return { unserializable: true };
  }
}

async function persistInsert(doc) {
  state().jobs.set(String(doc._id), doc);
  try {
    await col().insertOne({ ...doc });
  } catch (err) {
    console.warn("queue: could not persist job", String(doc._id), err?.message || err);
  }
}

async function persistUpdate(jobId, patch) {
  const key = String(jobId);
  const mem = state().jobs.get(key);
  if (mem) Object.assign(mem, patch);
  try {
    await col().updateOne({ _id: jobId }, { $set: patch });
  } catch (err) {
    console.warn("queue: could not update job", key, err?.message || err);
  }
}

function emit(event, data) {
  const s = state();
  s.events.emit(event, data);
  for (const cb of [...s.anyListeners]) {
    try {
      cb(event, data);
    } catch {
      /* listener errors must never break the queue */
    }
  }
}

/**
 * Subscribe to queue events. Two call styles:
 *   onQueueEvent(cb)                  → every event: (eventName, data)
 *   onQueueEvent(eventName, cb)       → one event:   (data)
 * Returns an unsubscribe function.
 */
export function onQueueEvent(eventOrCb, maybeCb) {
  const s = state();
  if (typeof eventOrCb === "function") {
    const cb = eventOrCb;
    s.anyListeners.add(cb);
    return () => s.anyListeners.delete(cb);
  }
  const event = eventOrCb;
  const cb = maybeCb;
  s.events.on(event, cb);
  return () => s.events.off(event, cb);
}

// ── Job execution ────────────────────────────────────────────────────────────

async function loadJobDoc(jobId) {
  const mem = state().jobs.get(String(jobId));
  if (mem) return mem;
  try {
    return await col().findOne({ _id: jobId });
  } catch {
    return null;
  }
}

/**
 * Run one attempt of a job. Throws when the attempt failed (callers decide
 * whether to retry). Never throws for missing persistence.
 */
async function runAttempt(jobId, jobType, payloadOverride) {
  const s = state();
  const doc = await loadJobDoc(jobId);
  const payload = payloadOverride !== undefined ? payloadOverride : doc?.payload;
  const maxAttempts = Number(doc?.maxAttempts) || MAX_ATTEMPTS;
  const attempt = (Number(doc?.attempts) || 0) + 1;

  await persistUpdate(jobId, {
    status: "running",
    attempts: attempt,
    startedAt: new Date(),
    updatedAt: new Date(),
  });
  emit("job:running", { jobId, jobType, attempt });

  const startedAt = Date.now();
  try {
    const handler = s.workers.get(jobType);
    if (!handler) throw new Error(`No worker registered for job type "${jobType}"`);
    const result = await handler(payload, { jobId, jobType, attempt });
    await persistUpdate(jobId, {
      status: "done",
      result: summarizeResult(result),
      error: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(
      JSON.stringify({ queue: jobType, jobId: String(jobId), status: "done", attempt, ms: Date.now() - startedAt }),
    );
    emit("job:done", { jobId, jobType, attempt });
  } catch (err) {
    const message = err?.message || String(err);
    if (attempt >= maxAttempts) {
      await persistUpdate(jobId, {
        status: "failed",
        error: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      });
      console.error(
        JSON.stringify({ queue: jobType, jobId: String(jobId), status: "failed", attempt, error: message }),
      );
      emit("job:failed", { jobId, jobType, attempt, error: message });
    } else {
      await persistUpdate(jobId, { status: "queued", error: message, updatedAt: new Date() });
      emit("job:retry", { jobId, jobType, attempt, error: message });
      // The entry was already spliced out of `pending` — put it back
      // (available after the backoff) or the retry never runs.
      s.pending.push({
        jobId,
        jobType,
        payload: payloadOverride !== undefined ? payloadOverride : doc?.payload,
        availableAt: Date.now() + backoffMs(),
      });
    }
    throw err;
  }
}

// ── In-process executor ──────────────────────────────────────────────────────

function wakeAfter(ms) {
  const s = state();
  const delay = Math.max(0, Math.ceil(ms));
  const timer = setTimeout(() => {
    s.timers.delete(timer);
    pump();
  }, delay);
  s.timers.add(timer);
}

function schedulePump() {
  const s = state();
  if (s.pumpScheduled) return;
  s.pumpScheduled = true;
  setImmediate(() => {
    s.pumpScheduled = false;
    pump();
  });
}

function maybeNotifyIdle() {
  const s = state();
  if (s.active > 0 || s.pending.length > 0) return;
  const waiters = s.idleWaiters.splice(0, s.idleWaiters.length);
  for (const resolve of waiters) resolve();
}

function pump() {
  const s = state();
  const cap = concurrency();
  const now = Date.now();

  while (s.active < cap) {
    const idx = s.pending.findIndex((e) => e.availableAt <= now);
    if (idx === -1) break;
    const entry = s.pending.splice(idx, 1)[0];
    s.active += 1;
    runAttempt(entry.jobId, entry.jobType, entry.payload)
      .catch(() => {
        // failure already persisted + retried-or-failed inside runAttempt
      })
      .finally(() => {
        s.active -= 1;
        maybeNotifyIdle();
        schedulePump();
      });
  }

  // Schedule a wake-up for future-dated retries.
  if (s.pending.length > 0) {
    const earliest = Math.min(...s.pending.map((e) => e.availableAt));
    if (earliest > Date.now()) wakeAfter(earliest - Date.now());
  }

  maybeNotifyIdle();
}

/** Resolve when no job is running or waiting (including backoff retries). */
export function whenIdle() {
  const s = state();
  if (s.active === 0 && s.pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => s.idleWaiters.push(resolve));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue a job. Returns quickly; execution is asynchronous.
 * @param {string} jobType
 * @param {Object} payload
 * @param {Object} [opts] { maxAttempts }
 * @returns {Promise<{jobId: string, status: string}>}
 */
export async function enqueue(jobType, payload = {}, opts = {}) {
  const s = state();
  const jobId = randomUUID();
  const now = new Date();
  const doc = {
    _id: jobId,
    jobType,
    payload,
    status: "queued",
    attempts: 0,
    maxAttempts: Number(opts.maxAttempts) || MAX_ATTEMPTS,
    error: null,
    result: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };

  await persistInsert(doc);
  emit("job:queued", { jobId, jobType });

  // Fire-and-forget: once-per-process recovery of stale jobs from earlier runs.
  void maybeRecoverStale();

  s.pending.push({ jobId, jobType, payload, availableAt: Date.now() });
  schedulePump();

  return { jobId, status: "queued" };
}

/**
 * Register a handler for a job type. Returns an unsubscribe function.
 */
export function registerWorker(jobType, handler) {
  const s = state();
  s.workers.set(jobType, handler);
  return () => {
    if (s.workers.get(jobType) === handler) s.workers.delete(jobType);
  };
}

/** Look up a job by id (in-memory mirror first, then MongoDB). */
export async function getJob(jobId) {
  if (!jobId) return null;
  const mem = state().jobs.get(String(jobId));
  if (mem) return mem;
  try {
    return (await col().findOne({ _id: jobId })) || null;
  } catch {
    return null;
  }
}

/**
 * Recover stale queued/running jobs (from crashes/restarts): retry once when
 * attempts remain, otherwise marked failed. Runs at most once per process unless
 * `force` is set.
 */
export async function recoverStaleJobs({ force = false, olderThanMs } = {}) {
  const s = state();
  if (s.recoveryDone && !force) return { recovered: 0, failed: 0 };
  s.recoveryDone = true;

  let stale = [];
  try {
    const cutoff = new Date(Date.now() - (olderThanMs ?? staleMinutes() * 60_000));
    stale = await col()
      .find({ status: { $in: ["queued", "running"] }, updatedAt: { $lt: cutoff } })
      .toArray();
  } catch (err) {
    console.warn("queue: stale job scan failed:", err?.message || err);
    return { recovered: 0, failed: 0 };
  }

  let recovered = 0;
  let failed = 0;
  for (const doc of stale) {
    const jobId = String(doc._id);
    if (s.jobs.has(jobId)) continue; // live in this process — not stale
    const maxAttempts = Number(doc.maxAttempts) || MAX_ATTEMPTS;
    if ((Number(doc.attempts) || 0) >= maxAttempts) {
      await persistUpdate(jobId, {
        status: "failed",
        error: doc.error || "Job was abandoned by a previous process and has no attempts left",
        finishedAt: new Date(),
        updatedAt: new Date(),
      });
      failed += 1;
      emit("job:failed", { jobId, jobType: doc.jobType, attempt: doc.attempts, error: "stale" });
    } else {
      await persistUpdate(jobId, { status: "queued", updatedAt: new Date() });
      s.pending.push({ jobId, jobType: doc.jobType, payload: doc.payload, availableAt: Date.now() });
      schedulePump();
      recovered += 1;
    }
  }

  if (recovered || failed) {
    console.log(JSON.stringify({ queue: "recovery", stale: stale.length, recovered, failed }));
  }
  return { recovered, failed };
}

function maybeRecoverStale() {
  const s = state();
  if (!s.recoveryPromise) {
    s.recoveryPromise = recoverStaleJobs().catch((err) => {
      console.warn("queue: stale job recovery failed:", err?.message || err);
      return { recovered: 0, failed: 0 };
    });
  }
  return s.recoveryPromise;
}

/** Test helper: hard-reset the singleton (call after awaiting whenIdle()). */
export function resetQueueForTests() {
  const s = state();
  for (const timer of s.timers) clearTimeout(timer);
  s.timers.clear();
  s.workers.clear();
  s.pending.length = 0;
  s.active = 0;
  s.idleWaiters.length = 0;
  s.jobs.clear();
  s.events.removeAllListeners();
  s.anyListeners.clear();
  s.pumpScheduled = false;
  s.recoveryPromise = null;
  s.recoveryDone = false;
}
