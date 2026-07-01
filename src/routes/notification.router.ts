// src/routes/notification.router.ts
// ─────────────────────────────────────────────
// Notification Router — recent activity feed
// ─────────────────────────────────────────────

import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validateParams, idParamSchema } from "../helpers/validators";

const router = Router();

router.use(authenticate);

router.get("/", notificationController.getNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/read-all", notificationController.markAllRead);
router.patch("/:id/read", validateParams(idParamSchema), notificationController.markRead);
router.delete("/:id", validateParams(idParamSchema), notificationController.deleteNotification);

export default router;
