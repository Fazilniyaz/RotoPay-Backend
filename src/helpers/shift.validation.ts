// src/helpers/shift.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Shift Module
//
// A shift is a SINGLE calendar day: `date` + start/end times. `totalHours` is
// calculated on the frontend and sent in the request. `shiftType` is free-form
// (day | night | rotational, or a user-supplied custom label).
//
// Shifts no longer carry inline salary/employee assignments — wages are created
// separately via /api/salaries. Status (upcoming|active|completed) is derived
// server-side from `date` + times.
// ─────────────────────────────────────────────

import { z } from "zod";

// Free-form type — presets or a custom label the user typed.
const shiftType = z
  .string({ required_error: "Shift type is required" })
  .trim()
  .min(1, "Shift type is required")
  .max(40, "Shift type is too long");

// ── Create ─────────────────────────────────────

export const createShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    date: z.coerce.date({
      required_error: "Date is required",
      invalid_type_error: "Date must be a valid date",
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
    shiftType,
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  });

// ── Update (shift fields only; wages are managed via /api/salaries) ──

export const updateShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    date: z.coerce.date({ invalid_type_error: "Date must be a valid date" }).optional(),
    startTime: z.coerce
      .date({ invalid_type_error: "Start time must be a valid date/time" })
      .optional(),
    endTime: z.coerce
      .date({ invalid_type_error: "End time must be a valid date/time" })
      .optional(),
    totalHours: z.number().nonnegative("Total hours cannot be negative").max(168).optional(),
    shiftType: shiftType.optional(),
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
