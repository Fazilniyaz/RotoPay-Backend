// src/routes/settings.router.ts
// ─────────────────────────────────────────────
// Settings Router — profile + global preferences
// ─────────────────────────────────────────────

import { Router } from "express";
import express from "express";
import * as settingsController from "../controllers/settings.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { updateSettingsSchema } from "../helpers/settings.validation";

const router = Router();

router.use(authenticate);

// The global body parser caps JSON at 10kb; base64 images need more headroom.
// This route-scoped parser re-reads the body with a larger limit.
const imageJson = express.json({ limit: "8mb" });

router.get("/",     settingsController.getSettings);
router.patch("/",   validate(updateSettingsSchema), settingsController.updateSettings);

router.patch("/profile-picture", imageJson, settingsController.updateProfilePicture);
router.delete("/profile-picture", settingsController.deleteProfilePicture);

// Permanently delete the authenticated user's account (cascades to all data).
router.delete("/account", settingsController.deleteAccount);

export default router;
