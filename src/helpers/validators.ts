// src/helpers/validators.ts
// ─────────────────────────────────────────────
// Shared Validation Helpers
// Reusable Zod pieces + a route-param validator middleware.
// (The body validator `validate` lives in auth.validation.ts and is
//  imported by routers — this file only adds param validation.)
// ─────────────────────────────────────────────

import { z, ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";
import { sendValidationError } from "./api.response";

// ── MongoDB ObjectId ───────────────────────────
// Mongo _id values are 24-character hex strings. Validating the shape
// up-front gives a clean 422 instead of a Prisma crash deep in the query.

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id — must be a 24-character hex string");

// Most routes use `/:id` — this is the param schema for them.
export const idParamSchema = z.object({ id: objectId });

// ── Param Validation Middleware ────────────────
// Mirrors `validate` (which checks req.body) but for req.params.
// Usage: router.get("/:id", validateParams(idParamSchema), controller.getOne)

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const errors: Record<string, string[]> = {};
      result.error.errors.forEach((err) => {
        const field = err.path.join(".") || "general";
        if (!errors[field]) errors[field] = [];
        errors[field].push(err.message);
      });
      sendValidationError(res, errors);
      return;
    }

    next();
  };
}

// ── Pagination Parser ──────────────────────────
// Lists accept ?page=&limit= — parse defensively with sane defaults and
// an upper bound so a client can't request 1,000,000 rows in one call.

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}