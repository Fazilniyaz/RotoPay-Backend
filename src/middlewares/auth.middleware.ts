// src/middlewares/auth.middleware.ts
// ─────────────────────────────────────────────
// JWT Authentication Middleware
// Protects routes — attaches decoded user to req.user
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, DecodedToken } from "../utilities/jwt";
import { sendUnauthorized } from "../helpers/api.response";

// ── Extend Express Request Type ────────────────

declare global {
  namespace Express {
    interface Request {
      user?: DecodedToken;
    }
  }
}

// ── Authenticate Middleware ────────────────────

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendUnauthorized(res, "No token provided — please log in");
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === "TokenExpiredError") {
        sendUnauthorized(res, "Token expired — please refresh your session");
        return;
      }
      if (error.name === "JsonWebTokenError") {
        sendUnauthorized(res, "Invalid token — please log in again");
        return;
      }
    }
    sendUnauthorized(res, "Authentication failed");
  }
}
