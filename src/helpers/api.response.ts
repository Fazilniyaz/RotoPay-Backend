// src/helpers/api.response.ts
// ─────────────────────────────────────────────
// Standardised API Response Helper
// Every API response goes through these — keeps the shape consistent
// ─────────────────────────────────────────────

import { Response } from "express";

// ── Response Shape ─────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Record<string, string[]> | null;
  meta?: Record<string, unknown>;
}

// ── Success Responses ──────────────────────────

export function sendSuccess<T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): Response {
  const response: ApiResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
    ...(meta && { meta }),
  };
  return res.status(statusCode).json(response);
}

export function sendCreated<T>(
  res: Response,
  message: string,
  data?: T
): Response {
  return sendSuccess(res, message, data, 201);
}

// ── Error Responses ────────────────────────────

export function sendError(
  res: Response,
  message: string,
  statusCode = 400,
  errors?: Record<string, string[]> | null
): Response {
  const response: ApiResponse = {
    success: false,
    message,
    ...(errors && { errors }),
  };
  return res.status(statusCode).json(response);
}

export function sendUnauthorized(
  res: Response,
  message = "Unauthorised — please log in"
): Response {
  return sendError(res, message, 401);
}

export function sendForbidden(
  res: Response,
  message = "Forbidden — you don't have permission"
): Response {
  return sendError(res, message, 403);
}

export function sendNotFound(
  res: Response,
  message = "Resource not found"
): Response {
  return sendError(res, message, 404);
}

export function sendConflict(
  res: Response,
  message = "Resource already exists"
): Response {
  return sendError(res, message, 409);
}

export function sendServerError(
  res: Response,
  message = "Internal server error"
): Response {
  return sendError(res, message, 500);
}

export function sendValidationError(
  res: Response,
  errors: Record<string, string[]>
): Response {
  return sendError(res, "Validation failed", 422, errors);
}
