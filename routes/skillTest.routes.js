// routes/skillTest.routes.js

import express from "express";
import { generateTest, submitTest } from "../controllers/skillTestController.js";
import { validate } from "../middleware/validate.js";
import { skillTestGenerateBody, skillTestSubmitBody } from "../lib/schemas.js";

const router = express.Router();

router.post("/api/skill-test/generate", validate(skillTestGenerateBody), generateTest);
router.post("/api/skill-test/submit", validate(skillTestSubmitBody), submitTest);

export default router;
