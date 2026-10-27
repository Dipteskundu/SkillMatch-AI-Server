// scripts/loadtest.js — lightweight HTTP load test (no dependencies).
//
//   node scripts/loadtest.js                       # 200 req over /health
//   node scripts/loadtest.js --url /api/billing/plans --n 500 --c 25
//   node scripts/loadtest.js --url "/api/public/v1/jobs" --key smk_live_...
//
// Reports throughput, latency (p50/p95/p99), and an honest error breakdown.
// Read-only endpoints only — this never mutates data.

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag("base", process.env.LOADTEST_BASE || "http://localhost:5000");
const PATH = flag("url", "/health");
const TOTAL = Math.max(1, Number(flag("n", 200)));
const CONCURRENCY = Math.max(1, Number(flag("c", 10)));
const KEY = flag("key", process.env.SKILLMATCH_API_KEY || "");

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function worker(results) {
  while (results.done < TOTAL) {
    const i = results.done++;
    const started = performance.now();
    try {
      const res = await fetch(`${BASE}${PATH}`, {
        headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
        signal: AbortSignal.timeout(30000),
      });
      await res.arrayBuffer();
      const ms = performance.now() - started;
      results.latencies.push(ms);
      if (res.ok) results.ok += 1;
      else {
        results.errors[res.status] = (results.errors[res.status] || 0) + 1;
        results.latencies.push(ms);
      }
    } catch (err) {
      results.errors[`network:${err?.name || "ERR"}`] =
        (results.errors[`network:${err?.name || "ERR"}`] || 0) + 1;
    }
  }
}

async function main() {
  console.log(`loadtest → ${BASE}${PATH} · ${TOTAL} requests · concurrency ${CONCURRENCY}`);
  const results = { done: 0, ok: 0, latencies: [], errors: {} };
  const wallStart = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(results)));
  const wallMs = performance.now() - wallStart;

  const sorted = [...results.latencies].sort((a, b) => a - b);
  const total = results.ok + Object.values(results.errors).reduce((a, b) => a + b, 0);
  const summary = {
    requests: total,
    ok: results.ok,
    rps: Number(((total / wallMs) * 1000).toFixed(1)),
    wallMs: Number(wallMs.toFixed(0)),
    latencyMs: {
      p50: Number(percentile(sorted, 50).toFixed(1)),
      p95: Number(percentile(sorted, 95).toFixed(1)),
      p99: Number(percentile(sorted, 99).toFixed(1)),
      max: Number((sorted[sorted.length - 1] || 0).toFixed(1)),
    },
    errors: results.errors,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Non-zero exit when the endpoint is unhealthy (CI/script use).
  const clientErrors = Object.entries(results.errors)
    .filter(([k]) => !k.startsWith("network:"))
    .reduce((a, [, v]) => a + v, 0);
  if (results.ok === 0 || clientErrors > total * 0.5) process.exit(1);
}

main().catch((err) => {
  console.error("loadtest failed:", err?.message || err);
  process.exit(1);
});
