// src/utilities/jwt.ts
// ─────────────────────────────────────────────
// JWT Token Utilities
// Handles signing, verifying, and decoding tokens
// ─────────────────────────────────────────────

import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";
import { env } from "./env";

// ── Types ──────────────────────────────────────

export interface AccessTokenPayload {
  userId: string;
  email: string;
  type: "access";
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  type: "refresh";
}

export interface DecodedToken extends JwtPayload {
  userId: string;
  email?: string;
  sessionId?: string;
  type: "access" | "refresh";
}

// ── Sign Tokens ────────────────────────────────

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: "rotapay",
    audience: "rotapay-client",
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: "rotapay",
    audience: "rotapay-client",
  } as SignOptions);
}

// ── Verify Tokens ──────────────────────────────

export function verifyAccessToken(token: string): DecodedToken {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "rotapay",
    audience: "rotapay-client",
  }) as DecodedToken;
}

export function verifyRefreshToken(token: string): DecodedToken {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: "rotapay",
    audience: "rotapay-client",
  }) as DecodedToken;
}

// ── Decode Without Verifying (for debugging only) ──

export function decodeToken(token: string): DecodedToken | null {
  return jwt.decode(token) as DecodedToken | null;
}

// ── Calculate Refresh Token Expiry Date ────────

export function getRefreshTokenExpiryDate(): Date {
  // Parse "7d" → milliseconds
  const expiresIn = env.JWT_REFRESH_EXPIRES_IN;
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid JWT_REFRESH_EXPIRES_IN format: ${expiresIn}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + value * multipliers[unit]);
}
