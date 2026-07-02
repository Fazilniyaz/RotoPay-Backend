// src/helpers/shift.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Shift Module
//
// A shift is a SINGLE calendar day. The UI no longer sends a `date` — a shift is
// always "today"; the server defaults it and rejects any non-today date sent by
// a client. `totalHours` is derived server-side from start/end times (the client
// value, if any, is ignored). `shiftType` is free-form. A `color` label is chosen
// at creation and rendered on the calendar.
// ─────────────────────────────────────────────

import { z } from "zod";

// Free-form type — presets or a custom label the user typed.
const shiftType = z
  .string({ required_error: "Shift type is required" })
  .trim()
  .min(1, "Shift type is required")
  .max(40, "Shift type is too long");

// Optional hex colour (#rgb or #rrggbb).
const color = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Colour must be a hex value like #005ea3")
  .optional();

// True when the given date falls on the server's current calendar day.
const isToday = (d: Date): boolean => {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

// ── Create ─────────────────────────────────────

export const createShiftSchema = z
  .object({
    shiftName: z.string().max(100, "Shift name is too long").trim().optional(),
    // Optional — defaults to today server-side. If sent, it MUST be today.
    date: z.coerce.date({ invalid_type_error: "Date must be a valid date" }).optional(),
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
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  })
  .refine((d) => d.date === undefined || isToday(d.date), {
    message: "A shift can only be created for today",
    path: ["date"],
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
    color,
    isManualEntry: z.boolean().optional(),
    notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
