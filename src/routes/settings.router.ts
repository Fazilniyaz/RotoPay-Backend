// src/routes/settings.router.ts
// ─────────────────────────────────────────────
// Settings Router — profile + global preferences
// ─────────────────────────────────────────────

import { Router } from "express";
import * as settingsController from "../controllers/settings.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { updateSettingsSchema } from "../helpers/settings.validation";

const router = Router();

router.use(authenticate);

router.get("/",     settingsController.getSettings);
router.patch("/",   validate(updateSettingsSchema), settingsController.updateSettings);

export default router;
