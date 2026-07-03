// src/utilities/client-url.ts
// ─────────────────────────────────────────────
// Per-request client URL resolver
//
// A single deployed backend serves several clients:
//   • Web app  — http://localhost:3000  (local)  /  Vercel  (prod)
//   • Native   — http://localhost:8081  (Expo)   /  rotopay://  (Play Store)
//
// Outbound email links (verify-email, reset-password, welcome) must point back
// at the client the request actually came from. This resolves that base URL
// per request from a signal the client sends, mapping it to an ALLOWLISTED
// server-side URL — we never embed a raw client-supplied URL in an email.
//
// Resolution order:
//   1. `X-Client` header  — sent explicitly by the native app
//                           ("mobile" | "mobile-local"). Selected by KEY.
//   2. `Origin` header    — sent automatically by browsers. The web app needs
//                           NO changes and keeps working locally + on Vercel.
//                           Selected by VALUE.
//   3. env.CLIENT_URL     — safe default (legacy behaviour) when neither is
//                           present or recognised.
// ─────────────────────────────────────────────

import { Request } from "express";
import { env } from "./env";

// Normalise every base URL to end with exactly one "/" so links can be built
// by simple concatenation (`${base}auth/verify-email`) for both http(s) URLs
// and custom schemes like `rotopay://`.
const withTrailingSlash = (url: string): string =>
  url.endsWith("/") ? url : `${url}/`;

// identifier (X-Client value) → allowlisted base URL
const CLIENTS: Record<string, string> = {
  "web-local": withTrailingSlash(env.CLIENT_URL_WEB_LOCAL),
  "web-prod": withTrailingSlash(env.CLIENT_URL_WEB_PROD),
  "mobile-local": withTrailingSlash(env.CLIENT_URL_MOBILE_LOCAL),
  mobile: withTrailingSlash(env.CLIENT_URL_MOBILE),
};

// Reverse index for Origin matching. Browsers send Origin without a trailing
// slash (e.g. "http://localhost:3000"), so key the map on the slash-stripped
// form. Custom-scheme clients never arrive via Origin, so they're harmless here.
const ORIGIN_TO_BASE = new Map<string, string>();
for (const base of Object.values(CLIENTS)) {
  ORIGIN_TO_BASE.set(base.replace(/\/+$/, ""), base);
}

const DEFAULT_BASE = withTrailingSlash(env.CLIENT_URL);

/**
 * Resolve the base client URL for the current request. Always returns a base
 * ending in "/", so callers build links as `${base}path`.
 */
export function resolveClientBaseUrl(req: Request): string {
  // 1. Explicit declaration from the native app.
  const xClient = req.get("x-client")?.trim().toLowerCase();
  if (xClient && CLIENTS[xClient]) {
    return CLIENTS[xClient];
  }

  // 2. Browser Origin (web app — no client-side change required).
  const origin = req.get("origin")?.trim();
  if (origin && ORIGIN_TO_BASE.has(origin)) {
    return ORIGIN_TO_BASE.get(origin)!;
  }

  // 3. Safe fallback — preserves pre-existing behaviour.
  return DEFAULT_BASE;
}
