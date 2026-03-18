import express from "express";
import { assistantHandler } from "../controllers/assistant.controller.js";

const router = express.Router();

router.post("/api/assistant", assistantHandler);

export default router;
