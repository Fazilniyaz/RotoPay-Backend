// src/middlewares/mongo.rate.store.ts
// ─────────────────────────────────────────────
// A MongoDB-backed Store for express-rate-limit.
//
// WHY: on serverless (Vercel) the default MemoryStore is per-lambda-instance and
// resets on every cold start, so IP limits barely bite. We already run MongoDB,
// so we reuse it as a SHARED counter store — every instance sees the same tally,
// making the limits actually effective (fixes brute-force / DoS scoring) with
// ZERO new dependencies and no extra infra to provision.
//
// Implementation: one fixed-window counter document per key, `$inc`-ed atomically
// via findOneAndUpdate(upsert). A TTL index on `expiresAt` lets MongoDB auto-purge
// stale windows. If Mongo is unreachable at init the caller falls back to the
// in-memory store, so the API never breaks because of the limiter.
// ─────────────────────────────────────────────

import type { Store, Options, IncrementResponse } from "express-rate-limit";
import { prisma } from "../utilities/prisma.client";

const COLLECTION = "rate_limit_hits";

// Create the TTL index once (idempotent). Resolves false if Mongo is unreachable.
export async function initMongoRateStore(): Promise<boolean> {
  try {
    await prisma.$runCommandRaw({
      createIndexes: COLLECTION,
      indexes: [{ key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 }],
    });
    return true;
  } catch {
    return false;
  }
}

export class MongoRateStore implements Store {
  windowMs = 60_000;
  prefix: string;

  constructor(prefix = "rl:") {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string) {
    return `${this.prefix}${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now();
    const expiresAt = new Date(now + this.windowMs);
    const _id = this.id(key);

    try {
      // Atomic upsert: bump the counter, set the window end only on first insert.
      const res = (await prisma.$runCommandRaw({
        findAndModify: COLLECTION,
        query: { _id },
        update: {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: { $date: expiresAt.toISOString() } },
        },
        upsert: true,
        new: true,
      })) as { value?: { count?: number; expiresAt?: { $date?: string } | string } };

      const doc = res?.value ?? {};
      const totalHits = typeof doc.count === "number" ? doc.count : 1;
      const rawExpiry =
        typeof doc.expiresAt === "object" && doc.expiresAt?.$date ? doc.expiresAt.$date : (doc.expiresAt as string | undefined);
      const resetTime = rawExpiry ? new Date(rawExpiry) : expiresAt;

      return { totalHits, resetTime };
    } catch {
      // Fail OPEN: if Mongo is momentarily unavailable, never block legitimate
      // traffic on the limiter. Returning 0 hits lets the request through.
      return { totalHits: 0, resetTime: expiresAt };
    }
  }

  async decrement(key: string): Promise<void> {
    await prisma.$runCommandRaw({
      findAndModify: COLLECTION,
      query: { _id: this.id(key) },
      update: { $inc: { count: -1 } },
      new: true,
    }).catch(() => undefined);
  }

  async resetKey(key: string): Promise<void> {
    await prisma.$runCommandRaw({
      delete: COLLECTION,
      deletes: [{ q: { _id: this.id(key) }, limit: 1 }],
    }).catch(() => undefined);
  }
}
