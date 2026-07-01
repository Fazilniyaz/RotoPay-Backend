// src/controllers/report.controller.ts
// ─────────────────────────────────────────────
// Report Controller — generate + store export snapshots
//
// POST   /api/reports/generate  compute a report for the last N months, store
//                               it, prune old ones, return the data
// GET    /api/reports           list stored report history (metadata)
// GET    /api/reports/:id        fetch one stored report's full data
//
// A report covers [now - months, now] (months from the request or the user's
// `reportMonths` setting, default 1, max 3). Content: shifts, wages, amount
// earned (global currency), native amount earned (live-converted), payments,
// and totals. Retention: only the last 3 months of reports are kept per user.
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendNotFound } from "../helpers/api.response";
import { GenerateReportInput } from "../helpers/report.validation";
import { getRate } from "../utilities/currency";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const RETENTION_MONTHS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Compute the full report snapshot for a period.
async function buildReport(userId: string, months: number) {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);

  const [shifts, wages, settings, paidMonths] = await Promise.all([
    prisma.shift.findMany({
      where: { userId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: { id: true, shiftName: true, shiftType: true, date: true, totalHours: true },
    }),
    prisma.salary.findMany({
      where: { userId, shift: { is: { date: { gte: start, lte: end } } } },
      include: {
        shift: { select: { id: true, shiftName: true, shiftType: true, date: true } },
        employer: { select: { employerName: true, store: true } },
      },
    }),
    prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }),
    prisma.paidMonth.findMany({ where: { userId } }),
  ]);

  const currency = settings.currency;
  const nativeCurrency = settings.nativeCurrency ?? settings.currency;

  // Earnings per shift (a shift can carry several wages).
  const earnedByShift = new Map<string, number>();
  for (const w of wages) {
    if (!w.shiftId) continue;
    earnedByShift.set(w.shiftId, (earnedByShift.get(w.shiftId) ?? 0) + (w.salary ?? 0));
  }

  const earned = wages.reduce((s, w) => s + (w.salary ?? 0), 0);
  const hours = shifts.reduce((s, sh) => s + (sh.totalHours ?? 0), 0);

  // Live global → native conversion (snapshotted into the report).
  let rate: number | null = null;
  try {
    rate = await getRate(currency, nativeCurrency);
  } catch {
    rate = currency === nativeCurrency ? 1 : null;
  }
  const nativeEarned = rate != null ? round2(earned * rate) : null;

  // Payments (marked-paid months) that fall inside the window.
  const startMonthKey = start.getFullYear() * 12 + start.getMonth();
  const endMonthKey = end.getFullYear() * 12 + end.getMonth();
  const payments = paidMonths
    .filter((p) => {
      const key = p.year * 12 + (p.month - 1);
      return key >= startMonthKey && key <= endMonthKey;
    })
    .map((p) => ({
      month: p.month,
      year: p.year,
      label: `${MONTHS[p.month - 1]} ${p.year}`,
      amount: round2(p.amount),
    }))
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));

  return {
    period: { start: start.toISOString(), end: end.toISOString(), months },
    currency,
    nativeCurrency,
    rate,
    totals: {
      shifts: shifts.length,
      hours: round2(hours),
      earned: round2(earned),
      nativeEarned,
      wages: wages.length,
      paidTotal: round2(payments.reduce((s, p) => s + p.amount, 0)),
    },
    shifts: shifts.map((sh) => ({
      date: sh.date.toISOString(),
      name: sh.shiftName ?? "",
      type: sh.shiftType ?? "",
      hours: sh.totalHours ?? 0,
      earned: round2(earnedByShift.get(sh.id) ?? 0),
    })),
    wages: wages.map((w) => ({
      shift: w.shift?.shiftName || w.shift?.shiftType || "—",
      employee: w.employer?.employerName ?? "—",
      rateType: w.rateType ?? "hourly",
      currency: w.currency ?? currency,
      value: round2(w.salary ?? 0),
    })),
    payments,
  };
}

// ─────────────────────────────────────────────
// GENERATE — POST /api/reports/generate
// ─────────────────────────────────────────────

export const generateReport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as GenerateReportInput;

  // Requested months, else the saved setting, else 1 — clamped to [1, 3].
  let months = body.months;
  if (months === undefined) {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { reportMonths: true },
    });
    months = settings?.reportMonths ?? 1;
  }
  months = Math.min(3, Math.max(1, months));

  const data = await buildReport(userId, months);

  const report = await prisma.report.create({
    data: {
      userId,
      months,
      periodStart: new Date(data.period.start),
      periodEnd: new Date(data.period.end),
      data,
    },
  });

  // Retention: drop reports older than 3 months.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  await prisma.report
    .deleteMany({ where: { userId, createdAt: { lt: cutoff } } })
    .catch(() => undefined);

  sendSuccess(res, "Report generated successfully", { id: report.id, ...data });
});

// ─────────────────────────────────────────────
// LIST — GET /api/reports  (history, metadata only)
// ─────────────────────────────────────────────

export const listReports = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);

  const [items, total] = await Promise.all([
    prisma.report.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: { id: true, months: true, periodStart: true, periodEnd: true, createdAt: true },
    }),
    prisma.report.count({ where: { userId } }),
  ]);

  sendSuccess(res, "Reports fetched successfully", items, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// ─────────────────────────────────────────────
// READ ONE — GET /api/reports/:id
// ─────────────────────────────────────────────

export const getReportById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const report = await prisma.report.findFirst({ where: { id, userId } });
  if (!report) {
    sendNotFound(res, "Report not found");
    return;
  }

  sendSuccess(res, "Report fetched successfully", { id: report.id, ...(report.data as object) });
});
