// src/helpers/calendar.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Calendar Entry
// `title` is custom text limited to 15 words. Optionally links to a Shift.
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

const title = z
  .string({ required_error: "Title is required" })
  .trim()
  .min(1, "Title cannot be empty")
  .max(120, "Title is too long")
  .refine((v) => v.split(/\s+/).filter(Boolean).length <= 15, {
    message: "Title must be 15 words or fewer",
  });

export const createCalendarSchema = z.object({
  date: z.coerce.date({
    required_error: "Date is required",
    invalid_type_error: "Date must be a valid date",
  }),
  title,
  shiftId: objectId.optional(),
  color: z.string().max(20).optional(),
});

export const updateCalendarSchema = z
  .object({
    date: z.coerce.date({ invalid_type_error: "Date must be a valid date" }).optional(),
    title: title.optional(),
    shiftId: objectId.nullable().optional(),
    color: z.string().max(20).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Provide at least one field to update" });

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
