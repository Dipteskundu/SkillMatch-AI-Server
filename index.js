import "./config/dotenv.js";
import app from "./api/index.js";
import { loadEnv } from "./config/env.js";

const { env } = loadEnv();
const PORT = Number(env.PORT) || 5000;

// Sentry: fully optional and env-gated. Initializes ONLY when SENTRY_DSN is
// set AND @sentry/node is installed; otherwise this is a silent no-op so the
// server never depends on monitoring config to boot.
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
      beforeSend(event) {
        // Never leak secrets in error reports.
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });
    console.log("Sentry monitoring enabled (SENTRY_DSN is set).");
  } catch (err) {
    console.warn("Sentry init skipped:", err?.message || err);
  }
}

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Set a different PORT in .env.`,
      );
      return;
    }
    console.error("Server failed to start:", err);
  });
}
