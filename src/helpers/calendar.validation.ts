// src/helpers/calendar.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Calendar Entry
//
// An entry is one of three kinds:
//   event | memo  → a titled, coloured note the user composes on a day.
//   shift         → a coloured LABEL that surfaces an existing shift on the
//                   calendar (requires shiftId).
// `title` is custom text limited to 15 words. Entries may be scoped to an
// employee via employerId (null = the user's own calendar).
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

const entryType = z.enum(["event", "memo", "shift"], {
  invalid_type_error: "Type must be event, memo or shift",
});

export const createCalendarSchema = z
  .object({
    date: z.coerce.date({
      required_error: "Date is required",
      invalid_type_error: "Date must be a valid date",
    }),
    type: entryType.default("memo"),
    title,
    shiftId: objectId.optional(),
    employerId: objectId.optional(),
    color: z.string().max(20).optional(),
  })
  .refine((d) => d.type !== "shift" || !!d.shiftId, {
    message: "A shift label requires a shiftId",
    path: ["shiftId"],
  });

export const updateCalendarSchema = z
  .object({
    date: z.coerce.date({ invalid_type_error: "Date must be a valid date" }).optional(),
    type: entryType.optional(),
    title: title.optional(),
    shiftId: objectId.nullable().optional(),
    employerId: objectId.nullable().optional(),
    color: z.string().max(20).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Provide at least one field to update" });

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
