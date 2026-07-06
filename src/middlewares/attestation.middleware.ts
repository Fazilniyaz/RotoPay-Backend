// src/middlewares/attestation.middleware.ts
// ─────────────────────────────────────────────
// Attestation guard.
//
// When ATTESTATION_ENFORCED is on, requests from MOBILE binaries (X-Client
// "mobile"/"mobile-local") must carry a valid X-Attestation-Token proving the
// caller completed the attestation handshake. Web / unknown clients bypass here
// — they're defended by reCAPTCHA (blueprint point 4). The attestation handshake
// endpoints, health check and CORS preflight are always allowed through.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import { env } from "../utilities/env";
import { verifyAttestationToken } from "../utilities/attestation.token";
import { sendError } from "../helpers/api.response";

export function attestationGuard(req: Request, res: Response, next: NextFunction): void {
  if (!env.ATTESTATION_ENFORCED) return next();
  if (req.method === "OPTIONS") return next();

  // Only mobile binaries are attested; web/server callers pass through.
  const xClient = (req.get("x-client") || "").toLowerCase();
  if (!xClient.startsWith("mobile")) return next();

  // Never gate the handshake itself (you can't be attested before attesting).
  if (req.originalUrl.startsWith("/api/attestation")) return next();

  const token = req.get("x-attestation-token");
  if (!token) {
    sendError(res, "App attestation required", 401);
    return;
  }
  try {
    verifyAttestationToken(token);
    next();
  } catch {
    sendError(res, "Invalid or expired app attestation", 401);
  }
}
