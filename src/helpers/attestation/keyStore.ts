// src/helpers/attestation/keyStore.ts
// ─────────────────────────────────────────────
// Storage for iOS App Attest keys.
//
// The generated Prisma client only knows about the AppAttestKey model AFTER
// `prisma generate` runs (blocked here by a Windows file lock on the query
// engine). Until then we access the model through this small typed view so the
// rest of the code stays fully type-safe and compiles cleanly.
// ─────────────────────────────────────────────

import { prisma } from "../../utilities/prisma.client";

export interface AppAttestKeyRow {
  id: string;
  keyId: string;
  publicKey: string;
  signCount: number;
  bundleId: string | null;
  userId: string | null;
}

export const appAttestKeyStore = (
  prisma as unknown as {
    appAttestKey: {
      findUnique(a: { where: { keyId: string } }): Promise<AppAttestKeyRow | null>;
      upsert(a: {
        where: { keyId: string };
        create: {
          keyId: string;
          publicKey: string;
          signCount: number;
          bundleId?: string | null;
          userId?: string | null;
        };
        update: {
          publicKey: string;
          signCount: number;
          bundleId?: string | null;
          userId?: string | null;
        };
      }): Promise<AppAttestKeyRow>;
      update(a: {
        where: { keyId: string };
        data: { signCount: number };
      }): Promise<AppAttestKeyRow>;
    };
  }
).appAttestKey;
