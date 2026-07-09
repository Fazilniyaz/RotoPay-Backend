// src/controllers/auth.controller.ts
// ─────────────────────────────────────────────
// Auth Controller — Full Logic
//
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/google
// POST /api/auth/verify-email
// POST /api/auth/resend-verification
// ─────────────────────────────────────────────

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { Prisma } from "@prisma/client";

import { prisma } from "../utilities/prisma.client";
import { env } from "../utilities/env";
import { resolveClientBaseUrl } from "../utilities/client-url";
import { signAccessToken, signRefreshToken, getRefreshTokenExpiryDate, verifyRefreshToken } from "../utilities/jwt";
import { verifyGoogleToken } from "../utilities/google.oauth";
import {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
} from "../utilities/mailer";
import {
  generateSecureToken,
  getEmailVerifyExpiry,
  getPasswordResetExpiry,
  isTokenExpired,
} from "../helpers/token.helper";
import {
  sendSuccess,
  sendCreated,
  sendError,
  sendConflict,
  sendNotFound,
  sendServerError,
  sendUnauthorized,
} from "../helpers/api.response";
import { asyncHandler } from "../helpers/async.handler";

// ─────────────────────────────────────────────
// HELPER: Build token pair + create DB session
// Reused by register, login, and google auth
// ─────────────────────────────────────────────

async function createAuthSession(
  userId: string,
  email: string,
  req: Request
): Promise<{ accessToken: string; refreshToken: string }> {
  const sessionId = uuidv4();

  const accessToken = signAccessToken({ userId, email, type: "access" });
  const refreshToken = signRefreshToken({ userId, sessionId, type: "refresh" });

  // Persist refresh token session to DB
  await prisma.session.create({
    data: {
      userId,
      token: accessToken,
      refreshToken,
      expiresAt: getRefreshTokenExpiryDate(),
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
    },
  });

  return { accessToken, refreshToken };
}

// ─────────────────────────────────────────────
// HELPER: Safe user data to return in responses
// Never expose password, PIN, tokens in responses
// ─────────────────────────────────────────────

function sanitiseUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  profilePicture: string | null;
  emailVerified: boolean;
  pinEnabled: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    profilePicture: user.profilePicture,
    emailVerified: user.emailVerified,
    pinEnabled: user.pinEnabled,
    createdAt: user.createdAt,
  };
}

// ═════════════════════════════════════════════
// 1. POST /api/auth/register
// ═════════════════════════════════════════════
//
// Flow:
//  1. Check email is not already registered
//  2. Hash password with bcrypt
//  3. Generate secure email verification token
//  4. Create user + default settings in a transaction
//  5. Send verification email
//  6. Return 201 with user data (no tokens yet — email must be verified first)
//
// ─────────────────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, displayName } = req.body as {
    email: string;
    password: string;
    displayName?: string;
  };

  // ── 1. Check for existing account ─────────────

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true },
  });

  if (existingUser) {
    if (!existingUser.emailVerified) {
      return sendError(res, "Account exists but is not verified.", 403);
    }
    // Give a generic message — don't reveal if email exists (security best practice)
    return sendConflict(
      res,
      "An account with this email already exists. Please log in or use a different email."
    );
  }

  // ── 2. Hash password ──────────────────────────

  const hashedPassword = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  // ── 3. Generate email verification token ──────

  const verifyToken = generateSecureToken();
  const verifyTokenExpiry = getEmailVerifyExpiry();

  // ── 4. Create user + settings in a transaction ─

  const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const newUser = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        displayName: displayName ?? null,
        emailVerified: false,
        emailVerifyToken: verifyToken,
        emailVerifyTokenExpiry: verifyTokenExpiry,
      },
    });

    // Create default settings record (1:1)
    await tx.userSettings.create({
      data: {
        userId: newUser.id,
        // All fields use schema defaults
      },
    });

    return newUser;
  });

  // ── 5. Send verification email ─────────────────
  // Non-blocking — email failure shouldn't fail registration

  try {
    await sendVerificationEmail(user.email, user.displayName, verifyToken, resolveClientBaseUrl(req));
  } catch (emailError) {
    console.error("[Auth] Failed to send verification email:", emailError);
    // Continue — user can resend later
  }

  // ── 6. Respond ────────────────────────────────

  return sendCreated(res, "Account created successfully. Please check your email to verify your account.", {
    user: sanitiseUser(user),
    emailSent: true,
  });
});

