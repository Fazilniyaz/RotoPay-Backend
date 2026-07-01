// src/routes/currency.router.ts
// ─────────────────────────────────────────────
// Currency Router — live conversion rates
// ─────────────────────────────────────────────

import { Router } from "express";
import * as currencyController from "../controllers/currency.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/rate", currencyController.getConversionRate);

export default router;
