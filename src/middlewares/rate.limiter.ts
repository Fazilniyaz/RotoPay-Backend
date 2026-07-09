// src/middlewares/rate.limiter.ts
// ─────────────────────────────────────────────
// Rate Limiters
// Auth endpoints get stricter limits to prevent brute force
// ─────────────────────────────────────────────

import rateLimit from "express-rate-limit";
import { env } from "../utilities/env";
import { MongoRateStore } from "./mongo.rate.store";

// In development we skip rate limiting entirely — an SPA dashboard fires many
// requests per page (and hot-reloads constantly), which trips low limits.
const isDev = env.NODE_ENV === "development";

// Shared MongoDB-backed store so limits are GLOBAL across serverless instances
// (the default MemoryStore is per-lambda and resets on cold starts, so limits
// barely bite on Vercel). Each limiter gets its own key prefix. The store fails
// OPEN, so a Mongo hiccup never blocks legitimate traffic. See mongo.rate.store.
const mongoStore = (prefix: string) => new MongoRateStore(prefix);

// ── General API Limiter ────────────────────────
// Generous by default (a single dashboard page can fire 5–6 calls plus token
// refreshes); disabled in development.

// Kept on the default in-memory store on purpose: it fires on EVERY /api call,
// so a shared DB-backed counter would add a write per request. Coarse per-instance
// throttling is fine here; volumetric DoS is handled at the edge (Cloud Armor /
// Vercel), and the security-sensitive AUTH limiters below use the shared store.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
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
  skip: () => isDev,
  store: mongoStore("auth:"),
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
  skip: () => isDev,
  store: mongoStore("resend:"),
  message: {
    success: false,
    message: "Too many email requests — please try again in 1 hour",
  },
});
