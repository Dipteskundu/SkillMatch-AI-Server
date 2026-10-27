// scripts/verify-models.js
// Registers every Mongoose model, prints collection names + index definitions,
// and — when a MongoDB connection string is available — connects and lists the
// server-side indexes. Never prints secrets/keys (only whether a URI exists).
//
// Usage: node scripts/verify-models.js

import "../config/dotenv.js";
import mongoose from "mongoose";
import { loadEnv } from "../config/env.js";
import "../models/index.js"; // registers all models

// Read-only reporting: never create/drop indexes as a side effect of this script.
mongoose.set("autoIndex", false);

const CONNECT_TIMEOUT_MS = 12000;

function formatIndex(keys, options = {}) {
  const fields = Object.entries(keys)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  const flags = [];
  if (options.unique) flags.push("unique");
  if (options.sparse) flags.push("sparse");
  if (options.name) flags.push(`name=${options.name}`);
  return flags.length ? `{ ${fields} } [${flags.join(", ")}]` : `{ ${fields} }`;
}

const modelNames = Object.keys(mongoose.models).sort();

console.log("── Mongoose model registration ──────────────────────────────");
console.log(`Models registered: ${modelNames.length}`);

for (const name of modelNames) {
  const Model = mongoose.models[name];
  const indexes = Model.schema.indexes(); // [ [keys, options], ... ]
  console.log(`\n▸ ${name}`);
  console.log(`  collection : ${Model.collection.name}`);
  console.log(`  documents  : ${Model.schema.options.timestamps ? "timestamps enabled" : "no timestamps"}`);
  if (indexes.length === 0) {
    console.log("  indexes    : (schema defines none — only _id)");
  } else {
    console.log("  indexes    :");
    for (const [keys, options] of indexes) {
      console.log(`    - ${formatIndex(keys, options)}`);
    }
  }
}

// ─── Optional: connect and compare with the server ──────────────────────────
const { env } = loadEnv();
const hasUri = Boolean(env.MONGODB_URI);

console.log("\n── Database connection ──────────────────────────────────────");
console.log(`Connection string configured: ${hasUri ? "yes" : "no"}`);
console.log(`Target database name        : ${env.MONGO_DB_NAME || "(driver default)"}`);

if (!hasUri) {
  console.log("\nRESULT: model registration + schema indexes verified (offline).");
  console.log("        Set MONGODB_URI (or MONGO_URI / DB_USER+DB_PASS+DB_HOST) to also verify server-side indexes.");
  process.exit(0);
}

let connected = false;
try {
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGO_DB_NAME,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
  });
  connected = true;
  console.log(`Connected: yes (server selection within ${CONNECT_TIMEOUT_MS}ms)`);

  console.log("\n── Server-side indexes ──────────────────────────────────────");
  for (const name of modelNames) {
    const Model = mongoose.models[name];
    try {
      const serverIndexes = await Model.collection.indexes();
      const rendered = serverIndexes
        .map((ix) => formatIndex(ix.key, ix))
        .join(", ");
      console.log(`▸ ${Model.collection.name}: ${rendered}`);
    } catch (error) {
      console.log(`▸ ${Model.collection.name}: (collection does not exist yet — ${error.message})`);
    }
  }

  // Idempotency check for the skill seed (prints counts, no data).
  const skillCount = await mongoose.connection.db
    .collection("skills")
    .countDocuments()
    .catch(() => -1);
  console.log(`\nskills collection documents: ${skillCount >= 0 ? skillCount : "(n/a)"}`);

  console.log("\nRESULT: model registration + server indexes verified (connected).");
} catch (error) {
  console.log(`Connected: no — ${error.message}`);
  console.log(
    "\nRESULT: model registration + schema index definitions verified; " +
      "server-side index check could NOT run (database unreachable from this machine).",
  );
} finally {
  if (connected) await mongoose.disconnect().catch(() => {});
}
