// src/controllers/clock.controller.ts
// ─────────────────────────────────────────────
// Clock Controller — Clock In / Out + history
//
// POST   /api/clock/in       start a session (references a Salary)
// POST   /api/clock/out      stop the active session, compute earnings
// GET    /api/clock/active   the current active session (or null)
// GET    /api/clock          history (filter + paginate + summary)
// DELETE /api/clock/:id      delete a session
//
// A clock session links to a Salary, which carries the employer + shift +
// hourlyPayRate. EARNINGS = clocked hours (clockOut − clockIn) × the salary's
// hourlyPayRate (which itself = salary ÷ shift.totalHours).
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendCreated, sendError, sendNotFound } from "../helpers/api.response";
import { ClockInInput } from "../helpers/clock.validation";
import { emitNotification, NotificationType } from "../helpers/notification.service";

// salary → employer details + shift details (the "fetch details" the model needs).
const clockInclude = {
  salary: {
    include: {
      employer: { select: { id: true, store: true, employerName: true } },
      shift: {
        select: {
          id: true,
          shiftName: true,
          startTime: true,
          endTime: true,
          totalHours: true,
          shiftType: true,
          color: true,
          employerId: true,
        },
      },
    },
  },
};

// ─────────────────────────────────────────────
// CLOCK IN — POST /api/clock/in
// ─────────────────────────────────────────────

export const clockIn = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { salaryId, notes } = req.body as ClockInInput;

  // The salary (employer + shift link) must belong to the user.
  const salary = await prisma.salary.findFirst({ where: { id: salaryId, userId } });
  if (!salary) {
    sendError(res, "Salary not found", 404);
    return;
  }

  // Allow multiple employees clocked in at once, but prevent clocking the
  // SAME salary/shift in twice while it's still active.
  const dupe = await prisma.clockSession.findFirst({
    where: { userId, salaryId: salary.id, status: "active" },
  });
  if (dupe) {
    sendError(res, "This shift is already clocked in", 409);
    return;
  }

  const session = await prisma.clockSession.create({
    data: {
      userId,
      salaryId: salary.id,
      employerId: salary.employerId ?? null,
      clockInTime: new Date(),
      status: "active",
      notes: notes ?? null,
    },
    include: clockInclude,
  });

  await emitNotification({
    userId,
    type: NotificationType.CLOCK_IN,
    title: "Shift started",
    message: "Shift started, clocked in!",
    relatedId: session.id,
    relatedType: "clock",
  });

  sendCreated(res, "Clocked in successfully", session);
});

// ─────────────────────────────────────────────
// CLOCK OUT — POST /api/clock/:id/out
// Stops a specific active session and computes hours + earnings.
// ─────────────────────────────────────────────

export const clockOut = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const notes = (req.body && typeof req.body.notes === "string" ? req.body.notes : undefined) as
    | string
    | undefined;

  const active = await prisma.clockSession.findFirst({
    where: { id, userId },
    include: clockInclude,
  });
  if (!active) {
    sendNotFound(res, "Clock session not found");
    return;
  }
  if (active.status !== "active") {
    sendError(res, "This session is already clocked out", 400);
    return;
  }

  const clockOutTime = new Date();
  const ms = clockOutTime.getTime() - active.clockInTime.getTime();
  const totalHours = Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);

  // Rate comes from the linked salary (salary ÷ shift.totalHours).
  const rate = active.salary?.hourlyPayRate ?? 0;
  const earnings = Math.round(totalHours * rate * 100) / 100;

  const session = await prisma.clockSession.update({
    where: { id: active.id },
    data: {
      clockOutTime,
      totalHours,
      earnings,
      status: "completed",
      ...(notes !== undefined && { notes }),
    },
    include: clockInclude,
  });

  await emitNotification({
    userId,
    type: NotificationType.CLOCK_OUT,
    title: "Shift ended",
    message: "Shift ended, clocked out!",
    relatedId: session.id,
    relatedType: "clock",
  });

  sendSuccess(res, "Clocked out successfully", session);
});

// ─────────────────────────────────────────────
// ACTIVE — GET /api/clock/active
// Returns ALL currently-active sessions (multiple employees can be clocked in).
// ─────────────────────────────────────────────

export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const sessions = await prisma.clockSession.findMany({
    where: { userId, status: "active" },
    orderBy: { clockInTime: "desc" },
    include: clockInclude,
  });
  sendSuccess(res, "Active sessions fetched", sessions);
});

// ─────────────────────────────────────────────
// LIST — GET /api/clock
// ─────────────────────────────────────────────

export const getClockSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);

  const where: Prisma.ClockSessionWhereInput = { userId };
  if (req.query.status === "active" || req.query.status === "completed") {
    where.status = req.query.status;
  }
  // Filter to sessions whose salary belongs to a given shift (calendar click →
  // "who's clocked in for this shift").
  if (typeof req.query.shiftId === "string") {
    where.salary = { shiftId: req.query.shiftId };
  }

  const [sessions, total, summary] = await Promise.all([
    prisma.clockSession.findMany({
      where,
      orderBy: { clockInTime: "desc" },
      skip,
      take: limit,
      include: clockInclude,
    }),
    prisma.clockSession.count({ where }),
    prisma.clockSession.aggregate({ where, _sum: { totalHours: true, earnings: true } }),
  ]);

  sendSuccess(res, "Clock sessions fetched successfully", sessions, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: {
      totalHours: summary._sum.totalHours ?? 0,
      totalEarnings: summary._sum.earnings ?? 0,
    },
  });
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/clock/:id
// ─────────────────────────────────────────────

export const deleteClockSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.clockSession.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Clock session not found");
    return;
  }

  await prisma.clockSession.delete({ where: { id } });
  sendSuccess(res, "Clock session deleted successfully");
});
