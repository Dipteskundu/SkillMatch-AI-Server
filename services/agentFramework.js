// services/agentFramework.js
// Shared lifecycle for AI agent "offers": propose → user approves → execute.
// Every write by an agent must go through an approved agent_action document.

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

export const AGENT_ACTION_STATUSES = ["pending", "approved", "rejected", "executed", "failed"];
export const AGENT_ROLES = ["candidate", "recruiter"];

/**
 * The agent registry. Each agent exposes:
 *   id, label, role ("candidate" | "recruiter"), description,
 *   propose(db, uid, opts) -> { summary: string, proposal: object }
 *   execute(db, uid, action) -> { result: object, summary: string }
 */
export const AGENTS = [
  {
    id: "auto-apply",
    label: "Auto-Application Agent",
    role: "candidate",
    description: "Picks your top-matched jobs, drafts the applications, and submits each one only after you approve.",
  },
  {
    id: "skill-assessment",
    label: "Skill Assessment Agent",
    role: "candidate",
    description: "Detects your biggest skill gap and recommends a matching skill test, delivered to your notifications on approval.",
  },
  {
    id: "networking",
    label: "Networking Agent",
    role: "candidate",
    description: "Drafts an outreach message for your target role. You review and send it yourself — nothing leaves the platform automatically.",
  },
  {
    id: "learning-path",
    label: "Learning Path Agent",
    role: "candidate",
    description: "Builds a week-by-week study schedule from your skill gaps and adds it as a reminder task on approval.",
  },
  {
    id: "profile-optimizer",
    label: "Profile Optimizer Agent",
    role: "candidate",
    description: "Audits your profile and applies the approved fixes (skills/title) to your profile.",
  },
  {
    id: "candidate-outreach",
    label: "Candidate Outreach Agent",
    role: "recruiter",
    description: "Shortlists your top-matched applicants and drafts outreach messages for you to send.",
  },
  {
    id: "applicant-vetting",
    label: "Applicant Vetting Agent",
    role: "recruiter",
    description: "Ranks your job's applicants with an AI fit rationale you can use when reviewing.",
  },
  {
    id: "job-post-refresher",
    label: "Job Post Refresher",
    role: "recruiter",
    description: "Finds stale job posts and proposes refreshed descriptions. Applied only after your approval.",
  },
];

/** List agents available to a role. */
export function listAgentsForRole(role) {
  return AGENTS.filter((a) => a.role === role).map(({ propose, execute, ...meta }) => meta);
}

export function getAgent(agentId) {
  return AGENTS.find((a) => a.id === agentId) || null;
}

/**
 * Create a pending action. Agents never write directly — this is the gate.
 */
export async function proposeAction({ userId, role, agentId, summary, proposal }) {
  const db = getDB();
  const doc = {
    userId,
    role,
    agentId,
    status: "pending",
    summary: String(summary || "").slice(0, 1000),
    proposal,
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { insertedId } = await db.collection("agent_actions").insertOne(doc);
  return { ...doc, _id: insertedId };
}

/** Fetch one action owned by the user. */
export async function getOwnedAction(userId, actionId) {
  if (!ObjectId.isValid(actionId)) {
    throw Object.assign(new Error("Invalid action id"), { status: 400 });
  }
  const action = await getDB().collection("agent_actions").findOne({
    _id: new ObjectId(actionId),
    userId,
  });
  if (!action) throw Object.assign(new Error("Agent action not found"), { status: 404 });
  return action;
}

/** Approve and run the agent's execute step. Reject just marks the record. */
export async function resolveAction(actionId, decision) {
  const db = getDB();
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(new Error("Decision must be approved or rejected"), { status: 400 });
  }
  const action = await db.collection("agent_actions").findOne({ _id: new ObjectId(actionId) });
  if (!action) throw Object.assign(new Error("Agent action not found"), { status: 404 });
  if (action.status !== "pending") {
    throw Object.assign(new Error(`Action already ${action.status}`), { status: 409 });
  }

  await db.collection("agent_actions").updateOne(
    { _id: action._id },
    { $set: { status: decision === "approved" ? "approved" : "rejected", decidedAt: new Date(), updatedAt: new Date() } }
  );

  if (decision !== "approved") {
    return { ...action, status: "rejected" };
  }

  const agent = getAgent(action.agentId);
  if (!agent) throw Object.assign(new Error("Unknown agent"), { status: 400 });

  try {
    const { result, summary } = await agent.execute(db, action.userId, action);
    await db.collection("agent_actions").updateOne(
      { _id: action._id },
      { $set: { status: "executed", result, summary: summary || action.summary, executedAt: new Date(), updatedAt: new Date() } }
    );
    return { ...action, status: "executed", result };
  } catch (error) {
    await db.collection("agent_actions").updateOne(
      { _id: action._id },
      { $set: { status: "failed", result: { error: error.message }, updatedAt: new Date() } }
    );
    throw error;
  }
}

/** User's agent activity log (also the pending list). */
export async function listActions(userId, status) {
  const query = { userId };
  if (status && AGENT_ACTION_STATUSES.includes(status)) query.status = status;
  return getDB()
    .collection("agent_actions")
    .find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
}
