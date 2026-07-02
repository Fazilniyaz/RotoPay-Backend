// src/controllers/employer.controller.ts
// ─────────────────────────────────────────────
// Employer Controller — CRUD
//
// POST   /api/employers        create
// GET    /api/employers        list (filter + paginate)
// GET    /api/employers/:id    read one
// PATCH  /api/employers/:id    update
// DELETE /api/employers/:id    delete
//
// OWNERSHIP RULE: every query is scoped by the authenticated user's id
// (req.user.userId). A user can only ever see or touch their own employers.
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import {
  sendSuccess,
  sendCreated,
  sendNotFound,
  sendError,
} from "../helpers/api.response";
import {
  CreateEmployerInput,
  UpdateEmployerInput,
} from "../helpers/employer.validation";

// A user may register at most this many employers.
export const MAX_EMPLOYERS = 3;

// ─────────────────────────────────────────────
// CREATE — POST /api/employers
// ─────────────────────────────────────────────

export const createEmployer = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as CreateEmployerInput;

  // Enforce the per-user employer cap.
  const existingCount = await prisma.employer.count({ where: { userId } });
  if (existingCount >= MAX_EMPLOYERS) {
    sendError(
      res,
      `You can add a maximum of ${MAX_EMPLOYERS} employees.`,
      409
    );
    return;
  }

  const employer = await prisma.employer.create({
    data: {
      userId,
      store: body.store,
      employerName: body.employerName,
      notes: body.notes ?? null,
      isActive: body.isActive ?? true,
    },
  });

  sendCreated(res, "Employer created successfully", employer);
});

// ─────────────────────────────────────────────
// LIST — GET /api/employers
// Query: ?isActive=true&search=tesco&page=1&limit=20
// ─────────────────────────────────────────────

export const getEmployers = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);

  // Build the filter incrementally so unset query params are simply ignored.
  const where: Prisma.EmployerWhereInput = { userId };

  if (req.query.isActive === "true") where.isActive = true;
  if (req.query.isActive === "false") where.isActive = false;

  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const search = req.query.search.trim();
    where.OR = [
      { store: { contains: search, mode: "insensitive" } },
      { employerName: { contains: search, mode: "insensitive" } },
    ];
  }

  // Run the page query and the total count together.
  const [employers, total] = await Promise.all([
    prisma.employer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.employer.count({ where }),
  ]);

  sendSuccess(res, "Employers fetched successfully", employers, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// ─────────────────────────────────────────────
// READ ONE — GET /api/employers/:id
// ─────────────────────────────────────────────

export const getEmployerById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  // findFirst (not findUnique) so we can match on id AND userId in one query —
  // this is what enforces ownership.
  const employer = await prisma.employer.findFirst({ where: { id, userId } });

  if (!employer) {
    sendNotFound(res, "Employer not found");
    return;
  }

  sendSuccess(res, "Employer fetched successfully", employer);
});

// ─────────────────────────────────────────────
// UPDATE — PATCH /api/employers/:id
// ─────────────────────────────────────────────

export const updateEmployer = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const body = req.body as UpdateEmployerInput;

  // 1) Ownership check — confirm the record exists AND belongs to this user.
  const existing = await prisma.employer.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Employer not found");
    return;
  }

  // 2) Apply only the fields that were actually sent.
  const employer = await prisma.employer.update({
    where: { id },
    data: {
      ...(body.store !== undefined && { store: body.store }),
      ...(body.employerName !== undefined && { employerName: body.employerName }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  sendSuccess(res, "Employer updated successfully", employer);
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/employers/:id
//
// Behaviour (declared in schema.prisma):
//   • Employer and Shift are independent — shifts are untouched.
//   • Salary rows for this employer are KEPT, with employerId set to null
//     (onDelete: SetNull) so the pay value is preserved.
//   • Clock sessions for this employer are deleted (onDelete: Cascade).
// For a non-destructive option, PATCH { isActive: false } instead (soft delete).
// ─────────────────────────────────────────────

export const deleteEmployer = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.employer.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Employer not found");
    return;
  }

  await prisma.employer.delete({ where: { id } });

  sendSuccess(res, "Employer deleted successfully");
});