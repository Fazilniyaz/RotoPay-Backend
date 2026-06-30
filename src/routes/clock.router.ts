// src/routes/clock.router.ts
// ─────────────────────────────────────────────
// Clock Router — clock in/out + history
// Chain: authenticate → validate → controller
// ─────────────────────────────────────────────

import { Router } from "express";
import * as clockController from "../controllers/clock.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import { clockInSchema } from "../helpers/clock.validation";

const router = Router();

router.use(authenticate);

router.post("/in",        validate(clockInSchema),                      clockController.clockIn);
router.post("/:id/out",   validateParams(idParamSchema),                clockController.clockOut);
router.get("/active",                                                   clockController.getActiveSessions);
router.get("/",                                                         clockController.getClockSessions);
router.delete("/:id",     validateParams(idParamSchema),                clockController.deleteClockSession);

export default router;
