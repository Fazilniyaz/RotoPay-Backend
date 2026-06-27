// src/routes/auth.router.ts
// ─────────────────────────────────────────────
// Auth Router — all 9 endpoints
// Chain: rate limiter → validator → [authenticate] → controller
// ─────────────────────────────────────────────

import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import {
  validate,
  registerSchema,
  loginSchema,
  googleAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from "../helpers/auth.validation";
import { authLimiter, resendEmailLimiter } from "../middlewares/rate.limiter";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ── Phase 1 (existing) ─────────────────────────────────────────

router.post("/register",              authLimiter,        validate(registerSchema),             authController.register);
router.post("/login",                 authLimiter,        validate(loginSchema),                authController.login);
router.post("/google",                authLimiter,        validate(googleAuthSchema),           authController.googleAuth);
router.post("/verify-email",                              validate(verifyEmailSchema),          authController.verifyEmail);
router.post("/resend-verification",   resendEmailLimiter, validate(resendVerificationSchema),   authController.resendVerification);

// ── Phase 2 (new) ──────────────────────────────────────────────

// Forgot password — rate limited (same as auth), validated, no auth required
router.post("/forgot-password",       resendEmailLimiter, validate(forgotPasswordSchema),       authController.forgotPassword);

// Reset password — validated, no auth required (user doesn't have a token yet)
router.post("/reset-password",                            validate(resetPasswordSchema),        authController.resetPassword);

// Refresh token — validated, no auth middleware (access token is expired by design)
router.post("/refresh-token",                             validate(refreshTokenSchema),         authController.refreshToken);

// Logout — requires a valid access token (authenticate middleware runs first)
// Body is optional: { logoutAll: true } logs out from all devices
router.post("/logout",                authenticate,                                             authController.logout);

export default router;