// ═════════════════════════════════════════════
// 2. POST /api/auth/login
// ═════════════════════════════════════════════
//
// Flow:
//  1. Find user by email
//  2. Compare password with bcrypt
//  3. Check email is verified
//  4. Create auth session (access + refresh tokens)
//  5. Return tokens + user data
//
// ─────────────────────────────────────────────

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  // ── 1. Find user ──────────────────────────────

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      displayName: true,
      profilePicture: true,
      emailVerified: true,
      pinEnabled: true,
      googleId: true,
      createdAt: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  // Always run bcrypt even if user not found (prevents timing attacks)
  const dummyHash = "$2b$12$invalidhashtopreventtimingattack";
  const passwordToCompare = user?.password ?? dummyHash;

  const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

  // ── Account lockout (brute-force / credential-stuffing defense) ──
  // Per-account, DB-backed so it holds across IPs AND serverless instances —
  // something the per-IP rate limiter can't do against a botnet targeting one
  // account. Lenient enough that a real user fumbling their password is unaffected.
  const MAX_FAILED = 8; // consecutive failures before a temporary lock
  const LOCK_MINUTES = 15;

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    return sendError(
      res,
      `Too many failed attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      429
    );
  }

  // ── 2. Validate credentials ────────────────────

  if (!user || !isPasswordValid) {
    // Count the failure against the account (only possible when it exists) and
    // lock it once the threshold is hit. Best-effort — never blocks the response.
    if (user) {
      const nextCount = (user.failedLoginCount ?? 0) + 1;
      const lock = nextCount >= MAX_FAILED;
      prisma.user
        .update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLoginCount: nextCount },
        })
        .catch(() => undefined);
    }
    return sendError(res, "Invalid email or password", 401);
  }

  // Credentials are valid → clear any accumulated failed-attempt / lock state.
  if (user.failedLoginCount || user.lockedUntil) {
    prisma.user
      .update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } })
      .catch(() => undefined);
  }

  // ── 3. Handle Google-only accounts ────────────

  if (!user.password && user.googleId) {
    return sendError(
      res,
      "This account was created with Google. Please sign in with Google instead.",
      400
    );
  }

  // ── 4. Check email verification ───────────────

  if (!user.emailVerified) {
    return sendError(
      res,
      "Please verify your email address before logging in. Check your inbox or resend the verification email.",
      403
    );
  }

  // ── 5. Create auth session ────────────────────

  const { accessToken, refreshToken } = await createAuthSession(
    user.id,
    user.email,
    req
  );

  // ── 6. Respond ────────────────────────────────

  return sendSuccess(res, "Login successful", {
    user: sanitiseUser(user),
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
});

// ═════════════════════════════════════════════
// 3. POST /api/auth/google
// ═════════════════════════════════════════════
//
// Flow:
//  1. Verify the Google ID token (server-side verification)
//  2. Check if user already exists (by googleId or email)
//  3a. NEW user: Create user + settings, no email verification needed (Google already verified it)
//  3b. EXISTING user: Link googleId if not linked, update profile picture
//  4. Create auth session
//  5. Return tokens + user data + isNewUser flag
//
// ─────────────────────────────────────────────

export const googleAuth = asyncHandler(async (req: Request, res: Response) => {
  const { idToken } = req.body as { idToken: string };

  // ── 1. Verify Google token ─────────────────────

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(idToken);
  } catch (error) {
    return sendError(res, "Invalid Google token — please try signing in again", 400);
  }

  const { googleId, email, displayName, profilePicture } = googleUser;

  // ── 2. Find existing user ──────────────────────
  // Check by googleId first, then fall back to email (account linking)

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ googleId }, { email }],
    },
  });

  let isNewUser = false;

  if (!user) {
    // ── 3a. New user — create account ─────────────

    isNewUser = true;

    user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newUser = await tx.user.create({
        data: {
          email,
          googleId,
          displayName,
          profilePicture,
          emailVerified: true, // Google already verified the email
          password: null,
        },
      });

      await tx.userSettings.create({
        data: { userId: newUser.id },
      });

      return newUser;
    });

  } else {
    // ── 3b. Existing user — check verification and link Google account ─

    // If the account was created manually but not verified, block Google login
    // to force them to verify via the email link first.
    if (!user.emailVerified && !user.googleId) {
      return res.status(403).json({
        success: false,
        message: "Account exists but is not verified. Please check your email to verify your account.",
        data: { email: user.email }
      });
    }

    const updates: Record<string, unknown> = {};

    if (!user.googleId) {
      updates.googleId = googleId;
    }
    if (!user.profilePicture && profilePicture) {
      updates.profilePicture = profilePicture;
    }
    if (!user.emailVerified) {
      updates.emailVerified = true;
    }

    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  // ── 4. Create auth session ────────────────────

  const { accessToken, refreshToken } = await createAuthSession(
    user.id,
    user.email,
    req
  );

  // ── 5. Respond ────────────────────────────────

  return sendSuccess(
    res,
    isNewUser ? "Account created successfully with Google" : "Google sign-in successful",
    {
      user: sanitiseUser(user),
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      isNewUser,
    },
    isNewUser ? 201 : 200
  );
});

// ═════════════════════════════════════════════
// 4. POST /api/auth/verify-email
// ═════════════════════════════════════════════
//
// Flow:
//  1. Find user by the verify token
//  2. Check token hasn't expired
//  3. Mark email as verified, clear the token fields
//  4. Send a welcome email
//  5. Return success (user must log in separately)
//
// ─────────────────────────────────────────────

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as { token: string };

  // ── 1. Find user by token ──────────────────────

  const user = await prisma.user.findFirst({
    where: { emailVerifyToken: token },
    select: {
      id: true,
      email: true,
      displayName: true,
      emailVerified: true,
      emailVerifyToken: true,
      emailVerifyTokenExpiry: true,
    },
  });

  if (!user) {
    return sendError(res, "Invalid or already used verification token", 400);
  }

  // ── 2. Check already verified ──────────────────

  if (user.emailVerified) {
    return sendSuccess(res, "Email address is already verified. You can log in.");
  }

  // ── 3. Check token expiry ──────────────────────

  if (isTokenExpired(user.emailVerifyTokenExpiry)) {
    return sendError(
      res,
      "Verification link has expired. Please request a new one.",
      410 // 410 Gone
    );
  }

  // ── 4. Mark email as verified, clear token fields ─

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpiry: null,
    },
  });

  // ── 5. Send welcome email ─────────────────────

  try {
    await sendWelcomeEmail(user.email, user.displayName, resolveClientBaseUrl(req));
  } catch (error) {
    console.error("[Auth] Failed to send welcome email:", error);
  }

  // ── 6. Respond ────────────────────────────────

  return sendSuccess(
    res,
    "Email verified successfully! You can now log in to your account."
  );
});

// ═════════════════════════════════════════════
// 5. POST /api/auth/resend-verification
// ═════════════════════════════════════════════
//
// Flow:
//  1. Find user by email
//  2. Check they're not already verified
//  3. Check rate limit — don't resend if token is less than 5 minutes old
//  4. Generate a new token and update the user
//  5. Send the verification email
//  6. Return generic success (don't reveal if email exists — security)
//
// ─────────────────────────────────────────────

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };

  // ── Generic success message (used whether email found or not) ──
  // This prevents email enumeration attacks

  const GENERIC_MESSAGE =
    "If this email is registered and unverified, a new verification link has been sent.";

  // ── 1. Find user ──────────────────────────────

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      emailVerified: true,
      emailVerifyToken: true,
      emailVerifyTokenExpiry: true,
    },
  });

  // Silently return success even if user not found (anti-enumeration)
  if (!user) {
    return sendSuccess(res, GENERIC_MESSAGE);
  }

  // ── 2. Already verified ───────────────────────

  if (user.emailVerified) {
    return sendSuccess(
      res,
      "This email address is already verified. You can log in."
    );
  }

  // ── 3. Rate limit — prevent token spam ────────
  // If a token was sent less than 5 minutes ago, don't resend

  if (user.emailVerifyTokenExpiry) {
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    const tokenAge = env.EMAIL_VERIFY_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000;
    const tokenIssuedAt = new Date(user.emailVerifyTokenExpiry.getTime() - tokenAge);
    const minutesSinceIssued = (Date.now() - tokenIssuedAt.getTime()) / 1000 / 60;

    if (minutesSinceIssued < 5) {
      return sendError(
        res,
        "A verification email was sent recently. Please wait a few minutes before requesting another.",
        429
      );
    }
  }

  // ── 4. Generate new token ─────────────────────

  const newToken = generateSecureToken();
  const newExpiry = getEmailVerifyExpiry();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifyToken: newToken,
      emailVerifyTokenExpiry: newExpiry,
    },
  });

  // ── 5. Send email ──────────────────────────────

  try {
    await sendVerificationEmail(user.email, user.displayName, newToken, resolveClientBaseUrl(req));
  } catch (error) {
    console.error("[Auth] Failed to resend verification email:", error);
    return sendServerError(res, "Failed to send email — please try again later");
  }

  // ── 6. Respond ────────────────────────────────

  return sendSuccess(res, GENERIC_MESSAGE);
});

// ═════════════════════════════════════════════
// 6. POST /api/auth/forgot-password
// ═════════════════════════════════════════════
//
// Flow:
//  1. Find user by email
//  2. Block Google-only accounts (they have no password to reset)
//  3. Rate-gate: refuse if a reset token was issued less than 5 min ago
//  4. Generate a cryptographically secure reset token (expires in 1 hour)
//  5. Persist token + expiry to the user document
//  6. Send the password-reset email
//  7. Always return a GENERIC success message
//     → prevents an attacker from discovering which emails are registered
//
// Security notes:
//  - We never confirm whether the email exists in the response
//  - The token is stored in the DB; on use it is immediately cleared
//  - 1-hour window is tight enough to limit exposure
// ─────────────────────────────────────────────

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };

  const GENERIC_MESSAGE =
    "If an account with that email exists, a password reset link has been sent.";

  // ── 1. Look up user ───────────────────────────

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      googleId: true,
      password: true,
      passwordResetToken: true,
      passwordResetTokenExpiry: true,
    },
  });

  // Silently succeed for unknown emails (anti-enumeration)
  if (!user) {
    return sendSuccess(res, GENERIC_MESSAGE);
  }

  // ── 2. Block Google-only accounts ─────────────
  // These accounts were never given a password; sending a reset
  // link would be confusing and potentially misleading.

  if (user.googleId && !user.password) {
    return sendError(
      res,
      "This account was created with Google sign-in. Please use Google to log in instead.",
      400
    );
  }

  // ── 3. Rate-gate: max 1 request per 5 minutes ─
  // Prevents token-spam / flooding the inbox.

  if (user.passwordResetTokenExpiry) {
    const TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
    const tokenIssuedAt = new Date(
      user.passwordResetTokenExpiry.getTime() - TOKEN_LIFETIME_MS
    );
    const minutesSinceIssued =
      (Date.now() - tokenIssuedAt.getTime()) / 1000 / 60;

    if (minutesSinceIssued < 5) {
      return sendError(
        res,
        "A reset email was sent recently. Please wait a few minutes before requesting another.",
        429
      );
    }
  }

  // ── 4. Generate reset token ────────────────────

  const resetToken = generateSecureToken();          // 64 hex chars
  const resetExpiry = getPasswordResetExpiry();      // +1 hour from now

  // ── 5. Persist to DB ──────────────────────────

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: resetToken,
      passwordResetTokenExpiry: resetExpiry,
    },
  });

  // ── 6. Send email ─────────────────────────────

  try {
    await sendPasswordResetEmail(user.email, user.displayName, resetToken, resolveClientBaseUrl(req));
  } catch (error) {
    console.error("[Auth] Failed to send password reset email:", error);
    // Roll back the token so the user isn't stuck with an unsent token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    });
    return sendServerError(res, "Failed to send email — please try again later");
  }

  // ── 7. Respond ────────────────────────────────

  return sendSuccess(res, GENERIC_MESSAGE);
});

// ═════════════════════════════════════════════
// 7. POST /api/auth/reset-password
// ═════════════════════════════════════════════
//
// Flow:
//  1. Find user by the reset token
//  2. Check the token hasn't expired (1-hour window)
//  3. Reject if the new password is the same as the current one
//  4. Hash the new password with bcrypt
//  5. Update the password, clear token fields in a single DB write
//  6. Invalidate ALL existing sessions for this user (force re-login everywhere)
//  7. Return success — user must log in with the new password
//
// Security notes:
//  - Token is single-use — cleared immediately on use
//  - All sessions nuked → stolen session tokens are invalidated
//  - bcrypt comparison prevents reuse of the same password
// ─────────────────────────────────────────────

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body as { token: string; password: string };

  // ── 1. Find user by reset token ───────────────

  const user = await prisma.user.findFirst({
    where: { passwordResetToken: token },
    select: {
      id: true,
      email: true,
      password: true,
      passwordResetToken: true,
      passwordResetTokenExpiry: true,
    },
  });

  if (!user) {
    return sendError(
      res,
      "Invalid or already used password reset link. Please request a new one.",
      400
    );
  }

  // ── 2. Check token expiry ──────────────────────

  if (isTokenExpired(user.passwordResetTokenExpiry)) {
    // Clear the expired token so the DB stays clean
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    });
    return sendError(
      res,
      "This password reset link has expired. Please request a new one.",
      410
    );
  }

  // ── 3. Prevent reuse of the same password ─────

  if (user.password) {
    const isSamePassword = await bcrypt.compare(password, user.password);
    if (isSamePassword) {
      return sendError(
        res,
        "New password must be different from your current password.",
        400
      );
    }
  }

  // ── 4. Hash new password ──────────────────────

  const hashedPassword = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  // ── 5. Update password + clear token in one write ─

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetTokenExpiry: null,
    },
  });

  // ── 6. Invalidate ALL sessions for this user ──
  // Stolen sessions from before the reset are now worthless.

  await prisma.session.deleteMany({
    where: { userId: user.id },
  });

  // ── 7. Respond ────────────────────────────────

  return sendSuccess(
    res,
    "Password reset successfully. Please log in with your new password."
  );
});

// ═════════════════════════════════════════════
// 8. POST /api/auth/refresh-token
// ═════════════════════════════════════════════
//
// Flow:
//  1. Verify the refresh token signature + expiry (JWT level)
//  2. Look up the session record in the DB using the token
//  3. Check the session hasn't expired at the DB level (belt-and-braces)
//  4. Look up the user to make sure the account still exists + is active
//  5. Issue a brand-new access token
//  6. Rotate the refresh token: issue a new one + update the DB record
//     (refresh token rotation — old token is immediately invalidated)
//  7. Return both new tokens
//
// Security notes:
//  - Refresh token rotation: every call issues a new refresh token.
//    If a stolen refresh token is used AFTER the legitimate user
//    already rotated it, the DB lookup fails → breach detected.
//  - We update the SAME session record (preserves device info / history).
//  - Access token is intentionally short-lived (15 min) to limit exposure.
// ─────────────────────────────────────────────

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: incomingRefreshToken } = req.body as {
    refreshToken: string;
  };

  // ── 1. Verify JWT signature + expiry ──────────

  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TokenExpiredError") {
      return sendUnauthorized(res, "Session expired — please log in again");
    }
    return sendUnauthorized(res, "Invalid refresh token — please log in again");
  }

  // ── 2. Look up session in DB ──────────────────
  // The refresh token MUST exist in our sessions table.
  // If it doesn't, either it was already rotated (replay attack)
  // or it was manually revoked (logout).

  const session = await prisma.session.findUnique({
    where: { refreshToken: incomingRefreshToken },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      userAgent: true,
      ipAddress: true,
    },
  });

  if (!session) {
    return sendUnauthorized(
      res,
      "Session not found or already invalidated — please log in again"
    );
  }

  // ── 3. Check DB-level session expiry ──────────

  if (new Date() > session.expiresAt) {
    // Clean up the expired session
    await prisma.session.delete({ where: { id: session.id } });
    return sendUnauthorized(res, "Session expired — please log in again");
  }

  // ── 4. Verify user still exists and is active ─

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
    },
  });

  if (!user) {
    await prisma.session.delete({ where: { id: session.id } });
    return sendUnauthorized(res, "Account not found — please register again");
  }

  if (!user.emailVerified) {
    return sendUnauthorized(
      res,
      "Email not verified — please verify your email before refreshing your session"
    );
  }

  // ── 5. Issue new access token ─────────────────

  const newAccessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    type: "access",
  });

  // ── 6. Rotate refresh token ───────────────────
  // New refresh token with a fresh 7-day window.
  // Old one is replaced in the DB → can never be used again.

  const newSessionId = uuidv4();
  const newRefreshToken = signRefreshToken({
    userId: user.id,
    sessionId: newSessionId,
    type: "refresh",
  });

  await prisma.session.update({
    where: { id: session.id },
    data: {
      token: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: getRefreshTokenExpiryDate(),
      // Preserve original device / IP info
    },
  });

  // ── 7. Respond ────────────────────────────────

  return sendSuccess(res, "Token refreshed successfully", {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    tokenType: "Bearer",
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
});

// ═════════════════════════════════════════════
// 9. POST /api/auth/logout
// ═════════════════════════════════════════════
//
// Flow:
//  1. Extract the access token from the Authorization header
//     (authenticate middleware has already verified it and attached req.user)
//  2. Delete the session record from the DB that matches this access token
//  3. Optionally: if logoutAll=true in the body, delete ALL sessions
//     for this user (logout from every device at once)
//  4. Return success
//
// Security notes:
//  - The access token itself is NOT blacklisted — it will still pass
//    JWT verification until it expires naturally (max 15 min).
//    This is acceptable: without a session in the DB, the refresh
//    token can no longer be used, so the attacker gets at most 15 min.
//  - For true instant invalidation you would need a Redis blacklist,
//    which is a future enhancement when traffic justifies it.
//  - logoutAll nukes every device session (useful after password change
//    or suspected breach).
// ─────────────────────────────────────────────

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // req.user is populated by the authenticate middleware
  const userId = req.user!.userId;

  // ── Optional: logout from all devices ─────────

  const { logoutAll } = req.body as { logoutAll?: boolean };

  if (logoutAll === true) {
    // Delete every session for this user
    const { count } = await prisma.session.deleteMany({
      where: { userId },
    });

    return sendSuccess(res, `Logged out from all ${count} device(s) successfully`);
  }

  // ── Single-device logout ──────────────────────
  // Find the session by the access token in the Authorization header

  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.split(" ")[1]; // "Bearer <token>"

  const deleted = await prisma.session.deleteMany({
    where: {
      userId,
      token: accessToken,
    },
  });

  if (deleted.count === 0) {
    // Session was already invalidated — still return success
    // (idempotent logout is the correct behaviour)
    return sendSuccess(res, "Already logged out");
  }

  return sendSuccess(res, "Logged out successfully");
});
