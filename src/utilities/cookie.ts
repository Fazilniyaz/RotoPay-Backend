// src/utilities/cookie.ts
// ─────────────────────────────────────────────
// Secure cookie defaults (blueprint point 4).
//
// The app currently authenticates with Bearer tokens (no session cookies), so
// there are no insecure cookies today. IF a session/refresh cookie is ever
// introduced, set it with these options so it is always:
//   • HttpOnly  — unreadable from JS (mitigates XSS token theft)
//   • Secure    — only sent over HTTPS
//   • SameSite  — "lax" (allows top-level nav) or "strict" for pure APIs
//   • signed / short-lived as appropriate.
//
//   res.cookie("refreshToken", token, secureCookie({ maxAge: SEVEN_DAYS }));
// ─────────────────────────────────────────────

import type { CookieOptions } from "express";
import { env } from "./env";

export function secureCookie(overrides: Partial<CookieOptions> = {}): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production", // HTTPS-only in prod; relaxed for local http
    sameSite: "lax",
    path: "/",
    ...overrides,
  };
}
