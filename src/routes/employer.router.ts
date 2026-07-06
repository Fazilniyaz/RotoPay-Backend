
// src/routes/employer.router.ts
// ─────────────────────────────────────────────
// Employer Router — CRUD
// Chain: authenticate → validate(params/body) → controller
// Every route requires a logged-in user.
// ─────────────────────────────────────────────

import { Router } from "express";
import * as employerController from "../controllers/employer.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../helpers/auth.validation";
import { validateParams, idParamSchema } from "../helpers/validators";
import {
  createEmployerSchema,
  updateEmployerSchema,
} from "../helpers/employer.validation";

const router = Router();

// All employer routes are protected.
router.use(authenticate);

router.post("/",        validate(createEmployerSchema),                                       employerController.createEmployer);
router.get("/",                                                                                employerController.getEmployers);
router.get("/:id",      validateParams(idParamSchema),                                         employerController.getEmployerById);
router.patch("/:id/set-default", validateParams(idParamSchema),                                employerController.setDefaultEmployer);
router.patch("/:id",    validateParams(idParamSchema),  validate(updateEmployerSchema),        employerController.updateEmployer);
router.delete("/:id",   validateParams(idParamSchema),                                         employerController.deleteEmployer);

export default router;
