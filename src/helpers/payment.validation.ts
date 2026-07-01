// src/helpers/payment.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Payments (marking a month as paid)
// ─────────────────────────────────────────────

import { z } from "zod";

export const markPaymentSchema = z.object({
  year: z
    .number({ required_error: "Year is required" })
    .int("Year must be a whole number")
    .min(2000, "Year is out of range")
    .max(2100, "Year is out of range"),
  month: z
    .number({ required_error: "Month is required" })
    .int("Month must be a whole number")
    .min(1, "Month must be between 1 and 12")
    .max(12, "Month must be between 1 and 12"),
});

export type MarkPaymentInput = z.infer<typeof markPaymentSchema>;
