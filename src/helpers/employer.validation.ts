// src/helpers/employer.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Employer Module
// An "Employer" is a place/company the user works for (store + pay rate).
// ─────────────────────────────────────────────

import { z } from "zod";

// ── Create ─────────────────────────────────────

export const createEmployerSchema = z.object({
  store: z
    .string({ required_error: "Store is required" })
    .min(1, "Store cannot be empty")
    .max(100, "Store must be less than 100 characters")
    .trim(),

  employerName: z
    .string({ required_error: "Employer name is required" })
    .min(1, "Employer name cannot be empty")
    .max(100, "Employer name must be less than 100 characters")
    .trim(),

  notes: z.string().max(500, "Notes must be less than 500 characters").trim().optional(),

  isActive: z.boolean().optional(),
});

// ── Update ─────────────────────────────────────
// Every field optional (partial update), but at least one must be present
// so PATCH with an empty body is rejected instead of being a silent no-op.

export const updateEmployerSchema = createEmployerSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

// ── Inferred Types ─────────────────────────────

export type CreateEmployerInput = z.infer<typeof createEmployerSchema>;
export type UpdateEmployerInput = z.infer<typeof updateEmployerSchema>;