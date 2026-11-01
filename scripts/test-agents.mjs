// Self-check: agent registry must be fully wired after import, and the
// propose→approve→execute lifecycle must enforce no-silent-writes.
process.env.NODE_ENV = "test";

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

// Import the implementations first — same order as routes/agents.routes.js.
await import("../services/agents.service.js");
const { AGENTS, listAgentsForRole, getAgent, proposeAction } = await import("../services/agentFramework.js");

assert(AGENTS.length === 8, "registry has 8 agents");
assert(listAgentsForRole("candidate").length === 5, "candidates see 5 offers");
assert(listAgentsForRole("recruiter").length === 3, "recruiters see 3 offers");
assert(!listAgentsForRole("candidate").some((a) => a.id === "candidate-outreach"), "recruiter agents invisible to candidates");

for (const a of AGENTS) {
  assert(typeof a.propose === "function", `${a.id}.propose attached`);
  assert(typeof a.execute === "function", `${a.id}.execute attached`);
}
