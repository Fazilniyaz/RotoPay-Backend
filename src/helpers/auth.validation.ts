// src/helpers/auth.validation.ts
// ─────────────────────────────────────────────
// Zod Validation Schemas — Auth Module
// Validate & sanitise all incoming request bodies
// ─────────────────────────────────────────────

import { z, ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";
import { sendValidationError } from "./api.response";

// ── Schema Definitions ─────────────────────────

export const registerSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),

  password: z
    .string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be less than 72 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),

  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be less than 50 characters")
    .trim()
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),

  password: z.string({ required_error: "Password is required" }).min(1, "Password is required"),
});

export const googleAuthSchema = z.object({
  idToken: z
    .string({ required_error: "Google ID token is required" })
    .min(1, "Google ID token cannot be empty"),
});

export const verifyEmailSchema = z.object({
  token: z
    .string({ required_error: "Verification token is required" })
    .min(1, "Token cannot be empty"),
});

export const resendVerificationSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),
});

export const resetPasswordSchema = z.object({
  token: z
    .string({ required_error: "Reset token is required" })
    .min(1, "Token cannot be empty"),

  password: z
    .string({ required_error: "New password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be less than 72 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ required_error: "Refresh token is required" })
    .min(1, "Refresh token cannot be empty"),
});

// logout has no body — the session is identified purely from the
// Authorization: Bearer <accessToken> header (handled by authenticate middleware)

// ── Validation Middleware Factory ──────────────
// Usage: router.post('/register', validate(registerSchema), authController.register)

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Convert Zod errors to { fieldName: ["error message"] } format
      const errors: Record<string, string[]> = {};
      result.error.errors.forEach((err) => {
        const field = err.path.join(".") || "general";
        if (!errors[field]) errors[field] = [];
        errors[field].push(err.message);
      });

      sendValidationError(res, errors);
      return;
    }

    // Attach parsed & sanitised data back to request body
    req.body = result.data;
    next();
  };
}
