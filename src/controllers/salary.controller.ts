// src/controllers/salary.controller.ts
// ─────────────────────────────────────────────
// Salary Controller — CRUD
//
// POST   /api/salaries        create
// GET    /api/salaries        list (filter + paginate + summary)
// GET    /api/salaries/:id    read one
// PATCH  /api/salaries/:id    update (re-link shift/employer, change value)
// DELETE /api/salaries/:id    delete
//
// A Salary row is the link between a Shift and an Employer, plus the pay value.
// It is scoped by userId. shiftId / employerId may each be null (detached).
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendCreated, sendNotFound, sendError } from "../helpers/api.response";
import { CreateSalaryInput, UpdateSalaryInput } from "../helpers/salary.validation";

const salaryInclude = {
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
  employer: { select: { id: true, store: true, employerName: true } },
};

// Confirm a shift / employer belongs to the user. Returns false if an id was
// given but isn't owned (so the caller can 404).
async function ownsShift(userId: string, shiftId: string): Promise<boolean> {
  return (await prisma.shift.count({ where: { id: shiftId, userId } })) > 0;
}
async function ownsEmployer(userId: string, employerId: string): Promise<boolean> {
  return (await prisma.employer.count({ where: { id: employerId, userId } })) > 0;
}

// Total pay = hourlyPayRate × the linked shift's totalHours (rounded to 2dp).
// e.g. £4/h × 8h = £32. Null when there's no shift/rate to derive it from.
async function computeTotalFromRate(
  userId: string,
  shiftId: string | null | undefined,
  hourlyPayRate: number | null | undefined
): Promise<number | null> {
  if (!shiftId || hourlyPayRate == null) return null;
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, userId },
    select: { totalHours: true },
  });
  if (!shift || shift.totalHours == null) return null;
  return Math.round(hourlyPayRate * shift.totalHours * 100) / 100;
}

// ─────────────────────────────────────────────
// CREATE — POST /api/salaries
// ─────────────────────────────────────────────

export const createSalary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateSalaryInput;

  if (body.shiftId && !(await ownsShift(userId, body.shiftId))) {
    sendError(res, "Shift not found", 404);
    return;
  }
  if (body.employerId && !(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employer not found", 404);
    return;
  }

  // The entered value is the hourly rate; the shift's hours derive the total pay.
  const total = await computeTotalFromRate(userId, body.shiftId, body.hourlyPayRate);

  const salary = await prisma.salary.create({
    data: {
      userId,
      salary: total,
      hourlyPayRate: body.hourlyPayRate,
      shiftId: body.shiftId ?? null,
      employerId: body.employerId ?? null,
      rateType: "hourly",
      currency: body.currency ?? null,
    },
    include: salaryInclude,
  });

  sendCreated(res, "Salary created successfully", salary);
});

// ─────────────────────────────────────────────
// LIST — GET /api/salaries
// Query: ?shiftId=&employerId=&page=&limit=
// ─────────────────────────────────────────────

export const getSalaries = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);

  const where: Prisma.SalaryWhereInput = { userId };
  if (typeof req.query.shiftId === "string") where.shiftId = req.query.shiftId;
  if (typeof req.query.employerId === "string") where.employerId = req.query.employerId;

  const [salaries, total, summary] = await Promise.all([
    prisma.salary.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: salaryInclude,
    }),
    prisma.salary.count({ where }),
    prisma.salary.aggregate({ where, _sum: { salary: true } }),
  ]);

  sendSuccess(res, "Salaries fetched successfully", salaries, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: { totalSalary: summary._sum.salary ?? 0 },
  });
});

// ─────────────────────────────────────────────
// READ ONE — GET /api/salaries/:id
// ─────────────────────────────────────────────

export const getSalaryById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const salary = await prisma.salary.findFirst({
    where: { id, userId },
    include: salaryInclude,
  });

  if (!salary) {
    sendNotFound(res, "Salary not found");
    return;
  }

  sendSuccess(res, "Salary fetched successfully", salary);
});

// ─────────────────────────────────────────────
// UPDATE — PATCH /api/salaries/:id
// Can change the value and re-link (or detach, via null) shift / employer.
// ─────────────────────────────────────────────

export const updateSalary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const body = req.body as UpdateSalaryInput;

  const existing = await prisma.salary.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Salary not found");
    return;
  }

  // Verify ownership only when a non-null id is supplied.
  if (body.shiftId && !(await ownsShift(userId, body.shiftId))) {
    sendError(res, "Shift not found", 404);
    return;
  }
  if (body.employerId && !(await ownsEmployer(userId, body.employerId))) {
    sendError(res, "Employer not found", 404);
    return;
  }

  // Recompute the derived total from the merged shift + hourly rate.
  const effShiftId = body.shiftId !== undefined ? body.shiftId : existing.shiftId;
  const effRate = body.hourlyPayRate !== undefined ? body.hourlyPayRate : existing.hourlyPayRate;
  const total = await computeTotalFromRate(userId, effShiftId, effRate);

  const salary = await prisma.salary.update({
    where: { id },
    data: {
      salary: total,
      ...(body.hourlyPayRate !== undefined && { hourlyPayRate: body.hourlyPayRate }),
      rateType: "hourly",
      ...(body.currency !== undefined && { currency: body.currency }),
      // `shiftId`/`employerId` present in body (incl. null) → apply it.
      ...(body.shiftId !== undefined && { shiftId: body.shiftId }),
      ...(body.employerId !== undefined && { employerId: body.employerId }),
    },
    include: salaryInclude,
  });

  sendSuccess(res, "Salary updated successfully", salary);
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/salaries/:id
// ─────────────────────────────────────────────

export const deleteSalary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.salary.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Salary not found");
    return;
  }

  await prisma.salary.delete({ where: { id } });

  sendSuccess(res, "Salary deleted successfully");
});
