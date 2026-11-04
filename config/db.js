// config/db.js
// MongoDB connection with serverless-friendly caching

import { MongoClient } from "mongodb";
import { loadEnv } from "./env.js";

const globalCache = globalThis.__mongoCache || {
  client: null,
  db: null,
  promise: null,
};

globalThis.__mongoCache = globalCache;

async function connectDB() {
  const { env } = loadEnv();
  const uri = env.MONGODB_URI;
  const dbName = env.MONGO_DB_NAME;

  if (!uri) {
    throw new Error("MONGODB_URI is missing. Configure it in your environment variables.");
  }

  if (globalCache.db) return globalCache.db;

  if (!globalCache.promise) {
    const client = new MongoClient(uri);
    globalCache.client = client;
    globalCache.promise = client
      .connect()
      .then(() => {
        globalCache.db = client.db(dbName);
        return globalCache.db;
      })
      .catch((error) => {
        globalCache.promise = null;
        throw error;
      });
  }

  return globalCache.promise;
}

function getDB() {
  if (!globalCache.db) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }
  return globalCache.db;
}

export { connectDB, getDB };
