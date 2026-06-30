// src/controllers/settings.controller.ts
// ─────────────────────────────────────────────
// Settings Controller — profile + global preferences
//
// GET   /api/settings    fetch profile + settings (creates defaults if missing)
// PATCH /api/settings    update displayName / currency / dateFormat / timeFormat
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { prisma } from "../utilities/prisma.client";
import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess } from "../helpers/api.response";
import { UpdateSettingsInput } from "../helpers/settings.validation";

async function buildPayload(userId: string) {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } }),
    prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }),
  ]);
  return {
    profile: { displayName: user?.displayName ?? "", email: user?.email ?? "" },
    settings: {
      currency: settings.currency,
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
      theme: settings.theme,
      language: settings.language,
    },
  };
}

// ─────────────────────────────────────────────
// GET — /api/settings
// ─────────────────────────────────────────────

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const payload = await buildPayload(userId);
  sendSuccess(res, "Settings fetched successfully", payload);
});

// ─────────────────────────────────────────────
// PATCH — /api/settings
// ─────────────────────────────────────────────

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const body = req.body as UpdateSettingsInput;

  // Profile lives on the User; preferences live on UserSettings.
  if (body.displayName !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { displayName: body.displayName } });
  }

  const prefs: Record<string, string> = {};
  if (body.currency !== undefined) prefs.currency = body.currency;
  if (body.dateFormat !== undefined) prefs.dateFormat = body.dateFormat;
  if (body.timeFormat !== undefined) prefs.timeFormat = body.timeFormat;

  if (Object.keys(prefs).length > 0) {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: prefs,
    });
  }

  const payload = await buildPayload(userId);
  sendSuccess(res, "Settings saved successfully", payload);
});
