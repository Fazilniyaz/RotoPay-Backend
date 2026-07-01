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

// Wage rate basis.
const rateType = z.enum(["hourly", "weekly", "monthly"], {
  invalid_type_error: "Rate type must be hourly, weekly or monthly",
});

// 3-letter ISO currency code (e.g. GBP), uppercased.
const currency = z
  .string()
  .length(3, "Currency must be a 3-letter ISO code (e.g. GBP)")
  .toUpperCase();

// ── Create ─────────────────────────────────────

export const createSalarySchema = z.object({
  shiftId: objectId.optional(),
  employerId: objectId.optional(),
  salary: salaryValue,
  rateType: rateType.optional(),
  currency: currency.optional(),
});

// ── Update ─────────────────────────────────────
// nullable → the client can send null to detach the shift/employer link.

export const updateSalarySchema = z
  .object({
    shiftId: objectId.nullable().optional(),
    employerId: objectId.nullable().optional(),
    salary: salaryValue.optional(),
    rateType: rateType.optional(),
    currency: currency.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateSalaryInput = z.infer<typeof createSalarySchema>;
export type UpdateSalaryInput = z.infer<typeof updateSalarySchema>;
