// src/utilities/google.oauth.ts
// ─────────────────────────────────────────────
// Google OAuth — ID Token Verifier
// Verifies the ID token sent from the frontend (Web & Mobile)
// ─────────────────────────────────────────────

import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// ── Verified Google User Payload ───────────────

export interface GoogleUserPayload {
  googleId: string;
  email: string;
  displayName: string | null;
  profilePicture: string | null;
  emailVerified: boolean;
}

// ── Verify Google ID Token ─────────────────────
// The frontend signs in with Google and sends the ID token here.
// We verify it server-side — never trust unverified tokens.

export async function verifyGoogleToken(
  idToken: string
): Promise<GoogleUserPayload> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Invalid Google ID token — no payload");
  }

  if (!payload.email) {
    throw new Error("Google account has no email address");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    displayName: payload.name ?? null,
    profilePicture: payload.picture ?? null,
    emailVerified: payload.email_verified ?? false,
  };
}
