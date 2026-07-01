// src/helpers/report.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Report generation
// ─────────────────────────────────────────────

import { z } from "zod";

export const generateReportSchema = z.object({
  months: z
    .number()
    .int("Months must be a whole number")
    .min(1, "You can report between 1 and 3 months")
    .max(3, "You can report between 1 and 3 months")
    .optional(),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
