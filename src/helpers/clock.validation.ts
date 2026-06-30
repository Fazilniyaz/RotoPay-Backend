// src/helpers/clock.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Clock In/Out
// Clock-in references a Salary row (which carries the employer + shift + rate).
// ─────────────────────────────────────────────

import { z } from "zod";
import { objectId } from "./validators";

export const clockInSchema = z.object({
  salaryId: objectId,
  notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),
});

export type ClockInInput = z.infer<typeof clockInSchema>;
