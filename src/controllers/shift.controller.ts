// src/controllers/shift.controller.ts
// ─────────────────────────────────────────────
// Shift Controller — CRUD + analytics
//
// POST   /api/shifts            create
// GET    /api/shifts            list (filter + search + paginate + summary)
// GET    /api/shifts/analytics  dashboard totals
// GET    /api/shifts/:id        read one
// PATCH  /api/shifts/:id        update
// DELETE /api/shifts/:id        delete (wage rows kept, shiftId set to null)
//
// A shift is a SINGLE day (`date`) + start/end times. STATUS / isActive are
// DERIVED from those vs the current moment (overnight-aware), stored on write
// and re-derived on every read — always current, no cron needed.
//
// Creating a shift only affects TOTAL HOURS. Pay ("This Month Pay" / "Total
// Pay") is realised separately via /api/payments (marking a month as paid).
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma, ShiftStatus } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendCreated, sendNotFound } from "../helpers/api.response";
import { CreateShiftInput, UpdateShiftInput } from "../helpers/shift.validation";
import {
  emitNotification,
  scheduleShiftReminder,
  cancelShiftReminders,
  NotificationType,
} from "../helpers/notification.service";

// Short, friendly date label for activity messages.
const dateLabel = (d: Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const shiftLabel = (s: { shiftName: string | null; shiftType: string | null }) =>
  s.shiftName || s.shiftType || "Shift";

// Each wage row brings along its employer's basic info.
const shiftInclude = {
  salaries: {
    include: { employer: { select: { id: true, store: true, employerName: true } } },
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Derive status + isActive from the shift's real start/end moments ──
// startTime/endTime already carry the full datetime; if end <= start the shift
// runs past midnight, so the end is on the following day.
function deriveStatus(
  startTime: Date,
  endTime: Date,
  now: Date = new Date()
): { status: ShiftStatus; isActive: boolean } {
  const start = new Date(startTime);
  let end = new Date(endTime);
  if (end <= start) end = new Date(end.getTime() + DAY_MS);
  if (now < start) return { status: ShiftStatus.upcoming, isActive: false };
  if (now > end) return { status: ShiftStatus.completed, isActive: false };
  return { status: ShiftStatus.isActive, isActive: true };
}

// Re-derive status/isActive on a fetched record so the response is always current.
function withCurrentStatus<T extends { startTime: Date; endTime: Date }>(shift: T): T {
  return { ...shift, ...deriveStatus(shift.startTime, shift.endTime) };
}

// ─────────────────────────────────────────────
// CREATE — POST /api/shifts
// ─────────────────────────────────────────────

export const createShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateShiftInput;

  const { status, isActive } = deriveStatus(body.startTime, body.endTime);

  const shift = await prisma.shift.create({
    data: {
      userId,
      shiftName: body.shiftName ?? null,
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      totalHours: body.totalHours,
      shiftType: body.shiftType,
      status,
      isActive,
      isManualEntry: body.isManualEntry ?? false,
      notes: body.notes ?? null,
    },
    include: shiftInclude,
  });

  const label = shiftLabel(shift);
  await emitNotification({
    userId,
    type: NotificationType.SHIFT_ADDED,
    title: "New shift added",
    message: `${label} on ${dateLabel(shift.date)}.`,
    relatedId: shift.id,
    relatedType: "shift",
  });
  await scheduleShiftReminder(userId, shift.id, shift.startTime, label);

  sendCreated(res, "Shift created successfully", withCurrentStatus(shift));
});

// ─────────────────────────────────────────────
// LIST — GET /api/shifts
// Query: ?status=&search=&employerId=&shiftType=&from=&to=&page=&limit=
//   status ∈ upcoming|isActive|completed (translated to day-bounded date filters)
//   search matches notes (case-insensitive)
// ─────────────────────────────────────────────

export const getShifts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);
  const now = new Date();

  const where: Prisma.ShiftWhereInput = { userId };
  const and: Prisma.ShiftWhereInput[] = [];

  // Free-form shift type (presets or custom label), exact match.
  if (typeof req.query.shiftType === "string" && req.query.shiftType.trim()) {
    where.shiftType = req.query.shiftType.trim();
  }

  if (typeof req.query.employerId === "string") {
    where.salaries = { some: { employerId: req.query.employerId } };
  }

  // status → day-bounded date conditions
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const status = req.query.status;
  if (status === "upcoming") and.push({ date: { gt: endOfToday } });
  else if (status === "completed") and.push({ date: { lt: startOfToday } });
  else if (status === "isActive") and.push({ date: { gte: startOfToday, lte: endOfToday } });

  // search (notes)
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    where.notes = { contains: req.query.search.trim(), mode: "insensitive" };
  }

  // date range on `date`
  const dateFilter: Prisma.DateTimeFilter = {};
  if (typeof req.query.from === "string") {
    const from = new Date(req.query.from);
    if (!isNaN(from.getTime())) dateFilter.gte = from;
  }
  if (typeof req.query.to === "string") {
    const to = new Date(req.query.to);
    if (!isNaN(to.getTime())) dateFilter.lte = to;
  }
  if (Object.keys(dateFilter).length > 0) and.push({ date: dateFilter });

  if (and.length > 0) where.AND = and;

  const [shifts, total, summary] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { date: "desc" },
      skip,
      take: limit,
      include: shiftInclude,
    }),
    prisma.shift.count({ where }),
    prisma.shift.aggregate({ where, _sum: { totalHours: true } }),
  ]);

  sendSuccess(res, "Shifts fetched successfully", shifts.map(withCurrentStatus), 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: { totalHours: summary._sum.totalHours ?? 0 },
  });
});

