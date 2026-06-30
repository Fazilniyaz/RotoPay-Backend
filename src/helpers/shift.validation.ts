// src/helpers/shift.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Shift Module
//
// Shift and Employer are independent — they connect ONLY through Salary rows.
// `totalHours` is calculated on the frontend and sent in the request.
// `shiftType` is one of: night | day | rotational.
// On create the client may optionally attach `salaries` — one entry per
// employer assigned to the shift, each with its own pay value. Those create
// Salary rows. (Editing the salary rows afterwards is done via /api/salaries.)
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

export const shiftTypeEnum = z.enum(["night", "day", "rotational"], {
  required_error: "Shift type is required",
  invalid_type_error: "Shift type must be one of: night, day, rotational",
});

const salaryValue = z
  .number({ required_error: "Salary value is required" })
  .nonnegative("Salary cannot be negative")
  .max(10_000_000, "Salary value is unrealistically high");

// One employer+salary assignment supplied at shift-creation time.
const salaryAssignmentSchema = z.object({
  employerId: objectId,
  salary: salaryValue,
});

// ── Create ─────────────────────────────────────

export const createShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    startDate: z.coerce.date({
      required_error: "Start date is required",
      invalid_type_error: "Start date must be a valid date",
    }),
    endDate: z.coerce.date({
      required_error: "End date is required",
      invalid_type_error: "End date must be a valid date",
    }),
    startTime: z.coerce.date({
      required_error: "Start time is required",
      invalid_type_error: "Start time must be a valid date/time",
    }),
    endTime: z.coerce.date({
      required_error: "End time is required",
      invalid_type_error: "End time must be a valid date/time",
    }),
    totalHours: z
      .number({ required_error: "Total hours is required" })
      .nonnegative("Total hours cannot be negative")
      .max(168, "Total hours cannot exceed a week"),
    breakDuration: z
      .number()
      .min(0, "Break duration cannot be negative")
      .max(1440, "Break duration cannot exceed 24 hours")
      .optional(),
    shiftType: shiftTypeEnum,
    confirmed: z.boolean().optional(),
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),

    // Optional — populated when the "add employee & their salary" box is ticked.
    salaries: z.array(salaryAssignmentSchema).max(50, "Too many salary assignments").optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

// ── Update (shift fields only; salaries are managed via /api/salaries) ──

export const updateShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    startDate: z.coerce.date({ invalid_type_error: "Start date must be a valid date" }).optional(),
    endDate: z.coerce.date({ invalid_type_error: "End date must be a valid date" }).optional(),
    startTime: z.coerce
      .date({ invalid_type_error: "Start time must be a valid date/time" })
      .optional(),
    endTime: z.coerce
      .date({ invalid_type_error: "End time must be a valid date/time" })
      .optional(),
    totalHours: z.number().nonnegative("Total hours cannot be negative").max(168).optional(),
    breakDuration: z.number().min(0).max(1440).optional(),
    shiftType: shiftTypeEnum.optional(),
    confirmed: z.boolean().optional(),
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  })
  .refine(
    (data) => !(data.startDate && data.endDate) || data.endDate >= data.startDate,
    { message: "End date must be on or after start date", path: ["endDate"] }
  )
  .refine(
    (data) => !(data.startTime && data.endTime) || data.endTime > data.startTime,
    { message: "End time must be after start time", path: ["endTime"] }
  );

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
