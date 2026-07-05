// src/services/scheduler.service.ts
// ─────────────────────────────────────────────
// Background scheduler — one tick per minute (functionally cron `* * * * *`).
//
// Responsibilities (driven by calendar ASSIGNMENTS — a shift preset put on a day):
//   • Auto clock-in   — when an assignment's start time arrives and the user's
//                       clockInType is "automatic": open a clock session and
//                       notify "shift started, clocked in!".
//   • Auto clock-out  — when the assignment's end time passes: close that session,
//                       compute hours + earnings, notify "shift ended…".
//   • Water reminder  — at the half-way point: notify once per assignment.
//
// Idempotent: auto sessions are keyed by shiftId (deduped), and the water
// reminder checks for an existing notification (keyed by the assignment id).
// ─────────────────────────────────────────────

import { prisma } from "../utilities/prisma.client";
import { emitNotification, NotificationType } from "../helpers/notification.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

// Absolute [startMs, endMs] for an assignment: the preset's time-of-day combined
// with the assignment's day (overnight-aware: end<=start ⇒ end is next day).
function occInterval(day: Date, startTime: Date, endTime: Date): [number, number] {
  const d = new Date(day);
  const s = new Date(startTime);
  const e = new Date(endTime);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes(), 0, 0).getTime();
  let end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), e.getHours(), e.getMinutes(), 0, 0).getTime();
  if (end <= start) end += DAY_MS;
  return [start, end];
}

async function tick(): Promise<void> {
  const now = Date.now();
  const nowDate = new Date(now);

  // Candidate assignments: anything dated yesterday..today (covers overnight).
  const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  const dayEnd = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1);

  const assignments = await prisma.calendarEntry.findMany({
    where: { type: "shift", shiftId: { not: null }, date: { gte: dayStart, lt: dayEnd } },
    select: {
      id: true,
      userId: true,
      date: true,
      shiftId: true,
      shift: {
        select: {
          startTime: true,
          endTime: true,
          salaries: { select: { id: true, employerId: true, hourlyPayRate: true } },
        },
      },
      user: { select: { settings: { select: { clockInType: true, clockInOutEnabled: true } } } },
    },
  });
  if (assignments.length === 0) return;

  const shiftIds = Array.from(new Set(assignments.map((a) => a.shiftId).filter(Boolean))) as string[];
  const entryIds = assignments.map((a) => a.id);

  // Active auto sessions + already-sent water reminders, fetched in bulk.
  const [activeSessions, waterNotes] = await Promise.all([
    prisma.clockSession.findMany({
      where: { status: "active", shiftId: { in: shiftIds } },
      select: { id: true, shiftId: true, clockInTime: true, salary: { select: { hourlyPayRate: true } } },
    }),
    prisma.notification.findMany({
      where: { type: NotificationType.SHIFT_WATER, relatedId: { in: entryIds } },
      select: { relatedId: true },
    }),
  ]);

  type ActiveLite = { id: string; shiftId: string | null; clockInTime: Date; salary: { hourlyPayRate: number | null } | null };
  const activeByShift = new Map<string, ActiveLite>(
    activeSessions.map((s) => [s.shiftId ?? "", s as ActiveLite])
  );
  const watered = new Set(waterNotes.map((n) => n.relatedId));

  for (const a of assignments) {
    if (!a.shift || !a.shiftId) continue;
    const [startMs, endMs] = occInterval(a.date, a.shift.startTime, a.shift.endTime);
    const settings = a.user.settings;
    const autoEnabled =
      (settings?.clockInOutEnabled ?? true) && (settings?.clockInType ?? "automatic") === "automatic";
    const isLive = now >= startMs && now <= endMs;
    const active = activeByShift.get(a.shiftId);

    // ── Auto clock-in ──
    if (autoEnabled && isLive && !active) {
      const wage = a.shift.salaries[0];
      const session = await prisma.clockSession.create({
        data: {
          userId: a.userId,
          shiftId: a.shiftId,
          salaryId: wage?.id ?? null,
          employerId: wage?.employerId ?? null,
          clockInTime: nowDate,
          status: "active",
          isAutoCalculated: true,
        },
      });
      // Track it so we don't clock the same preset in twice this tick.
      activeByShift.set(a.shiftId, {
        id: session.id,
        shiftId: a.shiftId,
        clockInTime: nowDate,
        salary: wage ? { hourlyPayRate: wage.hourlyPayRate } : null,
      });
      await emitNotification({
        userId: a.userId,
        type: NotificationType.CLOCK_IN,
        title: "Shift started",
        message: "Shift started, clocked in!",
        relatedId: session.id,
        relatedType: "clock",
      });
    }

    // ── Half-way water reminder (once per assignment) ──
    if (isLive && now >= startMs + (endMs - startMs) / 2 && !watered.has(a.id)) {
      watered.add(a.id);
      await emitNotification({
        userId: a.userId,
        type: NotificationType.SHIFT_WATER,
        title: "Halfway there",
        message: "Take some water and continue the remaining shifts buddy!",
        relatedId: a.id,
        relatedType: "shift",
      });
    }
  }

  // ── Auto clock-out: any active auto session whose assignment has ended ──
  const clockedOut = new Set<string>();
  for (const a of assignments) {
    if (!a.shift || !a.shiftId) continue;
    const session = activeByShift.get(a.shiftId);
    if (!session || clockedOut.has(session.id)) continue;
    // Skip sessions opened this very tick (their occurrence hasn't ended).
    const [, endMs] = occInterval(a.date, a.shift.startTime, a.shift.endTime);
    if (now <= endMs) continue;

    const totalHours = Math.max(0, Math.round(((now - session.clockInTime.getTime()) / 3_600_000) * 100) / 100);
    const rate = session.salary?.hourlyPayRate ?? 0;
    const earnings = Math.round(totalHours * rate * 100) / 100;

    await prisma.clockSession.update({
      where: { id: session.id },
      data: { clockOutTime: nowDate, totalHours, earnings, status: "completed" },
    });
    clockedOut.add(session.id);
    await emitNotification({
      userId: a.userId,
      type: NotificationType.CLOCK_OUT,
      title: "Shift ended",
      message: "Shift ended, clocked out!",
      relatedId: session.id,
      relatedType: "clock",
    });
  }
}

let timer: NodeJS.Timeout | null = null;

// Start the per-minute scheduler. Safe to call once at server boot.
export function startScheduler(): void {
  if (timer) return;
  const run = () =>
    tick().catch((err) => console.error("[Scheduler] tick failed:", err));
  // Give the DB connection a moment to warm up before the first tick, then run
  // every minute.
  setTimeout(run, 5_000);
  timer = setInterval(run, TICK_MS);
  console.log(" [Scheduler] Clock automation running (every 60s)");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
