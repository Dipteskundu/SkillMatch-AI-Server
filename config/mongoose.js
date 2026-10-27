// config/mongoose.js
// Mongoose 9 connection with the same serverless-friendly caching pattern as
// config/db.js (globalThis.__mongooseCache survives across warm serverless
// invocations).
//
// Design notes:
//  - Same connection string logic as config/db.js: loadEnv() resolves
//    MONGODB_URI / MONGO_URI / DB_USER+DB_PASS+DB_HOST pieces, and MONGO_DB_NAME
//    is passed explicitly so Mongoose targets the exact same database the raw
//    driver uses (client.db(dbName)).
//  - FAULT-TOLERANT: if connecting/syncing fails we log and resolve null —
//    raw-driver routes keep working unchanged.
//  - Indexes: Model.syncIndexes() + skill seeding run once per process
//    (global promise guard) so the schema-layer indexes actually get created.

import mongoose from "mongoose";
import { loadEnv } from "./env.js";
import "../models/index.js"; // registers every model on the default connection
import { seedStarterSkills } from "../models/skillSeed.js";

// Indexes are built ONLY by the explicit, logged syncIndexes() phase below —
// otherwise Mongoose's silent autoIndex races with it and hides build failures.
// (Consulted at init/connect time, so setting it here is safe.)
mongoose.set("autoIndex", false);

// Same caching shape as globalThis.__mongoCache in config/db.js.
const cache = globalThis.__mongooseCache || {
  conn: null,
  promise: null,
  phase: null, // { summary, seed } from the once-per-process index sync
};

globalThis.__mongooseCache = cache;

// Runtime connection problems after the initial connect (never crash the process).
// Attached unconditionally: module instance and connection instance reload together.
mongoose.connection.on("error", (error) => {
  console.error("Mongoose runtime connection error:", error.message);
});

/**
 * Sync indexes for every registered model. Never throws — a model whose index
 * build fails (e.g. legacy duplicate data) is reported but does not block others.
 */
async function syncAllIndexes() {
  const modelNames = Object.keys(mongoose.models);
  let synced = 0;
  const failed = [];

  for (const name of modelNames) {
    try {
      await mongoose.models[name].syncIndexes();
      synced += 1;
    } catch (error) {
      failed.push(name);
      // Strip Mongo's "dup key: {...}" payload — it embeds user data (emails etc.).
      const safeMessage = String(error.message).replace(/\s*dup key:.*$/s, "");
      console.warn(`Mongoose: index sync failed for "${name}": ${safeMessage}`);
    }
  }

  return { total: modelNames.length, synced, failed };
}

/** Index sync + starter skill seed — runs at most once per process. */
async function runOncePerProcessPhase() {
  const summary = await syncAllIndexes();

  let seed = { skipped: true, seeded: 0, reason: "not run" };
  try {
    seed = await seedStarterSkills();
  } catch (error) {
    console.warn(`Mongoose: skill seed failed: ${error.message}`);
  }

  return { summary, seed };
}

/**
 * Connect Mongoose (idempotent + cached per process).
 * @returns {Promise<import("mongoose").Connection|null>} null when unavailable.
 */
export async function connectMongoose() {
  if (cache.conn) return cache.conn;
  if (cache.promise) return cache.promise;

  const { env } = loadEnv();
  const uri = env.MONGODB_URI;

  if (!uri) {
    console.warn(
      "Mongoose: no MongoDB connection string (MONGODB_URI/MONGO_URI) — schema layer disabled; raw driver routes unaffected.",
    );
    return null;
  }

  cache.promise = (async () => {
    try {
      await mongoose.connect(uri, {
        dbName: env.MONGO_DB_NAME, // match config/db.js: client.db(dbName)
        serverSelectionTimeoutMS: 10000,
      });

      cache.conn = mongoose.connection;

      if (!globalThis.__mongooseIndexesPromise) {
        globalThis.__mongooseIndexesPromise = runOncePerProcessPhase().catch(
          (error) => {
            console.warn(`Mongoose: index/seed phase failed: ${error.message}`);
            return { summary: { total: 0, synced: 0, failed: [] }, seed: null };
          },
        );
      }

      const phase = await globalThis.__mongooseIndexesPromise;
      cache.phase = phase;

      const { summary, seed } = phase;
      console.log(
        `Mongoose: connected · models registered (${summary.total || Object.keys(mongoose.models).length}): ` +
          `${Object.keys(mongoose.models).join(", ")} · indexes synced: ${summary.synced}/${summary.total}` +
          (summary.failed?.length ? ` (failed: ${summary.failed.join(", ")})` : "") +
          (seed
            ? seed.skipped
              ? ` · skill seed skipped (${seed.reason})`
              : ` · skill seed inserted: ${seed.seeded}`
            : ""),
      );

      return cache.conn;
    } catch (error) {
      // Fault-tolerant: log a concise error, never crash the process.
      // Reset the promise so a later call (e.g. next serverless cold start) can retry.
      cache.promise = null;
      cache.conn = null;
      console.error(
        `Mongoose connection failed (raw MongoDB driver routes keep working): ${error.message}`,
      );
      return null;
    }
  })();

  return cache.promise;
}

export { syncAllIndexes };
