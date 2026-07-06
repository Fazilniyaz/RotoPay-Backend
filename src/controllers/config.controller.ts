// src/controllers/config.controller.ts
// ─────────────────────────────────────────────
// Runtime configuration (blueprint point 3 — "fetch configurations dynamically
// at runtime post-authentication").
//
// The apps hardcode NO secrets. Non-secret, runtime-tunable settings are served
// here (authenticated) so they can change without shipping a new binary, and so
// any future sensitive config is delivered per-request to a verified client
// instead of baked into the APK/IPA. SECRETS ARE NEVER RETURNED — only flags the
// client legitimately needs.
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess } from "../helpers/api.response";
import { env } from "../utilities/env";

export const getRuntimeConfig = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, "Config fetched successfully", {
    // Whether the backend enforces device attestation — lets the client decide
    // to run the Play Integrity / App Attest handshake proactively.
    attestation: { enforced: env.ATTESTATION_ENFORCED },
    // Runtime feature flags / tunables go here (non-secret only).
    features: {},
  });
});
