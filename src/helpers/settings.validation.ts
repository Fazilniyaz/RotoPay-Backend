// src/helpers/settings.validation.ts
// ─────────────────────────────────────────────
// Zod Validation — Settings (profile + global preferences)
// ─────────────────────────────────────────────

import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    displayName: z
      .string()
      .min(2, "Display name must be at least 2 characters")
      .max(50, "Display name must be less than 50 characters")
      .trim()
      .optional(),
    currency: z
      .string()
      .length(3, "Currency must be a 3-letter ISO code (e.g. GBP)")
      .toUpperCase()
      .optional(),
    nativeCurrency: z
      .string()
      .length(3, "Native currency must be a 3-letter ISO code (e.g. INR)")
      .toUpperCase()
      .optional(),
    dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
    timeFormat: z.enum(["12h", "24h"]).optional(),
    reportMonths: z
      .number()
      .int("Report range must be a whole number of months")
      .min(1, "Report range must be between 1 and 3 months")
      .max(3, "Report range must be between 1 and 3 months")
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Provide at least one field to update" });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
