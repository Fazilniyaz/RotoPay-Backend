// src/controllers/payment.controller.ts
// ─────────────────────────────────────────────
// Payment Controller — "mark a month as paid"
//
// GET    /api/payments        list months the user has marked paid
// POST   /api/payments/mark   mark a month paid (snapshots that month's pay)
// DELETE /api/payments        unmark a month
//
// A paid month's `amount` is the sum of the wage values of all shifts whose
// `date` falls in that month, snapshotted at mark time. Drives the shift
// module's "This Month Pay" and "Total Pay" tabs.
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

// Sum wage values of all shifts whose date falls in the given month.
async function computeMonthAmount(userId: string, year: number, month: number): Promise<number> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1); // exclusive upper bound
  const agg = await prisma.salary.aggregate({
    where: { userId, shift: { is: { date: { gte: start, lt: end } } } },
    _sum: { salary: true },
  });
  return agg._sum.salary ?? 0;
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
