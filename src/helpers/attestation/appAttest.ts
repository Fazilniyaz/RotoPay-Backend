// src/helpers/attestation/appAttest.ts
// ─────────────────────────────────────────────
// iOS — Apple App Attest verification (attestation + assertion).
//
// Implements Apple's spec ("Validating Apps That Connect to Your Server"):
//   ATTESTATION (once, on key registration):
//     1. Decode the CBOR attestation object → { fmt, attStmt:{x5c, receipt}, authData }.
//     2. Verify the x5c chain: credCert ← Apple CA ← Apple App Attest Root CA.
//     3. nonce = SHA256(authData ‖ SHA256(challenge)); compare to the nonce in the
//        credCert extension OID 1.2.840.113635.100.8.2.
//     4. authData checks: rpIdHash == SHA256("<team>.<bundle>"), signCount == 0,
//        AAGUID matches the environment, credentialId == keyId.
//     5. Store the credCert's public key — future assertions are verified with it.
//   ASSERTION (each subsequent handshake):
//     signature over SHA256(authenticatorData ‖ SHA256(challenge)) using the stored
//     key; rpIdHash matches; counter strictly increases.
//
// Uses `cbor` + Node's built-in crypto (X509Certificate, ECDSA verify). No secrets
// are hardcoded; Apple's root CA is loaded from APPLE_APP_ATTEST_ROOT_CA_PATH.
// ─────────────────────────────────────────────

import crypto, { X509Certificate, KeyObject } from "crypto";
import fs from "fs";
import path from "path";
import cbor from "cbor";
import { env } from "../../utilities/env";

// OID 1.2.840.113635.100.8.2 (Apple App Attest nonce) DER-encoded.
const NONCE_OID_DER = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

