// src/middlewares/error.middleware.ts
// ─────────────────────────────────────────────
// Global Error Handler Middleware
// Catches all unhandled errors from asyncHandler and Express
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import { env } from "../utilities/env";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const isDev = env.NODE_ENV === "development";

  console.error(`[Error] ${req.method} ${req.path}`, {
    message: err.message,
    stack: isDev ? err.stack : undefined,
    statusCode,
  });

  // Prisma known request errors
  if (err.constructor?.name === "PrismaClientKnownRequestError") {
    const prismaErr = err as AppError & { code?: string; meta?: { target?: string[] } };

    if (prismaErr.code === "P2002") {
      res.status(409).json({
        success: false,
        message: `A record with this ${prismaErr.meta?.target?.[0] ?? "value"} already exists`,
      });
      return;
    }

    if (prismaErr.code === "P2025") {
      res.status(404).json({
        success: false,
        message: "Record not found",
      });
      return;
    }
  }

  // JWT errors handled here if they bubble up
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
    return;
  }

  res.status(statusCode).json({
    success: false,
    message: isDev ? err.message : "Something went wrong — please try again",
    ...(isDev && { stack: err.stack }),
  });
}

// ── 404 Handler ────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
