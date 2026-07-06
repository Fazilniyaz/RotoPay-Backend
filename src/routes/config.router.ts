// src/routes/config.router.ts
// ─────────────────────────────────────────────
// Runtime config — authenticated (delivered post-login).
// ─────────────────────────────────────────────

import { Router } from "express";
import * as configController from "../controllers/config.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);
router.get("/", configController.getRuntimeConfig);

export default router;
