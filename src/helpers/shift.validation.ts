// src/helpers/shift.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Shift Module
//
// A shift is a reusable PRESET with NO date — `startTime`/`endTime` carry only a
// time-of-day (the client sends them built against an arbitrary day). `totalHours`
// is derived server-side from the times. Every preset is allocated to exactly one
// employee (`employerId`). `shiftType` is free-form. A `color` label is chosen at
// creation and rendered on the calendar.
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

// Free-form type — presets or a custom label the user typed.
const shiftType = z
  .string({ required_error: "Shift type is required" })
  .trim()
  .min(1, "Shift type is required")
  .max(40, "Shift type is too long");

// Optional hex colour (#rgb or #rrggbb).
const color = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Colour must be a hex value like #7fa9e0")
  .optional();

// ── Create ─────────────────────────────────────

export const createShiftSchema = z.object({
  shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
  startTime: z.coerce.date({
    required_error: "Start time is required",
    invalid_type_error: "Start time must be a valid date/time",
  }),
  endTime: z.coerce.date({
    required_error: "End time is required",
    invalid_type_error: "End time must be a valid date/time",
  }),
  // Client value is ignored (server derives it), but accepted for compatibility.
  totalHours: z.number().nonnegative().max(168).optional(),
  shiftType,
  color,
  // The employee this preset is allocated to — required.
  employerId: objectId,
  isManualEntry: z.boolean().optional(),
  notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
});

// ── Update (preset fields only; wages are managed via /api/salaries) ──

export const updateShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    startTime: z.coerce
      .date({ invalid_type_error: "Start time must be a valid date/time" })
      .optional(),
    endTime: z.coerce
      .date({ invalid_type_error: "End time must be a valid date/time" })
      .optional(),
    totalHours: z.number().nonnegative("Total hours cannot be negative").max(168).optional(),
    shiftType: shiftType.optional(),
    color,
    employerId: objectId.optional(),
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
