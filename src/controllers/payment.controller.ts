// src/controllers/payment.controller.ts
// ─────────────────────────────────────────────
// Payment Controller — "mark a month as paid"
//
// GET    /api/payments        list months the user has marked paid
// POST   /api/payments/mark   mark a month paid (snapshots that month's pay)
// DELETE /api/payments        unmark a month
//
// Marking a month paid snapshots THAT MONTH's pay = the sum of the wages of every
// shift assigned to a day in that month (matching the live "This Month Pay" tab).
// It moves into the running "Total Pay"; unmarking removes it. Once the current
// month is paid, its Total Hours / This Month Pay reset to 0 (see shift analytics).
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess, sendNotFound } from "../helpers/api.response";
import { MarkPaymentInput } from "../helpers/payment.validation";
import { emitNotification, NotificationType } from "../helpers/notification.service";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Sum the wage of every shift ASSIGNED to a day in the given month (per-day
// multiplicity). Snapshotted into PaidMonth so past months keep their amount.
async function computeMonthAmount(userId: string, year: number, month: number): Promise<number> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1); // exclusive upper bound

  const assignments = await prisma.calendarEntry.findMany({
    where: { userId, type: "shift", shiftId: { not: null }, date: { gte: start, lt: end } },
    select: { shiftId: true },
  });
  if (assignments.length === 0) return 0;

  const shiftIds = Array.from(new Set(assignments.map((a) => a.shiftId).filter(Boolean))) as string[];
  const wages = await prisma.salary.findMany({
    where: { userId, shiftId: { in: shiftIds } },
    select: { shiftId: true, salary: true },
  });
  const wageByShift = new Map<string, number>();
  for (const w of wages) {
    if (!w.shiftId) continue;
    wageByShift.set(w.shiftId, (wageByShift.get(w.shiftId) ?? 0) + (w.salary ?? 0));
  }
  let amount = 0;
  for (const a of assignments) amount += wageByShift.get(a.shiftId as string) ?? 0;
  return Math.round(amount * 100) / 100;
}

// ─────────────────────────────────────────────
// LIST — GET /api/payments
// ─────────────────────────────────────────────

export const listPaidMonths = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const months = await prisma.paidMonth.findMany({
    where: { userId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  sendSuccess(res, "Paid months fetched successfully", months);
});

// ─────────────────────────────────────────────
// MARK — POST /api/payments/mark  { year, month }
// ─────────────────────────────────────────────

export const markMonthPaid = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { year, month } = req.body as MarkPaymentInput;

  const amount = await computeMonthAmount(userId, year, month);

  const record = await prisma.paidMonth.upsert({
    where: { userId_year_month: { userId, year, month } },
    create: { userId, year, month, amount },
    update: { amount },
  });

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { currency: true },
  });
  const cur = settings?.currency ?? "";
  await emitNotification({
    userId,
    type: NotificationType.PAYMENT_CONFIRMED,
    title: "Payment updated",
    message: `${MONTHS[month - 1]} ${year} marked as paid — ${cur} ${amount.toLocaleString()}.`,
    relatedType: "payment",
  });

  sendSuccess(res, "Month marked as paid", record);
});

// ─────────────────────────────────────────────
// UNMARK — DELETE /api/payments  { year, month }
// ─────────────────────────────────────────────

export const unmarkMonthPaid = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { year, month } = req.body as MarkPaymentInput;

  const existing = await prisma.paidMonth.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (!existing) {
    sendNotFound(res, "That month is not marked as paid");
    return;
  }

  await prisma.paidMonth.delete({ where: { id: existing.id } });
  sendSuccess(res, "Month unmarked");
});
