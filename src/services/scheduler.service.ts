// src/services/scheduler.service.ts
// ─────────────────────────────────────────────
// Background scheduler — one tick per minute (functionally cron `* * * * *`).
//
// Responsibilities (only while a shift is "today"):
//   • Auto clock-in   — when a shift's start time arrives and the user's
//                       clockInType is "automatic": open a clock session and
//                       notify "shift started, clocked in!".
//   • Auto clock-out  — when the shift's end time passes: close that session,
//                       compute hours + earnings, notify "shift ended…".
//   • Water reminder  — at the half-way point: notify once.
//
// Everything is idempotent: auto sessions are keyed by shiftId (deduped), and the
// water reminder checks for an existing notification before sending.
// ─────────────────────────────────────────────

import { prisma } from "../utilities/prisma.client";
import { emitNotification, NotificationType } from "../helpers/notification.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

// Absolute [startMs, endMs] for a shift (overnight-aware).
function intervalMs(startTime: Date, endTime: Date): [number, number] {
  const start = new Date(startTime).getTime();
  let end = new Date(endTime).getTime();
  if (end <= start) end += DAY_MS;
  return [start, end];
}

async function tick(): Promise<void> {
  const now = Date.now();
  const nowDate = new Date(now);

  // Candidate shifts: anything dated yesterday..today (covers overnight shifts).
  const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  const dayEnd = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1);

  const shifts = await prisma.shift.findMany({
    where: { date: { gte: dayStart, lt: dayEnd } },
    select: {
      id: true,
      userId: true,
      startTime: true,
      endTime: true,
      salaries: { select: { id: true, employerId: true, hourlyPayRate: true } },
      user: { select: { settings: { select: { clockInType: true, clockInOutEnabled: true } } } },
    },
  });
  if (shifts.length === 0) return;

  const shiftIds = shifts.map((s) => s.id);

  // Active auto sessions + already-sent water reminders, fetched in bulk.
  const [activeSessions, waterNotes] = await Promise.all([
    prisma.clockSession.findMany({
      where: { status: "active", shiftId: { in: shiftIds } },
      select: { id: true, shiftId: true, clockInTime: true, salary: { select: { hourlyPayRate: true } } },
    }),
    prisma.notification.findMany({
      where: { type: NotificationType.SHIFT_WATER, relatedId: { in: shiftIds } },
      select: { relatedId: true },
    }),
  ]);

  const activeByShift = new Map(activeSessions.map((s) => [s.shiftId ?? "", s]));
  const wateredShifts = new Set(waterNotes.map((n) => n.relatedId));

  for (const shift of shifts) {
    const [startMs, endMs] = intervalMs(shift.startTime, shift.endTime);
    const settings = shift.user.settings;
    const autoEnabled = (settings?.clockInOutEnabled ?? true) && (settings?.clockInType ?? "automatic") === "automatic";
    const isLive = now >= startMs && now <= endMs;
    const active = activeByShift.get(shift.id);

    // ── Auto clock-in ──
    if (autoEnabled && isLive && !active) {
      const wage = shift.salaries[0];
      const session = await prisma.clockSession.create({
        data: {
          userId: shift.userId,
          shiftId: shift.id,
          salaryId: wage?.id ?? null,
          employerId: wage?.employerId ?? null,
          clockInTime: nowDate,
          status: "active",
          isAutoCalculated: true,
        },
      });
      await emitNotification({
        userId: shift.userId,
        type: NotificationType.CLOCK_IN,
        title: "Shift started",
        message: "Shift started, clocked in!",
        relatedId: session.id,
        relatedType: "clock",
      });
    }

    // ── Half-way water reminder (once) ──
    if (isLive && now >= startMs + (endMs - startMs) / 2 && !wateredShifts.has(shift.id)) {
      await emitNotification({
        userId: shift.userId,
        type: NotificationType.SHIFT_WATER,
        title: "Halfway there",
        message: "Take some water and continue the remaining shifts buddy!",
        relatedId: shift.id,
        relatedType: "shift",
      });
    }
  }

  // ── Auto clock-out: any active auto session whose shift has ended ──
  for (const session of activeSessions) {
    const shift = shifts.find((s) => s.id === session.shiftId);
    if (!shift) continue;
    const [, endMs] = intervalMs(shift.startTime, shift.endTime);
    if (now <= endMs) continue;

    const totalHours = Math.max(0, Math.round(((now - session.clockInTime.getTime()) / 3_600_000) * 100) / 100);
    const rate = session.salary?.hourlyPayRate ?? 0;
    const earnings = Math.round(totalHours * rate * 100) / 100;

    await prisma.clockSession.update({
      where: { id: session.id },
      data: { clockOutTime: nowDate, totalHours, earnings, status: "completed" },
    });
    await emitNotification({
      userId: shift.userId,
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
