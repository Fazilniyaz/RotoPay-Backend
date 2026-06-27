// src/helpers/token.helper.ts
// ─────────────────────────────────────────────
// Secure Token Generator
// Used for email verification & password reset tokens
// ─────────────────────────────────────────────

import { randomBytes } from "crypto";
import { env } from "../utilities/env";

// ── Generate a Cryptographically Secure Token ──

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

// ── Token Expiry Helpers ───────────────────────

export function getEmailVerifyExpiry(): Date {
  const hours = env.EMAIL_VERIFY_TOKEN_EXPIRES_HOURS;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function getPasswordResetExpiry(): Date {
  // Password reset tokens always expire in 1 hour
  return new Date(Date.now() + 60 * 60 * 1000);
}

// ── Check if a token has expired ──────────────

export function isTokenExpired(expiry: Date | null): boolean {
  if (!expiry) return true;
  return new Date() > expiry;
}
