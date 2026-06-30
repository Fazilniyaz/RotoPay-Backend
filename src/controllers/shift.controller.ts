// src/controllers/shift.controller.ts
// ─────────────────────────────────────────────
// Shift Controller — CRUD + analytics
//
// POST   /api/shifts            create (+ optional salary assignments)
// GET    /api/shifts            list (filter + search + paginate + summary)
// GET    /api/shifts/analytics  dashboard totals
// GET    /api/shifts/:id        read one
// PATCH  /api/shifts/:id        update
// DELETE /api/shifts/:id        delete (salary rows kept, shiftId set to null)
//
// STATUS / isActive are DERIVED from startDate/endDate vs the current date.
// They are stored on write AND re-derived on every read, so the value is always
// current the moment the app loads — no cron needed. Status filters are
// translated into date conditions for the same reason (always correct).
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma, ShiftStatus } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendCreated, sendNotFound, sendError } from "../helpers/api.response";
import { CreateShiftInput, UpdateShiftInput } from "../helpers/shift.validation";

// Each salary row brings along its employer's basic info.
const shiftInclude = {
  salaries: {
    include: { employer: { select: { id: true, store: true, employerName: true } } },
  },
};

// ── Derive status + isActive from the active date range ──
function deriveStatus(
  startDate: Date | null,
  endDate: Date | null,
  now: Date = new Date()
): { status: ShiftStatus | null; isActive: boolean } {
  if (!startDate || !endDate) return { status: null, isActive: false };
  if (now < startDate) return { status: ShiftStatus.upcoming, isActive: false };
  if (now > endDate) return { status: ShiftStatus.completed, isActive: false };
  return { status: ShiftStatus.isActive, isActive: true };
}

// Re-derive status/isActive on a fetched record so the response is always current.
function withCurrentStatus<T extends { startDate: Date | null; endDate: Date | null }>(
  shift: T
): T {
  return { ...shift, ...deriveStatus(shift.startDate, shift.endDate) };
}

// ─────────────────────────────────────────────
// CREATE — POST /api/shifts
// ─────────────────────────────────────────────

export const createShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateShiftInput;
  const assignments = body.salaries ?? [];

  if (assignments.length > 0) {
    const employerIds = [...new Set(assignments.map((a) => a.employerId))];
    const owned = await prisma.employer.count({ where: { id: { in: employerIds }, userId } });
    if (owned !== employerIds.length) {
      sendError(res, "One or more employers were not found", 404);
      return;
    }
  }

  const { status, isActive } = deriveStatus(body.startDate, body.endDate);

  const shift = await prisma.shift.create({
    data: {
      userId,
      shiftName: body.shiftName ?? null,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime,
      endTime: body.endTime,
      totalHours: body.totalHours,
      breakDuration: body.breakDuration ?? 0,
      shiftType: body.shiftType,
      status,
      isActive,
      confirmed: body.confirmed ?? false,
      isManualEntry: body.isManualEntry ?? false,
      notes: body.notes ?? null,
    },
  });

  if (assignments.length > 0) {
    try {
      const rateFor = (value: number) =>
        body.totalHours > 0 ? Math.round((value / body.totalHours) * 100) / 100 : null;
      await prisma.salary.createMany({
        data: assignments.map((a) => ({
          userId,
          shiftId: shift.id,
          employerId: a.employerId,
          salary: a.salary,
          hourlyPayRate: rateFor(a.salary),
        })),
      });
    } catch (err) {
      await prisma.shift.delete({ where: { id: shift.id } }).catch(() => undefined);
      throw err;
    }
  }

  const created = await prisma.shift.findUnique({
    where: { id: shift.id },
    include: shiftInclude,
  });

  sendCreated(res, "Shift created successfully", created && withCurrentStatus(created));
});

// ─────────────────────────────────────────────
// LIST — GET /api/shifts
// Query: ?status=&search=&employerId=&shiftType=&from=&to=&confirmed=&page=&limit=
//   status ∈ upcoming|isActive|completed (translated to date conditions)
//   search matches notes (case-insensitive)
// ─────────────────────────────────────────────

