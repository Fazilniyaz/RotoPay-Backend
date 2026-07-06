// src/helpers/recaptcha.ts
// ─────────────────────────────────────────────
// Google reCAPTCHA v3 verification (blueprint point 4 — frictionless web bot
// mitigation). The web app runs reCAPTCHA v3 on its auth forms, gets a token,
// and sends it here; we verify it with Google and check the score + action.
// ─────────────────────────────────────────────

import { env } from "../utilities/env";

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

export interface RecaptchaResult {
  ok: boolean;
  score?: number;
  action?: string;
  reason?: string;
}

// Verify a reCAPTCHA v3 token. Optionally assert the expected action name.
export async function verifyRecaptcha(
  token: string,
  expectedAction?: string
): Promise<RecaptchaResult> {
  if (!env.RECAPTCHA_SECRET_KEY) {
    return { ok: false, reason: "RECAPTCHA_SECRET_KEY not configured" };
  }

  try {
    const params = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token });
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as SiteVerifyResponse;

    if (!data.success) {
      return { ok: false, reason: `verify failed: ${(data["error-codes"] ?? []).join(",")}` };
    }
    const score = data.score ?? 0;
    if (score < env.RECAPTCHA_MIN_SCORE) {
      return { ok: false, score, reason: `score ${score} below ${env.RECAPTCHA_MIN_SCORE}` };
    }
    if (expectedAction && data.action && data.action !== expectedAction) {
      return { ok: false, score, action: data.action, reason: "action mismatch" };
    }
    return { ok: true, score, action: data.action };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "reCAPTCHA verify error" };
  }
}
