// src/controllers/notification.controller.ts
// ─────────────────────────────────────────────
// Notification Controller — the "Recent Activity" feed
//
// GET    /api/notifications              list delivered notifications (+unread count)
// GET    /api/notifications/unread-count unread count only (for badges)
// PATCH  /api/notifications/:id/read     mark one as read
// PATCH  /api/notifications/read-all      mark all as read
// DELETE /api/notifications/:id          delete one
//
// "Delivered" = scheduledAt <= now, so scheduled reminders only appear once
// they become relevant.
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { parsePagination } from "../helpers/validators";
import { sendSuccess, sendNotFound } from "../helpers/api.response";

// ─────────────────────────────────────────────
// LIST — GET /api/notifications?unreadOnly=&page=&limit=
// ─────────────────────────────────────────────

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip } = parsePagination(req.query);
  const now = new Date();

  const where: Prisma.NotificationWhereInput = { userId, scheduledAt: { lte: now } };
  if (req.query.unreadOnly === "true") where.isRead = false;

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false, scheduledAt: { lte: now } } }),
  ]);

  sendSuccess(res, "Notifications fetched successfully", items, 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: { unread },
  });
});

// ─────────────────────────────────────────────
// UNREAD COUNT — GET /api/notifications/unread-count
// ─────────────────────────────────────────────

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const count = await prisma.notification.count({
    where: { userId, isRead: false, scheduledAt: { lte: new Date() } },
  });
  sendSuccess(res, "Unread count fetched successfully", { count });
});

// ─────────────────────────────────────────────
// MARK ONE READ — PATCH /api/notifications/:id/read
// ─────────────────────────────────────────────

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.notification.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Notification not found");
    return;
  }

  const updated = await prisma.notification.update({ where: { id }, data: { isRead: true } });
  sendSuccess(res, "Notification marked as read", updated);
});

// ─────────────────────────────────────────────
// MARK ALL READ — PATCH /api/notifications/read-all
// ─────────────────────────────────────────────

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  sendSuccess(res, "All notifications marked as read");
});

// ─────────────────────────────────────────────
// DELETE — DELETE /api/notifications/:id
// ─────────────────────────────────────────────

export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const existing = await prisma.notification.findFirst({ where: { id, userId } });
  if (!existing) {
    sendNotFound(res, "Notification not found");
    return;
  }

  await prisma.notification.delete({ where: { id } });
  sendSuccess(res, "Notification deleted successfully");
});
