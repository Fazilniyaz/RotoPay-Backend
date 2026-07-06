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

  // Number of trusted reverse-proxy hops in front of the app. Behind the GCP
  // external HTTPS Load Balancer + Cloud Armor this is 1 — trusting that one hop
  // lets Express read the REAL client IP from X-Forwarded-For (so rate limiting
  // and logs act on the caller, not the load balancer). A NUMBER, never `true`,
  // so a forged X-Forwarded-For can't be trusted end-to-end. 0 = disabled
  // (direct connections / local dev). Defaults to 1 in production, 0 otherwise.
  TRUST_PROXY: parseInt(
    optionalEnv("TRUST_PROXY", optionalEnv("NODE_ENV", "development") === "production" ? "1" : "0"),
    10
  ),

  // Default client URL — used as the fallback when the request carries no
  // recognisable client signal (keeps legacy behaviour intact).
  CLIENT_URL: optionalEnv("CLIENT_URL", "http://localhost:3000"),

  // Per-client base URLs. Email links (verify / reset / welcome) are built
  // against whichever of these matches the originating client, so one deployed
  // backend can serve the web app (local + Vercel) and the native app
  // (local Expo + Play Store) simultaneously. See utilities/client-url.ts.
  CLIENT_URL_WEB_LOCAL: optionalEnv("CLIENT_URL_WEB_LOCAL", "http://localhost:3000"),
  CLIENT_URL_WEB_PROD: optionalEnv("CLIENT_URL_WEB_PROD", "https://roto-pay-admin-web-app.vercel.app"),
  CLIENT_URL_MOBILE_LOCAL: optionalEnv("CLIENT_URL_MOBILE_LOCAL", "http://localhost:8081"),
  CLIENT_URL_MOBILE: optionalEnv("CLIENT_URL_MOBILE", "rotopay://"),

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

  // ImageKit (profile picture storage)
  IMAGEKIT_URL_ENDPOINT: requireEnv("IMAGEKIT_URL_ENDPOINT"),
  IMAGEKIT_PUBLIC_KEY: requireEnv("IMAGEKIT_PUBLIC_KEY"),
  IMAGEKIT_PRIVATE_KEY: requireEnv("IMAGEKIT_PRIVATE_KEY"),

  // Tokens
  EMAIL_VERIFY_TOKEN_EXPIRES_HOURS: parseInt(
    optionalEnv("EMAIL_VERIFY_TOKEN_EXPIRES_HOURS", "24"),
    10
  ),
  BCRYPT_ROUNDS: parseInt(optionalEnv("BCRYPT_ROUNDS", "12"), 10),

  // ── App Attestation (Zero-Trust: verify the app binary, not just the user) ──
  // Master switch. When true, the attestationGuard requires a valid device
  // attestation token on requests from mobile clients. Left OFF by default so
  // web + dev keep working until the mobile builds ship attestation (needs a
  // native dev build — see docs). Web bot-defense is reCAPTCHA (blueprint pt 4).
  ATTESTATION_ENFORCED: optionalEnv("ATTESTATION_ENFORCED", "false") === "true",

  // Secret used to sign the short-lived attestation challenge + attestation
  // token (kept separate from the auth JWT secret; falls back to it if unset).
  ATTESTATION_SECRET: optionalEnv("ATTESTATION_SECRET", process.env.JWT_ACCESS_SECRET ?? "change-me"),
  ATTESTATION_TOKEN_TTL: optionalEnv("ATTESTATION_TOKEN_TTL", "1h"),
  ATTESTATION_CHALLENGE_TTL: optionalEnv("ATTESTATION_CHALLENGE_TTL", "5m"),

  // Android — Play Integrity API. GCP_PROJECT_NUMBER + ANDROID_PACKAGE_NAME are
  // required to decode/verify tokens; credentials come from Application Default
  // Credentials (GOOGLE_APPLICATION_CREDENTIALS or the Cloud Run service account).
  ANDROID_PACKAGE_NAME: optionalEnv("ANDROID_PACKAGE_NAME", ""),
  GCP_PROJECT_NUMBER: optionalEnv("GCP_PROJECT_NUMBER", ""),

  // iOS — App Attest. TeamID.BundleID forms the App ID hashed into attestations.
  APPLE_TEAM_ID: optionalEnv("APPLE_TEAM_ID", ""),
  APPLE_BUNDLE_ID: optionalEnv("APPLE_BUNDLE_ID", ""),
  // "development" (Xcode/dev) uses the "appattestdevelop" AAGUID; "production"
  // (TestFlight/App Store) uses "appattest".
  APP_ATTEST_ENV: optionalEnv("APP_ATTEST_ENV", "development"),
  // Path to Apple's App Attest root CA (download from
  // https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem).
  // Not bundled — the operator supplies it so the trust anchor is verifiable.
  APPLE_APP_ATTEST_ROOT_CA_PATH: optionalEnv(
    "APPLE_APP_ATTEST_ROOT_CA_PATH",
    "certs/Apple_App_Attestation_Root_CA.pem"
  ),
} as const;
