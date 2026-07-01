// src/helpers/notification.service.ts
// ─────────────────────────────────────────────
// Notification / Activity emitter
//
// Central place to record user activities (shift added, payment confirmed, …)
// and schedule reminders. Everything a user does that's worth surfacing on the
// dashboard "Recent Activity" feed and the Notifications page flows through here.
//
// Delivery model: a notification "fires" when `scheduledAt <= now`. Immediate
// activities use scheduledAt = now; reminders use a future time (e.g. 1h before
// a shift). The list endpoint filters by scheduledAt, so reminders appear
// exactly when they become relevant — no cron/worker needed.
//
// Emitting is best-effort: a failure here must never break the main action, so
// every write is wrapped and errors are only logged.
// ─────────────────────────────────────────────

import { prisma } from "../utilities/prisma.client";

// Known activity types (kept in sync with the frontend's icon/colour map).
export const NotificationType = {
  SHIFT_ADDED: "shift_added",
  SHIFT_UPDATED: "shift_updated",
  SHIFT_REMOVED: "shift_removed",
  SHIFT_REMINDER: "shift_reminder",
  PROFILE_UPDATED: "profile_updated",
  PAYMENT_CONFIRMED: "payment_confirmed",
  EMPLOYEE_ADDED: "employee_added",
  WAGE_ADDED: "wage_added",
  CLOCK_IN: "clock_in",
  CLOCK_OUT: "clock_out",
} as const;

interface EmitInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string | null;
  relatedType?: string | null;
  scheduledAt?: Date; // defaults to now (immediate)
}

// Record an activity. Never throws.
export async function emitNotification(input: EmitInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        relatedId: input.relatedId ?? null,
        relatedType: input.relatedType ?? null,
        scheduledAt: input.scheduledAt ?? new Date(),
      },
    });
  } catch (err) {
    console.error("[Notification] Failed to emit:", err);
  }
}

const HOUR_MS = 60 * 60 * 1000;

// Schedule a "shift starts in 1 hour" reminder — but only if that moment is
// still in the future (no point reminding about past shifts).
export async function scheduleShiftReminder(
  userId: string,
  shiftId: string,
  startTime: Date,
  label: string
): Promise<void> {
  const start = new Date(startTime).getTime();
  if (start <= Date.now()) return; // shift already started/past

  const remindAt = new Date(start - HOUR_MS);
  await emitNotification({
    userId,
    type: NotificationType.SHIFT_REMINDER,
    title: "Upcoming shift",
    message: `${label} starts in about an hour.`,
    relatedId: shiftId,
    relatedType: "shift",
    scheduledAt: remindAt,
  });
}

// Remove a pending (not-yet-delivered) reminder for a shift — used when the
// shift is deleted or rescheduled so stale reminders don't fire.
export async function cancelShiftReminders(userId: string, shiftId: string): Promise<void> {
  try {
    await prisma.notification.deleteMany({
      where: {
        userId,
        relatedId: shiftId,
        type: NotificationType.SHIFT_REMINDER,
        scheduledAt: { gt: new Date() },
      },
    });
  } catch (err) {
    console.error("[Notification] Failed to cancel reminders:", err);
  }
}
