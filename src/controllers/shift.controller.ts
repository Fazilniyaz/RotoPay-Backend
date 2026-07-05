// src/controllers/shift.controller.ts
// ─────────────────────────────────────────────
// Shift Controller — CRUD + analytics
//
// POST   /api/shifts            create a preset
// GET    /api/shifts            list presets (filter + search + paginate + summary)
// GET    /api/shifts/analytics  dashboard totals
// GET    /api/shifts/:id        read one
// PATCH  /api/shifts/:id        update
// DELETE /api/shifts/:id        delete (wage rows kept, shiftId set to null)
//
// A shift is a reusable PRESET — a time-of-day window + one employee, with NO
// date of its own. It is assigned onto specific days via CalendarEntry(type=
// "shift"); each assignment is one worked occurrence. Hours / pay are realised
// from those assignments, NOT from the preset itself.
//
// Duplicate rule: a user may not have two presets with the SAME employee AND the
// SAME start/end time-of-day.
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendCreated, sendNotFound, sendError } from "../helpers/api.response";
import { CreateShiftInput, UpdateShiftInput } from "../helpers/shift.validation";
import { cancelShiftReminders } from "../helpers/notification.service";

// The preset carries its employee + each wage row's employer basic info.
const shiftInclude = {
  employer: { select: { id: true, store: true, employerName: true } },
  salaries: {
    include: { employer: { select: { id: true, store: true, employerName: true } } },
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Absolute [startMs, endMs] for a shift's times (overnight-aware: end<=start ⇒ +1 day).
function intervalMs(startTime: Date, endTime: Date): [number, number] {
  const start = new Date(startTime).getTime();
  let end = new Date(endTime).getTime();
  if (end <= start) end += DAY_MS;
  return [start, end];
}

// Total hours worked, overnight-aware, rounded to 2dp — the single source of truth
// for a shift's duration (client-sent totalHours is ignored).
function hoursBetween(startTime: Date, endTime: Date): number {
  const [start, end] = intervalMs(startTime, endTime);
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

// Minutes-since-midnight for a time-of-day — used to compare preset timings
// regardless of the (meaningless) date component.
function minsOfDay(d: Date): number {
  const dt = new Date(d);
  return dt.getHours() * 60 + dt.getMinutes();
}

// Confirm an employer belongs to the user.
async function ownsEmployer(userId: string, employerId: string): Promise<boolean> {
  return (await prisma.employer.count({ where: { id: employerId, userId } })) > 0;
}

// Re-derive each linked wage's total (= hourlyPayRate × totalHours) after a
// shift's hours change, so pay stays accurate.
async function syncSalariesForShift(userId: string, shiftId: string, totalHours: number): Promise<void> {
  const wages = await prisma.salary.findMany({
    where: { userId, shiftId },
    select: { id: true, hourlyPayRate: true },
  });
  await Promise.all(
    wages
      .filter((w) => w.hourlyPayRate != null)
      .map((w) =>
        prisma.salary.update({
          where: { id: w.id },
          data: { salary: Math.round((w.hourlyPayRate as number) * totalHours * 100) / 100 },
        })
      )
  );
}

// True if the user already has a preset for this employee with the same start/end
// time-of-day (excludeId lets update skip the record being edited).
async function hasDuplicatePreset(
  userId: string,
  employerId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string
): Promise<boolean> {
  const siblings = await prisma.shift.findMany({
    where: { userId, employerId, ...(excludeId && { id: { not: excludeId } }) },
    select: { startTime: true, endTime: true },
  });
  const s = minsOfDay(startTime);
  const e = minsOfDay(endTime);
  return siblings.some((sh) => minsOfDay(sh.startTime) === s && minsOfDay(sh.endTime) === e);
}

// ─────────────────────────────────────────────
// CREATE — POST /api/shifts
// ─────────────────────────────────────────────

export const createShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateShiftInput;

  if (!(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employee not found", 404);
    return;
  }

  // Hours are the single source of truth for pay — always derived from the times.
  const totalHours = hoursBetween(body.startTime, body.endTime);

  if (await hasDuplicatePreset(userId, body.employerId, body.startTime, body.endTime)) {
    sendError(
      res,
      "Same shift is already allocated to this employee — change the timings or the employee.",
      409
    );
    return;
  }

  const shift = await prisma.shift.create({
    data: {
      userId,
      shiftName: body.shiftName ?? null,
      startTime: body.startTime,
      endTime: body.endTime,
      totalHours,
      shiftType: body.shiftType,
      color: body.color ?? null,
      employerId: body.employerId,
      isManualEntry: body.isManualEntry ?? false,
      notes: body.notes ?? null,
    },
    include: shiftInclude,
  });

  sendCreated(res, "Shift created successfully", shift);
});

// ─────────────────────────────────────────────
// LIST — GET /api/shifts
// Query: ?search=&employerId=&shiftType=&page=&limit=
//   search matches notes (case-insensitive)
// ─────────────────────────────────────────────

export const getShifts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);

  const where: Prisma.ShiftWhereInput = { userId };

  if (typeof req.query.shiftType === "string" && req.query.shiftType.trim()) {
    where.shiftType = req.query.shiftType.trim();
  }
  if (typeof req.query.employerId === "string" && req.query.employerId.trim()) {
    where.employerId = req.query.employerId.trim();
  }
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    where.notes = { contains: req.query.search.trim(), mode: "insensitive" };
  }

  const [shifts, total, summary] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: shiftInclude,
    }),
    prisma.shift.count({ where }),
    prisma.shift.aggregate({ where, _sum: { totalHours: true } }),
  ]);

  sendSuccess(res, "Shifts fetched successfully", shifts, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: { totalHours: summary._sum.totalHours ?? 0 },
  });
});