export const getShifts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);
  const now = new Date();

  const where: Prisma.ShiftWhereInput = { userId };
  const and: Prisma.ShiftWhereInput[] = [];

  if (req.query.confirmed === "true") where.confirmed = true;
  if (req.query.confirmed === "false") where.confirmed = false;

  const shiftType = req.query.shiftType;
  if (shiftType === "night" || shiftType === "day" || shiftType === "rotational") {
    where.shiftType = shiftType;
  }

  if (typeof req.query.employerId === "string") {
    where.salaries = { some: { employerId: req.query.employerId } };
  }

  // status → date conditions
  const status = req.query.status;
  if (status === "upcoming") and.push({ startDate: { gt: now } });
  else if (status === "completed") and.push({ endDate: { lt: now } });
  else if (status === "isActive") and.push({ startDate: { lte: now }, endDate: { gte: now } });

  // search (notes)
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    where.notes = { contains: req.query.search.trim(), mode: "insensitive" };
  }

  // date range on startDate
  const dateFilter: Prisma.DateTimeFilter = {};
  if (typeof req.query.from === "string") {
    const from = new Date(req.query.from);
    if (!isNaN(from.getTime())) dateFilter.gte = from;
  }
  if (typeof req.query.to === "string") {
    const to = new Date(req.query.to);
    if (!isNaN(to.getTime())) dateFilter.lte = to;
  }
  if (Object.keys(dateFilter).length > 0) and.push({ startDate: dateFilter });

  if (and.length > 0) where.AND = and;

  const [shifts, total, summary] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { startDate: "desc" },
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
// Totals for the shift dashboard cards (pay = linked Salary values by shift's
// startDate; week starts Monday; month = calendar month).
// ─────────────────────────────────────────────

export const getShiftAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const diffToMonday = (now.getDay() + 6) % 7;
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);

  const sumHours = (where: Prisma.ShiftWhereInput) =>
    prisma.shift.aggregate({ where, _sum: { totalHours: true } });
  const sumPay = (where: Prisma.SalaryWhereInput) =>
    prisma.salary.aggregate({ where, _sum: { salary: true } });

  const [hoursAll, hoursMonth, hoursWeek, payAll, payMonth, payWeek] = await Promise.all([
    sumHours({ userId }),
    sumHours({ userId, startDate: { gte: startOfMonth } }),
    sumHours({ userId, startDate: { gte: startOfWeek } }),
    sumPay({ userId }),
    sumPay({ userId, shift: { startDate: { gte: startOfMonth } } }),
    sumPay({ userId, shift: { startDate: { gte: startOfWeek } } }),
  ]);

  sendSuccess(res, "Shift analytics fetched successfully", {
    totalHours: hoursAll._sum.totalHours ?? 0,
    thisMonthHours: hoursMonth._sum.totalHours ?? 0,
    thisWeekHours: hoursWeek._sum.totalHours ?? 0,
    totalPay: payAll._sum.salary ?? 0,
    thisMonthPay: payMonth._sum.salary ?? 0,
    thisWeekPay: payWeek._sum.salary ?? 0,
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

  // Recompute status/isActive from the merged date range.
  const startDate = body.startDate ?? existing.startDate;
  const endDate = body.endDate ?? existing.endDate;
  const { status, isActive } = deriveStatus(startDate, endDate);

  const shift = await prisma.shift.update({
    where: { id },
    data: {
      status,
      isActive,
      ...(body.shiftName !== undefined && { shiftName: body.shiftName }),
      ...(body.startDate !== undefined && { startDate: body.startDate }),
      ...(body.endDate !== undefined && { endDate: body.endDate }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.endTime !== undefined && { endTime: body.endTime }),
      ...(body.totalHours !== undefined && { totalHours: body.totalHours }),
      ...(body.breakDuration !== undefined && { breakDuration: body.breakDuration }),
      ...(body.shiftType !== undefined && { shiftType: body.shiftType }),
      ...(body.confirmed !== undefined && { confirmed: body.confirmed }),
      ...(body.isManualEntry !== undefined && { isManualEntry: body.isManualEntry }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
    include: shiftInclude,
  });

  sendSuccess(res, "Shift updated successfully", withCurrentStatus(shift));
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/shifts/:id
// Salary rows are KEPT — their shiftId is set to null (schema onDelete: SetNull).
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

  sendSuccess(res, "Shift deleted successfully");
});
