// src/controllers/calendar.controller.ts
// ─────────────────────────────────────────────
// Calendar Controller — CRUD for calendar entries
//
// POST   /api/calendar        create an entry (custom text, optional shift)
// GET    /api/calendar        list entries in a date range (?from=&to=)
// GET    /api/calendar/:id    read one
// PATCH  /api/calendar/:id    update
// DELETE /api/calendar/:id    delete
//
// Shifts themselves are drawn on the calendar from /api/shifts — this model
// holds the user's own custom day notes (gym session, holiday, …).
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess, sendCreated, sendNotFound, sendError } from "../helpers/api.response";
import { CreateCalendarInput, UpdateCalendarInput } from "../helpers/calendar.validation";

const entryInclude = {
  shift: {
    select: {
      id: true,
      shiftName: true,
      date: true,
      startTime: true,
      endTime: true,
      totalHours: true,
      shiftType: true,
      status: true,
    },
  },
};

// Confirm an employer belongs to the user (for employee-scoped entries).
async function ownsEmployer(userId: string, employerId: string): Promise<boolean> {
  return (await prisma.employer.count({ where: { id: employerId, userId } })) > 0;
}

// ─────────────────────────────────────────────
// CREATE — POST /api/calendar
// ─────────────────────────────────────────────

export const createCalendarEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateCalendarInput;

  if (body.shiftId) {
    const owns = await prisma.shift.count({ where: { id: body.shiftId, userId } });
    if (!owns) {
      sendError(res, "Shift not found", 404);
      return;
    }
  }
  if (body.employerId && !(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employee not found", 404);
    return;
  }

  const entry = await prisma.calendarEntry.create({
    data: {
      userId,
      date: body.date,
      type: body.type,
      title: body.title,
      shiftId: body.shiftId ?? null,
      employerId: body.employerId ?? null,
      color: body.color ?? null,
    },
    include: entryInclude,
  });

  sendCreated(res, "Calendar entry created successfully", entry);
});

// ─────────────────────────────────────────────
// LIST — GET /api/calendar?from=&to=&employerId=
// employerId present → that employee's entries; absent → the user's own
// (employerId null) calendar.
// ─────────────────────────────────────────────

export const getCalendarEntries = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const where: Prisma.CalendarEntryWhereInput = { userId };

  if (typeof req.query.employerId === "string" && req.query.employerId.trim()) {
    where.employerId = req.query.employerId.trim();
  } else {
    where.employerId = null;
  }

  const dateFilter: Prisma.DateTimeFilter = {};
  if (typeof req.query.from === "string") {
    const from = new Date(req.query.from);
    if (!isNaN(from.getTime())) dateFilter.gte = from;
  }
  if (typeof req.query.to === "string") {
    const to = new Date(req.query.to);
    if (!isNaN(to.getTime())) dateFilter.lte = to;
  }
  if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

  const entries = await prisma.calendarEntry.findMany({
    where,
    orderBy: { date: "asc" },
    include: entryInclude,
  });

  sendSuccess(res, "Calendar entries fetched successfully", entries);
});

// ─────────────────────────────────────────────
// READ ONE — GET /api/calendar/:id
// ─────────────────────────────────────────────

export const getCalendarEntryById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const entry = await prisma.calendarEntry.findFirst({ where: { id, userId }, include: entryInclude });
  if (!entry) {
    sendNotFound(res, "Calendar entry not found");
    return;
  }
  sendSuccess(res, "Calendar entry fetched successfully", entry);
});

// ─────────────────────────────────────────────
// UPDATE — PATCH /api/calendar/:id
// ─────────────────────────────────────────────

export const updateCalendarEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const body = req.body as UpdateCalendarInput;

  const existing = await prisma.calendarEntry.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Calendar entry not found");
    return;
  }

  if (body.shiftId) {
    const owns = await prisma.shift.count({ where: { id: body.shiftId, userId } });
    if (!owns) {
      sendError(res, "Shift not found", 404);
      return;
    }
  }
  if (body.employerId && !(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employee not found", 404);
    return;
  }

  const entry = await prisma.calendarEntry.update({
    where: { id },
    data: {
      ...(body.date !== undefined && { date: body.date }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.shiftId !== undefined && { shiftId: body.shiftId }),
      ...(body.employerId !== undefined && { employerId: body.employerId }),
      ...(body.color !== undefined && { color: body.color }),
    },
    include: entryInclude,
  });

  sendSuccess(res, "Calendar entry updated successfully", entry);
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/calendar/:id
// ─────────────────────────────────────────────

export const deleteCalendarEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.calendarEntry.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Calendar entry not found");
    return;
  }

  await prisma.calendarEntry.delete({ where: { id } });
  sendSuccess(res, "Calendar entry deleted successfully");
});
