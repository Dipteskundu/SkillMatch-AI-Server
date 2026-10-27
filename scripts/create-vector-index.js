// scripts/create-vector-index.js
// ─────────────────────────────────────────────────────────────────────────────
// Best-effort helper: create an Atlas Vector Search index on a collection
// (default: "skills") so Phase 2+ hybrid matching can use $vectorSearch.
//
// Usage:
//   node scripts/create-vector-index.js [--collection skills] [--dimensions 768]
//                                       [--similarity cosine] [--name skills-vector]
//
// This script NEVER fails the app: Atlas Vector Search requires an M10+ paid
// tier (not available on the free/shared tier), so on rejection it prints a
// clear "not available on this tier" message and exits 0. The fit score works
// without it (taxonomy + optional Gemini embeddings — see services/fitScore.js).
//
// Index shape (mongodb driver 5.x `createSearchIndexes` command):
//   db.command({
//     createSearchIndexes: "<collection>",
//     indexes: [{ name, type: "vectorSearch", definition: { fields: [...] } }],
//   })
// ─────────────────────────────────────────────────────────────────────────────

import "../config/dotenv.js";
import { connectDB } from "../config/db.js";

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function main() {
  const collectionName = argValue("--collection", "skills");
  const indexName = argValue("--name", `${collectionName}-vector`);
  const dimensions = Number(argValue("--dimensions", 768)); // text-embedding-004
  const similarity = argValue("--similarity", "cosine");

  const db = await connectDB();

  const command = {
    createSearchIndexes: collectionName,
    indexes: [
      {
        name: indexName,
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding", // one embedding per skill document
              numDimensions: dimensions,
              similarity,
            },
          ],
        },
      },
    ],
  };

  try {
    const result = await db.command(command);
    console.log(`Vector index "${indexName}" on "${collectionName}":`, JSON.stringify(result));
  } catch (error) {
    const message = String(error?.message || error);
    const notAvailable =
      /not supported|search index|vector/i.test(message) ||
      error?.codeName === "NamespaceNotFound" ||
      error?.code === 8000;

    if (notAvailable) {
      console.warn(
        `Vector Search is not available on this MongoDB tier/cluster: ${message}\n` +
          "Atlas Vector Search requires an M10+ cluster. The fit score keeps " +
          "working with taxonomy-based matching (aliases + adjacency) — this " +
          "script is optional and can be re-run after upgrading.",
      );
    } else {
      console.warn(`Could not create vector index (non-fatal): ${message}`);
    }
  } finally {
    // The MongoClient from config/db.js keeps the event loop alive — this is a
    // one-shot script, so exit explicitly once the command has been reported.
    process.exit(0);
  }
}

main().catch((error) => {
  console.warn("create-vector-index failed (non-fatal):", error?.message || error);
  process.exitCode = 0;
});
