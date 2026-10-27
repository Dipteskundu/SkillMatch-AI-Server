// Runs before each test file's imports are evaluated.
//
// `api/index.js` calls loadEnv() at import time and treats a missing MongoDB
// connection string as a fatal config error (every route below / and /health
// would 500). CI has no .env file, so provide a placeholder URI here.
// Locally, config/dotenv.js (override: true) may replace it with the real
// value from .env — either way `loadEnv()` passes its check, and NO connection
// is ever attempted: config/db.js and config/mongoose.js are mocked in the
// tests that import the app.
// A local .env may carry a (possibly invalid) GEMINI_API_KEY; never let the
// fit-score embedding hook (services/embeddings.js) hit the network in tests.
// Tests are taxonomy-only and deterministic.
process.env.EMBEDDING_ENABLED = "false";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/jobmatch-test";
