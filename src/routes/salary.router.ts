// src/routes/salary.router.ts
// ─────────────────────────────────────────────
// Salary Router — CRUD
// Chain: authenticate → validate(params/body) → controller
// Every route requires a logged-in user.
// ─────────────────────────────────────────────

import { Router } from "express";
import * as salaryController from "../controllers/salary.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import { createSalarySchema, updateSalarySchema } from "../helpers/salary.validation";

const router = Router();

// All salary routes are protected.
router.use(authenticate);

router.post("/",        validate(createSalarySchema),                                   salaryController.createSalary);
router.get("/",                                                                         salaryController.getSalaries);
router.get("/:id",      validateParams(idParamSchema),                                  salaryController.getSalaryById);
router.patch("/:id",    validateParams(idParamSchema),  validate(updateSalarySchema),   salaryController.updateSalary);
router.delete("/:id",   validateParams(idParamSchema),                                  salaryController.deleteSalary);

export default router;
