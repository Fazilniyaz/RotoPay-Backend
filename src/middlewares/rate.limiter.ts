// src/middlewares/rate.limiter.ts
// ─────────────────────────────────────────────
// Rate Limiters
// Auth endpoints get stricter limits to prevent brute force
// ─────────────────────────────────────────────

import rateLimit from "express-rate-limit";

// ── General API Limiter ────────────────────────
// 100 requests per 15 minutes per IP

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP — please try again in 15 minutes",
  },
});

// ── Auth Limiter ───────────────────────────────
// 10 requests per 15 minutes per IP (login, register, etc.)

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many auth attempts — please try again in 15 minutes",
  },
});

// ── Resend Email Limiter ───────────────────────
// 3 resend requests per hour per IP (prevent email spam)

export const resendEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many email requests — please try again in 1 hour",
  },
});
