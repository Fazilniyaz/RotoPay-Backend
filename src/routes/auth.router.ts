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
import { recaptchaGuard } from "../middlewares/recaptcha.middleware";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ── Phase 1 (existing) ─────────────────────────────────────────
// Chain: rate limiter → reCAPTCHA (web only) → validator → controller

router.post("/register",              authLimiter,        recaptchaGuard("register"),        validate(registerSchema),             authController.register);
router.post("/login",                 authLimiter,        recaptchaGuard("login"),           validate(loginSchema),                authController.login);
router.post("/google",                authLimiter,        validate(googleAuthSchema),           authController.googleAuth);
router.post("/verify-email",                              validate(verifyEmailSchema),          authController.verifyEmail);
router.post("/resend-verification",   resendEmailLimiter, recaptchaGuard("resend"),          validate(resendVerificationSchema),   authController.resendVerification);

// ── Phase 2 (new) ──────────────────────────────────────────────

// Forgot password — rate limited (same as auth), validated, no auth required
router.post("/forgot-password",       resendEmailLimiter, recaptchaGuard("forgot_password"), validate(forgotPasswordSchema),       authController.forgotPassword);

// Reset password — validated, no auth required (user doesn't have a token yet)
router.post("/reset-password",                            validate(resetPasswordSchema),        authController.resetPassword);

// Refresh token — validated, no auth middleware (access token is expired by design)
router.post("/refresh-token",                             validate(refreshTokenSchema),         authController.refreshToken);

// Logout — requires a valid access token (authenticate middleware runs first)
// Body is optional: { logoutAll: true } logs out from all devices
router.post("/logout",                authenticate,                                             authController.logout);

export default router;
