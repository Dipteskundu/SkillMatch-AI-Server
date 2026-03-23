

import "dotenv/config";
import app from "./api/index.js";
import { connectDB } from "./config/db.js";
import { loadEnv } from "./config/env.js";

const { env, errors } = loadEnv();
const PORT = Number(env.PORT) || 5000;

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Set a different PORT in .env.`);
      return;
    }
    console.error("Server failed to start:", err);
  });

  connectDB()
    .then(() => {
      console.log("MongoDB connected successfully.");
    })
    .catch((err) => {
      console.error("Failed to connect to database during startup:", err);
      if (errors.length) {
        console.error("Environment errors:", errors);
      }
      console.warn("Server is running in degraded mode until the database becomes reachable.");
    });
}

export default app;
