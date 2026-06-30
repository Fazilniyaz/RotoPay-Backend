// src/routes/calendar.router.ts
// ─────────────────────────────────────────────
// Calendar Router — CRUD for calendar entries
// ─────────────────────────────────────────────

import { Router } from "express";
import * as calendarController from "../controllers/calendar.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import { createCalendarSchema, updateCalendarSchema } from "../helpers/calendar.validation";

const router = Router();

router.use(authenticate);

router.post("/",        validate(createCalendarSchema),                                 calendarController.createCalendarEntry);
router.get("/",                                                                         calendarController.getCalendarEntries);
router.get("/:id",      validateParams(idParamSchema),                                  calendarController.getCalendarEntryById);
router.patch("/:id",    validateParams(idParamSchema),  validate(updateCalendarSchema), calendarController.updateCalendarEntry);
router.delete("/:id",   validateParams(idParamSchema),                                  calendarController.deleteCalendarEntry);

export default router;
