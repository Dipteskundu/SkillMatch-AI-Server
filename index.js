

import "dotenv/config";
import app from "./api/index.js";
import { loadEnv } from "./config/env.js";

const { env } = loadEnv();
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
}

export default app;
