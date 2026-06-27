// src/utilities/env.ts
// ─────────────────────────────────────────────
// Environment Variable Validator
// Fails fast at startup if required vars are missing
// ─────────────────────────────────────────────

import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[ENV] Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV: optionalEnv("NODE_ENV", "development"),
  PORT: parseInt(optionalEnv("PORT", "5000"), 10),
  CLIENT_URL: optionalEnv("CLIENT_URL", "http://localhost:3000"),

  // JWT
  JWT_ACCESS_SECRET: requireEnv("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: requireEnv("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES_IN: optionalEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_REFRESH_EXPIRES_IN: optionalEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Email (SMTP)
  SMTP_HOST: optionalEnv("SMTP_HOST", "smtp.gmail.com"),
  SMTP_PORT: parseInt(optionalEnv("SMTP_PORT", "587"), 10),
  SMTP_SECURE: optionalEnv("SMTP_SECURE", "false") === "true",
  SMTP_USER: requireEnv("SMTP_USER"),
  SMTP_PASS: requireEnv("SMTP_PASS"),
  EMAIL_FROM_NAME: optionalEnv("EMAIL_FROM_NAME", "RotaPay"),
  EMAIL_FROM_ADDRESS: requireEnv("EMAIL_FROM_ADDRESS"),

  // Google OAuth
  GOOGLE_CLIENT_ID: requireEnv("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: requireEnv("GOOGLE_CLIENT_SECRET"),

  // Tokens
  EMAIL_VERIFY_TOKEN_EXPIRES_HOURS: parseInt(
    optionalEnv("EMAIL_VERIFY_TOKEN_EXPIRES_HOURS", "24"),
    10
  ),
  BCRYPT_ROUNDS: parseInt(optionalEnv("BCRYPT_ROUNDS", "12"), 10),
} as const;
