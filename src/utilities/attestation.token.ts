// src/utilities/attestation.token.ts
// ─────────────────────────────────────────────
// Attestation handshake tokens.
//
// Verifying a Play Integrity / App Attest token with Google/Apple on EVERY API
// call is slow and rate-limited. Instead we do it once in a handshake and mint a
// short-lived signed "attestation token" the client sends on subsequent requests
// (X-Attestation-Token). The attestationGuard verifies that cheap JWT.
//
// The "challenge" is itself a short-lived signed JWT wrapping a random nonce, so
// the server can confirm a returned challenge is one it recently issued (freshness
// + authenticity) without storing state.
// ─────────────────────────────────────────────

import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "./env";

const ISSUER = "rotapay-attestation";

// ── Challenge ──────────────────────────────────
// Returns an opaque challenge string the client feeds into Play Integrity
// (requestHash) or App Attest (clientDataHash = SHA256(challenge)).

export function issueChallenge(): string {
  const nonce = crypto.randomBytes(32).toString("base64url");
  return jwt.sign({ nonce, kind: "att-challenge" }, env.ATTESTATION_SECRET, {
    issuer: ISSUER,
    expiresIn: env.ATTESTATION_CHALLENGE_TTL,
  } as SignOptions);
}

// Throws if the challenge wasn't issued by us or has expired.
export function verifyChallenge(challenge: string): void {
  const decoded = jwt.verify(challenge, env.ATTESTATION_SECRET, { issuer: ISSUER }) as {
    kind?: string;
  };
  if (decoded.kind !== "att-challenge") {
    throw new Error("Not an attestation challenge");
  }
}

// ── Attestation token (issued after a successful handshake) ──

export interface AttestationClaims {
  platform: "android" | "ios";
  // Device/key identifier (App Attest keyId, or a hash for Android).
  deviceId: string;
}

export function signAttestationToken(claims: AttestationClaims): string {
  return jwt.sign({ ...claims, kind: "attestation" }, env.ATTESTATION_SECRET, {
    issuer: ISSUER,
    expiresIn: env.ATTESTATION_TOKEN_TTL,
  } as SignOptions);
}

export function verifyAttestationToken(token: string): AttestationClaims {
  const decoded = jwt.verify(token, env.ATTESTATION_SECRET, { issuer: ISSUER }) as {
    kind?: string;
    platform: "android" | "ios";
    deviceId: string;
  };
  if (decoded.kind !== "attestation") {
    throw new Error("Not an attestation token");
  }
  return { platform: decoded.platform, deviceId: decoded.deviceId };
}
