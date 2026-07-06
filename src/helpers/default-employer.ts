// src/helpers/default-employer.ts
// ─────────────────────────────────────────────
// Default-employee resolution.
//
// The "default employee" scopes the per-employee modules (calendar, earnings,
// reports). It lives on User.defaultEmployerId. This helper keeps it honest:
//   • self-heals a stale pointer (employer since deleted) → oldest employer,
//   • lazily adopts the oldest employer for legacy users who predate the field,
//   • returns null only when the user genuinely has no employers (→ onboarding).
// ─────────────────────────────────────────────

import { prisma } from "../utilities/prisma.client";

// Resolve the effective default employer id for a user, healing/adopting as
// needed and persisting any correction so subsequent reads are cheap.
export async function resolveDefaultEmployerId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultEmployerId: true },
  });

  const current = user?.defaultEmployerId ?? null;
  if (current) {
    // Confirm the pointer still references one of the user's employers.
    const stillValid = await prisma.employer.count({ where: { id: current, userId } });
    if (stillValid > 0) return current;
  }

  // No (valid) default → adopt the oldest employer, if any.
  const oldest = await prisma.employer.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const next = oldest?.id ?? null;

  if (next !== current) {
    await prisma.user.update({ where: { id: userId }, data: { defaultEmployerId: next } });
  }
  return next;
}

// Pick the employer scope for a request: an explicit ?employerId= (validated to
// belong to the user) wins; otherwise fall back to the user's default employer.
export async function scopeEmployerId(
  userId: string,
  requested?: unknown
): Promise<string | null> {
  if (typeof requested === "string" && requested.trim()) {
    const id = requested.trim();
    const owns = await prisma.employer.count({ where: { id, userId } });
    if (owns > 0) return id;
  }
  return resolveDefaultEmployerId(userId);
}
