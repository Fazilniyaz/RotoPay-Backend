// src/routes/report.router.ts
// ─────────────────────────────────────────────
// Report Router — generate + history
// ─────────────────────────────────────────────

import { Router } from "express";
import * as reportController from "../controllers/report.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import { generateReportSchema } from "../helpers/report.validation";

const router = Router();

router.use(authenticate);

router.post("/generate", validate(generateReportSchema), reportController.generateReport);
router.get("/", reportController.listReports);
router.get("/:id", validateParams(idParamSchema), reportController.getReportById);

export default router;
