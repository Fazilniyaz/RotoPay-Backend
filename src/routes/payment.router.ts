// src/routes/payment.router.ts
// ─────────────────────────────────────────────
// Payment Router — mark/unmark months as paid
// ─────────────────────────────────────────────

import { Router } from "express";
import * as paymentController from "../controllers/payment.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { markPaymentSchema } from "../helpers/payment.validation";

const router = Router();

router.use(authenticate);

router.get("/", paymentController.listPaidMonths);
router.post("/mark", validate(markPaymentSchema), paymentController.markMonthPaid);
router.delete("/", validate(markPaymentSchema), paymentController.unmarkMonthPaid);

export default router;
