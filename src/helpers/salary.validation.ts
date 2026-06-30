// src/helpers/salary.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Salary Module
//
// A Salary row links a Shift to an Employer and carries the pay value.
// Both shiftId and employerId are optional (a row can be created/edited with
// either side detached), but `salary` (the value) is always required on create.
// On update, passing null for shiftId/employerId clears that link.
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

const salaryValue = z
  .number({ required_error: "Salary value is required" })
  .nonnegative("Salary cannot be negative")
  .max(10_000_000, "Salary value is unrealistically high");

// ── Create ─────────────────────────────────────

export const createSalarySchema = z.object({
  shiftId: objectId.optional(),
  employerId: objectId.optional(),
  salary: salaryValue,
});

// ── Update ─────────────────────────────────────
// nullable → the client can send null to detach the shift/employer link.

export const updateSalarySchema = z
  .object({
    shiftId: objectId.nullable().optional(),
    employerId: objectId.nullable().optional(),
    salary: salaryValue.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateSalaryInput = z.infer<typeof createSalarySchema>;
export type UpdateSalaryInput = z.infer<typeof updateSalarySchema>;
