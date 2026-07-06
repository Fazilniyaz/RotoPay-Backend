// src/helpers/attestation/playIntegrity.ts
// ─────────────────────────────────────────────
// Android — Google Play Integrity verification.
//
// The app requests an integrity token from Play Integrity (with our challenge as
// the requestHash), sends it here, and we decode it SERVER-SIDE via the Play
// Integrity API, then check the verdicts:
//   • the token is for OUR package,
//   • its requestHash equals the challenge we issued (anti-replay),
//   • the app binary is Play-recognised (unmodified, from Play),
//   • the device meets basic integrity (not an emulator/rooted farm).
// Credentials come from Application Default Credentials (the Cloud Run service
// account, or GOOGLE_APPLICATION_CREDENTIALS locally) with the playintegrity scope.
// ─────────────────────────────────────────────

import { GoogleAuth } from "google-auth-library";
import { env } from "../../utilities/env";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/playintegrity"],
});

interface TokenPayloadExternal {
  requestDetails?: {
    requestPackageName?: string;
    requestHash?: string;
    timestampMillis?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string; // PLAY_RECOGNIZED | UNRECOGNIZED_VERSION | UNEVALUATED
    packageName?: string;
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[]; // e.g. ["MEETS_DEVICE_INTEGRITY"]
  };
  accountDetails?: {
    appLicensingVerdict?: string; // LICENSED | UNLICENSED | UNEVALUATED
  };
}

export interface PlayIntegrityResult {
  ok: boolean;
  reason?: string;
  verdict?: TokenPayloadExternal;
}

// Verify an Android integrity token against the expected challenge.
export async function verifyPlayIntegrity(
  integrityToken: string,
  expectedChallenge: string
): Promise<PlayIntegrityResult> {
  const packageName = env.ANDROID_PACKAGE_NAME;
  if (!packageName) {
    return { ok: false, reason: "ANDROID_PACKAGE_NAME is not configured" };
  }

  let payload: TokenPayloadExternal;
  try {
    const client = await auth.getClient();
    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(
      packageName
    )}:decodeIntegrityToken`;
    const res = await client.request<{ tokenPayloadExternal?: TokenPayloadExternal }>({
      url,
      method: "POST",
      data: { integrity_token: integrityToken },
    });
    payload = res.data.tokenPayloadExternal ?? {};
  } catch (err: any) {
    return { ok: false, reason: `Play Integrity decode failed: ${err?.message ?? "unknown"}` };
  }

  // 1) The token must be for our package.
  const tokenPackage = payload.requestDetails?.requestPackageName ?? payload.appIntegrity?.packageName;
  if (tokenPackage !== packageName) {
    return { ok: false, reason: "Package name mismatch", verdict: payload };
  }

  // 2) Anti-replay: the requestHash must equal the challenge we issued.
  if (payload.requestDetails?.requestHash !== expectedChallenge) {
    return { ok: false, reason: "requestHash does not match the issued challenge", verdict: payload };
  }

  // 3) The app binary must be recognised by Play (unmodified, official).
  if (payload.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    return { ok: false, reason: "App not Play-recognised", verdict: payload };
  }

  // 4) The device must meet basic integrity.
  const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY")) {
    return { ok: false, reason: "Device does not meet integrity", verdict: payload };
  }

  return { ok: true, verdict: payload };
}
