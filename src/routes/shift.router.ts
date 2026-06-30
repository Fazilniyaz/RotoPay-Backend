// src/routes/shift.router.ts
// ─────────────────────────────────────────────
// Shift Router — CRUD
// Chain: authenticate → validate(params/body) → controller
// Every route requires a logged-in user.
// ─────────────────────────────────────────────

import { Router } from "express";
import * as shiftController from "../controllers/shift.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import { createShiftSchema, updateShiftSchema } from "../helpers/shift.validation";

const router = Router();

// All shift routes are protected.
router.use(authenticate);

router.post("/",        validate(createShiftSchema),                                    shiftController.createShift);
router.get("/",                                                                         shiftController.getShifts);
// Static path must come before "/:id" so it isn't treated as an id.
router.get("/analytics",                                                                shiftController.getShiftAnalytics);
router.get("/:id",      validateParams(idParamSchema),                                  shiftController.getShiftById);
router.patch("/:id",    validateParams(idParamSchema),  validate(updateShiftSchema),    shiftController.updateShift);
router.delete("/:id",   validateParams(idParamSchema),                                  shiftController.deleteShift);

export default router;