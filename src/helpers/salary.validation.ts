// src/helpers/salary.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Salary Module
//
// A Salary row is the wage (hourly rate) for a shift preset. The employee is NO
// LONGER chosen here — it is auto-derived from the linked shift's employer. The
// client sends only shiftId + rate (+ currency); any employerId is ignored.
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

// The hourly pay rate the user enters. Per-day/total pay is derived server-side
// as hourlyPayRate × the linked shift's totalHours.
const hourlyRate = z
  .number({ required_error: "Hourly rate is required" })
  .nonnegative("Hourly rate cannot be negative")
  .max(1_000_000, "Hourly rate is unrealistically high");

// Wages are hourly-only now (weekly/monthly removed).
const rateType = z.literal("hourly");

// 3-letter ISO currency code (e.g. GBP), uppercased.
const currency = z
  .string()
  .length(3, "Currency must be a 3-letter ISO code (e.g. GBP)")
  .toUpperCase();

// ── Create ─────────────────────────────────────

export const createSalarySchema = z.object({
  shiftId: objectId.optional(),
  hourlyPayRate: hourlyRate,
  rateType: rateType.optional(),
  currency: currency.optional(),
});

// ── Update ─────────────────────────────────────
// nullable → the client can send null to detach the shift link.

export const updateSalarySchema = z
  .object({
    shiftId: objectId.nullable().optional(),
    hourlyPayRate: hourlyRate.optional(),
    rateType: rateType.optional(),
    currency: currency.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateSalaryInput = z.infer<typeof createSalarySchema>;
export type UpdateSalaryInput = z.infer<typeof updateSalarySchema>;
