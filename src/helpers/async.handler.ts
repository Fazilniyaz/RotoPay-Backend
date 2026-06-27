// src/helpers/async.handler.ts
// ─────────────────────────────────────────────
// Async Handler Wrapper
// Eliminates try/catch boilerplate in controllers.
// Any unhandled promise rejection is forwarded to Express error handler.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

export function asyncHandler(fn: AsyncController): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