// ─────────────────────────────────────────────
// ANALYTICS — GET /api/shifts/analytics
// Total hours come from shifts; pay comes from PaidMonth snapshots (a month's
// pay is only realised once the user marks it paid on the calendar).
// ─────────────────────────────────────────────

export const getShiftAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const sumHours = (where: Prisma.ShiftWhereInput) =>
    prisma.shift.aggregate({ where, _sum: { totalHours: true } });

  const [hoursAll, hoursMonth, payTotal, payThisMonth] = await Promise.all([
    sumHours({ userId }),
    sumHours({ userId, date: { gte: startOfMonth } }),
    prisma.paidMonth.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.paidMonth.findUnique({ where: { userId_year_month: { userId, year, month } } }),
  ]);

  sendSuccess(res, "Shift analytics fetched successfully", {
    totalHours: hoursAll._sum.totalHours ?? 0,
    thisMonthHours: hoursMonth._sum.totalHours ?? 0,
    totalPay: payTotal._sum.amount ?? 0,
    thisMonthPay: payThisMonth?.amount ?? 0,
  });
});

// ─────────────────────────────────────────────
// READ ONE — GET /api/shifts/:id
// ─────────────────────────────────────────────

export const getShiftById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const shift = await prisma.shift.findFirst({ where: { id, userId }, include: shiftInclude });
  if (!shift) {
    sendNotFound(res, "Shift not found");
    return;
  }

  sendSuccess(res, "Shift fetched successfully", withCurrentStatus(shift));
});

// ─────────────────────────────────────────────
// UPDATE — PATCH /api/shifts/:id  (shift fields only)
// ─────────────────────────────────────────────

export const updateShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const body = req.body as UpdateShiftInput;

  const existing = await prisma.shift.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Shift not found");
    return;
  }

  // Recompute status/isActive from the merged times.
  const startTime = body.startTime ?? existing.startTime;
  const endTime = body.endTime ?? existing.endTime;
  const { status, isActive } = deriveStatus(startTime, endTime);

  const shift = await prisma.shift.update({
    where: { id },
    data: {
      status,
      isActive,
      ...(body.shiftName !== undefined && { shiftName: body.shiftName }),
      ...(body.date !== undefined && { date: body.date }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.endTime !== undefined && { endTime: body.endTime }),
      ...(body.totalHours !== undefined && { totalHours: body.totalHours }),
      ...(body.shiftType !== undefined && { shiftType: body.shiftType }),
      ...(body.isManualEntry !== undefined && { isManualEntry: body.isManualEntry }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
    include: shiftInclude,
  });

  // Refresh the reminder for the (possibly new) start time.
  await cancelShiftReminders(userId, shift.id);
  const label = shiftLabel(shift);
  await scheduleShiftReminder(userId, shift.id, shift.startTime, label);
  await emitNotification({
    userId,
    type: NotificationType.SHIFT_UPDATED,
    title: "Shift updated",
    message: `${label} on ${dateLabel(shift.date)} was updated.`,
    relatedId: shift.id,
    relatedType: "shift",
  });

  sendSuccess(res, "Shift updated successfully", withCurrentStatus(shift));
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/shifts/:id
// Wage rows are KEPT — their shiftId is set to null (schema onDelete: SetNull).
// ─────────────────────────────────────────────

export const deleteShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.shift.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Shift not found");
    return;
  }

  await prisma.shift.delete({ where: { id } });

  await cancelShiftReminders(userId, id);
  await emitNotification({
    userId,
    type: NotificationType.SHIFT_REMOVED,
    title: "Shift removed",
    message: `${shiftLabel(existing)} on ${dateLabel(existing.date)} was removed.`,
    relatedType: "shift",
  });

  sendSuccess(res, "Shift deleted successfully");
});
