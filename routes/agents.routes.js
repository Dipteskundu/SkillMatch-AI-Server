// routes/agents.routes.js
// Agent "offers": propose (AI builds a plan) → user approves → agent executes.
import express from "express";
import "../services/agents.service.js"; // attaches propose/execute to the registry
import { getDB } from "../config/db.js";
import {
  listAgentsForRole,
  getAgent,
  proposeAction,
  resolveAction,
  listActions,
  getOwnedAction,
} from "../services/agentFramework.js";

const router = express.Router();

// JWT for /api is enforced globally; role comes from the verified token.
const roleOf = (req) => (["recruiter", "employer", "admin"].includes(req.user?.role) ? "recruiter" : "candidate");

const uidOr401 = (req, res) => {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return uid;
};

// GET /api/agents — offers available to my role
router.get("/api/agents", (req, res) => {
  if (!uidOr401(req, res)) return;
  res.status(200).json({ success: true, agents: listAgentsForRole(roleOf(req)) });
});

// POST /api/agents/:agentId/propose — dry-run, creates a pending action
router.post("/api/agents/:agentId/propose", async (req, res) => {
  try {
    const uid = uidOr401(req, res);
    if (!uid) return;
    const role = roleOf(req);
    const agent = getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ success: false, message: "Unknown agent" });
    if (agent.role !== role && role !== "recruiter") {
      return res.status(403).json({ success: false, message: `${agent.label} is a ${agent.role}-only offer.` });
    }

    const { summary, proposal } = await agent.propose(getDB(), uid, req.body || {});
    const action = await proposeAction({ userId: uid, role, agentId: agent.id, summary, proposal });
    res.status(201).json({ success: true, action: { _id: action._id, agentId: agent.id, summary, proposal, status: action.status } });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// GET /api/agents/actions — pending + history (activity log)
router.get("/api/agents/actions", async (req, res) => {
  try {
    const uid = uidOr401(req, res);
    if (!uid) return;
    const actions = await listActions(uid, req.query.status);
    res.status(200).json({ success: true, actions, count: actions.length });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// GET /api/agents/actions/:id
router.get("/api/agents/actions/:id", async (req, res) => {
  try {
    const uid = uidOr401(req, res);
    if (!uid) return;
    const action = await getOwnedAction(uid, req.params.id);
    res.status(200).json({ success: true, action });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// POST /api/agents/actions/:id/approve | :id/reject — human in the loop
const decide = (decision) => async (req, res) => {
  try {
    const uid = uidOr401(req, res);
    if (!uid) return;
    const action = await getOwnedAction(uid, req.params.id);
    if (action.status !== "pending") {
      return res.status(409).json({ success: false, message: `Action already ${action.status}` });
    }
    const resolved = await resolveAction(action._id.toString(), decision);
    res.status(200).json({ success: true, action: resolved });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

router.post("/api/agents/actions/:id/approve", decide("approved"));
router.post("/api/agents/actions/:id/reject", decide("rejected"));

export default router;