let cachedRoot: X509Certificate | null = null;
function appleRootCert(): X509Certificate {
  if (cachedRoot) return cachedRoot;
  const p = path.isAbsolute(env.APPLE_APP_ATTEST_ROOT_CA_PATH)
    ? env.APPLE_APP_ATTEST_ROOT_CA_PATH
    : path.join(process.cwd(), env.APPLE_APP_ATTEST_ROOT_CA_PATH);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Apple App Attest root CA not found at ${p}. Download Apple_App_Attestation_Root_CA.pem from Apple and set APPLE_APP_ATTEST_ROOT_CA_PATH.`
    );
  }
  cachedRoot = new X509Certificate(fs.readFileSync(p));
  return cachedRoot;
}

const sha256 = (b: crypto.BinaryLike) => crypto.createHash("sha256").update(b).digest();

// App ID hashed into every attestation/assertion: "<TeamID>.<BundleID>".
function appIdHash(): Buffer {
  if (!env.APPLE_TEAM_ID || !env.APPLE_BUNDLE_ID) {
    throw new Error("APPLE_TEAM_ID and APPLE_BUNDLE_ID must be configured for App Attest");
  }
  return sha256(`${env.APPLE_TEAM_ID}.${env.APPLE_BUNDLE_ID}`);
}

// Expected 16-byte AAGUID for the configured environment.
function expectedAaguid(): Buffer {
  const label = env.APP_ATTEST_ENV === "production" ? "appattest" : "appattestdevelop";
  const buf = Buffer.alloc(16);
  Buffer.from(label, "ascii").copy(buf); // rest stays zero-padded
  return buf;
}

// Pull the 32-byte nonce out of the credCert's Apple extension. The extension
// wraps a DER SEQUENCE ending in `OCTET STRING (0x04 0x20) <32 bytes>`.
function extractCertNonce(cert: X509Certificate): Buffer {
  const der = cert.raw;
  const oidAt = der.indexOf(NONCE_OID_DER);
  if (oidAt < 0) throw new Error("credCert is missing the App Attest nonce extension");
  // Find the first 32-byte OCTET STRING after the OID.
  for (let i = oidAt + NONCE_OID_DER.length; i < der.length - 1; i++) {
    if (der[i] === 0x04 && der[i + 1] === 0x20 && i + 2 + 32 <= der.length) {
      return der.subarray(i + 2, i + 2 + 32);
    }
  }
  throw new Error("Could not read nonce from credCert extension");
}

// Parse the WebAuthn-style authenticator data structure.
function parseAuthData(authData: Buffer) {
  if (authData.length < 37) throw new Error("authData too short");
  return {
    rpIdHash: authData.subarray(0, 32),
    signCount: authData.readUInt32BE(33),
    aaguid: authData.length >= 53 ? authData.subarray(37, 53) : Buffer.alloc(0),
    credentialId:
      authData.length >= 55
        ? authData.subarray(55, 55 + authData.readUInt16BE(53))
        : Buffer.alloc(0),
  };
}

export interface AttestationResult {
  publicKeyPem: string;
  signCount: number;
}

// Verify an App Attest ATTESTATION object; returns the key to store.
export async function verifyAttestation(params: {
  keyId: string; // base64 (standard)
  attestation: string; // base64 CBOR attestation object
  challenge: string; // the exact challenge string we issued
}): Promise<AttestationResult> {
  const root = appleRootCert();

  const attObj = await cbor.decodeFirst(Buffer.from(params.attestation, "base64"));
  if (!attObj || attObj.fmt !== "apple-appattest") {
    throw new Error("Unexpected attestation format");
  }
  const x5c: Buffer[] = attObj.attStmt?.x5c ?? [];
  const authData: Buffer = attObj.authData;
  if (x5c.length < 2 || !authData) throw new Error("Malformed attestation statement");

  // 1) Certificate chain: credCert ← intermediate ← Apple root.
  const credCert = new X509Certificate(x5c[0]);
  const caCert = new X509Certificate(x5c[1]);
  const now = new Date();
  for (const c of [credCert, caCert, root]) {
    if (new Date(c.validFrom) > now || new Date(c.validTo) < now) {
      throw new Error("A certificate in the chain is not currently valid");
    }
  }
  if (!caCert.verify(root.publicKey)) throw new Error("Intermediate not signed by Apple root");
  if (!credCert.verify(caCert.publicKey)) throw new Error("credCert not signed by intermediate");

  // 2) Nonce binding: SHA256(authData ‖ SHA256(challenge)) must equal the cert nonce.
  const clientDataHash = sha256(Buffer.from(params.challenge));
  const expectedNonce = sha256(Buffer.concat([authData, clientDataHash]));
  if (!crypto.timingSafeEqual(expectedNonce, extractCertNonce(credCert))) {
    throw new Error("Attestation nonce mismatch (possible replay/forgery)");
  }

  // 3) authData checks.
  const ad = parseAuthData(authData);
  if (!crypto.timingSafeEqual(ad.rpIdHash, appIdHash())) {
    throw new Error("App ID (rpIdHash) mismatch");
  }
  if (ad.signCount !== 0) throw new Error("Attestation signCount must be 0");
  if (!ad.aaguid.equals(expectedAaguid())) {
    throw new Error(`AAGUID mismatch — expected ${env.APP_ATTEST_ENV} environment`);
  }
  const keyIdBuf = Buffer.from(params.keyId, "base64");
  if (!ad.credentialId.equals(keyIdBuf)) throw new Error("credentialId does not match keyId");

  // 4) The credCert's subject public key is the attested device key.
  const publicKeyPem = (credCert.publicKey as KeyObject)
    .export({ type: "spki", format: "pem" })
    .toString();

  return { publicKeyPem, signCount: 0 };
}

// Verify an App Attest ASSERTION; returns the new (increased) counter to persist.
export async function verifyAssertion(params: {
  assertion: string; // base64 CBOR assertion
  challenge: string;
  publicKeyPem: string; // the stored attested key
  storedSignCount: number;
}): Promise<{ newSignCount: number }> {
  const assertObj = await cbor.decodeFirst(Buffer.from(params.assertion, "base64"));
  const signature: Buffer = assertObj?.signature;
  const authenticatorData: Buffer = assertObj?.authenticatorData;
  if (!signature || !authenticatorData) throw new Error("Malformed assertion");

  // Signature is over SHA256(authenticatorData ‖ SHA256(challenge)). crypto.verify
  // hashes the message for us, so pass the concatenation (not the pre-hash).
  const clientDataHash = sha256(Buffer.from(params.challenge));
  const signedMessage = Buffer.concat([authenticatorData, clientDataHash]);
  const publicKey = crypto.createPublicKey(params.publicKeyPem);
  if (!crypto.verify("sha256", signedMessage, publicKey, signature)) {
    throw new Error("Assertion signature invalid");
  }

  const ad = parseAuthData(authenticatorData);
  if (!crypto.timingSafeEqual(ad.rpIdHash, appIdHash())) {
    throw new Error("App ID (rpIdHash) mismatch");
  }
  if (ad.signCount <= params.storedSignCount) {
    throw new Error("Assertion counter did not increase (possible cloned key)");
  }

  return { newSignCount: ad.signCount };
}
