

import "./config/dotenv.js";
import app from "./api/index.js";
import { loadEnv } from "./config/env.js";

const { env } = loadEnv();
const PORT = Number(env.PORT) || 5001;

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    // Server started silently; port info available via /health endpoint
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      // Port in use silently; change PORT in .env or let Vercel assign a port
      return;
    }
  });
}

export default app;