// ─────────────────────────────────────────────
// ANALYTICS — GET /api/shifts/analytics
// totalHours + thisMonthPay accumulate over THIS MONTH's calendar assignments
// (each assignment of a preset to a day adds its hours + wage; removing one
// subtracts). They RESET to 0 once the current month is marked paid — that pay
// has moved into totalPay (accumulated PaidMonth snapshots). Native Pay (client)
// = thisMonthPay converted. Next month starts fresh from 0.
// ─────────────────────────────────────────────

export const getShiftAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 1);

  const [currentPaid, monthAssignments, payTotal] = await Promise.all([
    // Is the CURRENT month already paid? If so, its figures have reset to 0.
    prisma.paidMonth.findUnique({ where: { userId_year_month: { userId, year, month } } }),
    prisma.calendarEntry.findMany({
      where: { userId, type: "shift", shiftId: { not: null }, date: { gte: startOfMonth, lt: endOfMonth } },
      select: { shiftId: true },
    }),
    prisma.paidMonth.aggregate({ where: { userId }, _sum: { amount: true } }),
  ]);

  // Sum this month's assignment hours + wages (skip entirely once paid).
  let totalHours = 0;
  let thisMonthPay = 0;
  if (!currentPaid && monthAssignments.length > 0) {
    const ids = Array.from(new Set(monthAssignments.map((a) => a.shiftId).filter(Boolean))) as string[];
    const shifts = await prisma.shift.findMany({
      where: { id: { in: ids } },
      select: { id: true, totalHours: true, salaries: { select: { salary: true } } },
    });
    const hoursById = new Map(shifts.map((s) => [s.id, s.totalHours ?? 0]));
    const wageById = new Map(
      shifts.map((s) => [s.id, (s.salaries ?? []).reduce((a, w) => a + (w.salary ?? 0), 0)])
    );
    for (const a of monthAssignments) {
      totalHours += hoursById.get(a.shiftId as string) ?? 0;
      thisMonthPay += wageById.get(a.shiftId as string) ?? 0;
    }
  }

  const roundedHours = Math.round(totalHours * 100) / 100;
  sendSuccess(res, "Shift analytics fetched successfully", {
    totalHours: roundedHours,
    thisMonthHours: roundedHours,
    totalPay: payTotal._sum.amount ?? 0,
    thisMonthPay: Math.round(thisMonthPay * 100) / 100,
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

  sendSuccess(res, "Shift fetched successfully", shift);
});

// ─────────────────────────────────────────────
// UPDATE — PATCH /api/shifts/:id  (preset fields only)
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

  if (body.employerId !== undefined && !(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employee not found", 404);
    return;
  }

  const startTime = body.startTime ?? existing.startTime;
  const endTime = body.endTime ?? existing.endTime;
  const employerId = body.employerId ?? existing.employerId;

  // Re-check the duplicate rule when timing or employee changed.
  if (
    employerId &&
    (body.startTime !== undefined || body.endTime !== undefined || body.employerId !== undefined) &&
    (await hasDuplicatePreset(userId, employerId, startTime, endTime, id))
  ) {
    sendError(
      res,
      "Same shift is already allocated to this employee — change the timings or the employee.",
      409
    );
    return;
  }

  const totalHours = hoursBetween(startTime, endTime);

  const shift = await prisma.shift.update({
    where: { id },
    data: {
      totalHours,
      ...(body.shiftName !== undefined && { shiftName: body.shiftName }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.endTime !== undefined && { endTime: body.endTime }),
      ...(body.shiftType !== undefined && { shiftType: body.shiftType }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.employerId !== undefined && { employerId: body.employerId }),
      ...(body.isManualEntry !== undefined && { isManualEntry: body.isManualEntry }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
    include: shiftInclude,
  });

  // Keep linked wages in sync: derived pay (rate × hours) and the auto-derived
  // employer both follow the preset.
  await syncSalariesForShift(userId, shift.id, totalHours);
  if (body.employerId !== undefined) {
    await prisma.salary.updateMany({ where: { userId, shiftId: shift.id }, data: { employerId: body.employerId } });
  }

  sendSuccess(res, "Shift updated successfully", shift);
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/shifts/:id
// Deleting a preset cascades to its wages AND its calendar assignments (schema
// onDelete: Cascade) — both are meaningless without the preset, so the employee's
// shift count and total pay drop accordingly.
// ─────────────────────────────────────────────

export const deleteShift = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.shift.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Shift not found");
    return;
  }

  // A preset's wages and calendar assignments are meaningless without it — remove
  // them so the employee's shift count AND total pay drop. (The schema also
  // declares these relations onDelete: Cascade; doing it explicitly guarantees the
  // behaviour regardless of the generated client's referential-action metadata.)
  await prisma.salary.deleteMany({ where: { userId, shiftId: id } });
  await prisma.calendarEntry.deleteMany({ where: { userId, shiftId: id } });
  await prisma.shift.delete({ where: { id } });

  // Drop any pending reminders scheduled for this preset's assignments.
  await cancelShiftReminders(userId, id);

  sendSuccess(res, "Shift deleted successfully");
});
