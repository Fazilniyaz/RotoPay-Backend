// src/middlewares/recaptcha.middleware.ts
// ─────────────────────────────────────────────
// reCAPTCHA guard for sensitive web endpoints. Enforced only for WEB clients —
// mobile binaries are defended by App Attestation (point 2), not reCAPTCHA. The
// token is read from the X-Recaptcha-Token header (or a recaptchaToken body
// field). No-op until RECAPTCHA_ENFORCED=true.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import { env } from "../utilities/env";
import { verifyRecaptcha } from "../helpers/recaptcha";
import { sendError } from "../helpers/api.response";

export function recaptchaGuard(action?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!env.RECAPTCHA_ENFORCED) return next();

    // Mobile clients authenticate genuineness via attestation, not reCAPTCHA.
    const xClient = (req.get("x-client") || "").toLowerCase();
    if (xClient.startsWith("mobile")) return next();

    const token =
      req.get("x-recaptcha-token") ||
      (req.body as { recaptchaToken?: string } | undefined)?.recaptchaToken;
    if (!token) {
      sendError(res, "reCAPTCHA token required", 400);
      return;
    }

    const result = await verifyRecaptcha(token, action);
    if (!result.ok) {
      sendError(res, "reCAPTCHA verification failed — please try again", 403);
      return;
    }
    next();
  };
}
