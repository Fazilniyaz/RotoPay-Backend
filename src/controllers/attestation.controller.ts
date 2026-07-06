// src/controllers/attestation.controller.ts
// ─────────────────────────────────────────────
// App Attestation handshake — proves the caller is our genuine, unmodified app
// binary (not a script/bot), before it's trusted to hit the API.
//
// POST /api/attestation/challenge  → issue a one-time challenge
// POST /api/attestation/attest     → iOS: register an App Attest key (attestation)
// POST /api/attestation/verify     → Android integrity token OR iOS assertion
//                                    → returns a short-lived attestation token
//
// The returned attestation token is sent on later requests as X-Attestation-Token
// and checked by attestationGuard, so we don't re-hit Google/Apple every call.
// These endpoints are device-level (no login required) and rate-limited.
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess, sendError } from "../helpers/api.response";
import {
  issueChallenge,
  verifyChallenge,
  signAttestationToken,
} from "../utilities/attestation.token";
import { verifyPlayIntegrity } from "../helpers/attestation/playIntegrity";
import { verifyAttestation, verifyAssertion } from "../helpers/attestation/appAttest";
import { appAttestKeyStore } from "../helpers/attestation/keyStore";
import { env } from "../utilities/env";

// ── POST /challenge ──
export const getChallenge = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, "Challenge issued", { challenge: issueChallenge() });
});

// ── POST /attest (iOS App Attest key registration) ──
export const attest = asyncHandler(async (req: Request, res: Response) => {
  const { keyId, attestation, challenge } = req.body as {
    keyId?: string;
    attestation?: string;
    challenge?: string;
  };
  if (!keyId || !attestation || !challenge) {
    return sendError(res, "keyId, attestation and challenge are required", 400);
  }

  try {
    verifyChallenge(challenge);
    const { publicKeyPem, signCount } = await verifyAttestation({ keyId, attestation, challenge });

    await appAttestKeyStore.upsert({
      where: { keyId },
      create: {
        keyId,
        publicKey: publicKeyPem,
        signCount,
        bundleId: env.APPLE_BUNDLE_ID || null,
        userId: req.user?.userId ?? null,
      },
      update: { publicKey: publicKeyPem, signCount },
    });

    const attestationToken = signAttestationToken({ platform: "ios", deviceId: keyId });
    sendSuccess(res, "Attestation verified", { attestationToken });
  } catch (err: any) {
    sendError(res, err?.message || "Attestation verification failed", 401);
  }
});

// ── POST /verify (Android integrity token OR iOS assertion) ──
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const { platform, challenge } = req.body as { platform?: string; challenge?: string };
  if (!challenge) return sendError(res, "challenge is required", 400);

  try {
    verifyChallenge(challenge);
  } catch {
    return sendError(res, "Invalid or expired challenge", 401);
  }

  // ── Android: Play Integrity ──
  if (platform === "android") {
    const { token } = req.body as { token?: string };
    if (!token) return sendError(res, "token is required for android", 400);

    const result = await verifyPlayIntegrity(token, challenge);
    if (!result.ok) return sendError(res, `Play Integrity failed: ${result.reason}`, 401);

    const attestationToken = signAttestationToken({ platform: "android", deviceId: "android" });
    return sendSuccess(res, "Attestation verified", { attestationToken });
  }

  // ── iOS: App Attest assertion ──
  if (platform === "ios") {
    const { keyId, assertion } = req.body as { keyId?: string; assertion?: string };
    if (!keyId || !assertion) {
      return sendError(res, "keyId and assertion are required for ios", 400);
    }

    const stored = await appAttestKeyStore.findUnique({ where: { keyId } });
    if (!stored) return sendError(res, "Unknown key — attest first", 401);

    try {
      const { newSignCount } = await verifyAssertion({
        assertion,
        challenge,
        publicKeyPem: stored.publicKey,
        storedSignCount: stored.signCount,
      });
      await appAttestKeyStore.update({ where: { keyId }, data: { signCount: newSignCount } });
    } catch (err: any) {
      return sendError(res, err?.message || "Assertion verification failed", 401);
    }

    const attestationToken = signAttestationToken({ platform: "ios", deviceId: keyId });
    return sendSuccess(res, "Attestation verified", { attestationToken });
  }

  return sendError(res, "platform must be 'android' or 'ios'", 400);
});
