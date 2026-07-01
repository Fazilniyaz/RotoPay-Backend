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
import { sendSuccess, sendError } from "../helpers/api.response";
import { UpdateSettingsInput } from "../helpers/settings.validation";
import { uploadProfileImage, deleteImage } from "../utilities/imagekit";
import { emitNotification, NotificationType } from "../helpers/notification.service";

async function buildPayload(userId: string) {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true, profilePicture: true },
    }),
    prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }),
  ]);
  return {
    profile: {
      displayName: user?.displayName ?? "",
      email: user?.email ?? "",
      profilePicture: user?.profilePicture ?? null,
    },
    settings: {
      currency: settings.currency,
      // Falls back to the global currency when the user hasn't set a native one.
      nativeCurrency: settings.nativeCurrency ?? settings.currency,
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
      reportMonths: settings.reportMonths ?? 1,
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

  const prefs: {
    currency?: string;
    nativeCurrency?: string;
    dateFormat?: string;
    timeFormat?: string;
    reportMonths?: number;
  } = {};
  if (body.currency !== undefined) prefs.currency = body.currency;
  if (body.nativeCurrency !== undefined) prefs.nativeCurrency = body.nativeCurrency;
  if (body.dateFormat !== undefined) prefs.dateFormat = body.dateFormat;
  if (body.timeFormat !== undefined) prefs.timeFormat = body.timeFormat;
  if (body.reportMonths !== undefined) prefs.reportMonths = body.reportMonths;

  if (Object.keys(prefs).length > 0) {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: prefs,
    });
  }

  if (body.displayName !== undefined) {
    await emitNotification({
      userId,
      type: NotificationType.PROFILE_UPDATED,
      title: "Profile updated",
      message: "Your profile details were updated.",
      relatedType: "profile",
    });
  }

  const payload = await buildPayload(userId);
  sendSuccess(res, "Settings saved successfully", payload);
});

// ─────────────────────────────────────────────
// PATCH — /api/settings/profile-picture
// Replaces the user's profile photo. The new image is uploaded to ImageKit
// first; only after it succeeds is the previous image deleted from ImageKit,
// so a failed upload never leaves the user with no photo.
// ─────────────────────────────────────────────

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const updateProfilePicture = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { image } = req.body as { image?: string };

  if (!image || typeof image !== "string") {
    return sendError(res, "No image provided", 400);
  }

  // Validate it's a base64 image data URI and within the size limit.
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(image);
  if (!match) {
    return sendError(res, "Image must be a base64-encoded data URI", 400);
  }
  const [, mime, rawBase64] = match;
  const sizeBytes = Math.floor((rawBase64.length * 3) / 4);
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return sendError(res, "Image must be 5MB or smaller", 400);
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePictureId: true },
  });

  const ext = mime.split("/")[1] || "png";
  const uploaded = await uploadProfileImage(image, `user_${userId}.${ext}`);

  await prisma.user.update({
    where: { id: userId },
    data: { profilePicture: uploaded.url, profilePictureId: uploaded.fileId },
  });

  // Remove the previous image now that the new one is persisted. Best-effort —
  // a failure here shouldn't fail the request (it just leaves an orphan file).
  if (existing?.profilePictureId) {
    try {
      await deleteImage(existing.profilePictureId);
    } catch (err) {
      console.error("[Settings] Failed to delete old profile picture:", err);
    }
  }

  await emitNotification({
    userId,
    type: NotificationType.PROFILE_UPDATED,
    title: "Profile updated",
    message: "Your profile photo was updated.",
    relatedType: "profile",
  });

  const payload = await buildPayload(userId);
  sendSuccess(res, "Profile picture updated successfully", payload);
});

// ─────────────────────────────────────────────
// DELETE — /api/settings/profile-picture
// Removes the current profile photo from ImageKit and clears it on the user.
// ─────────────────────────────────────────────

export const deleteProfilePicture = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePictureId: true },
  });

  if (existing?.profilePictureId) {
    try {
      await deleteImage(existing.profilePictureId);
    } catch (err) {
      console.error("[Settings] Failed to delete profile picture:", err);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { profilePicture: null, profilePictureId: null },
  });

  const payload = await buildPayload(userId);
  sendSuccess(res, "Profile picture removed successfully", payload);
});
