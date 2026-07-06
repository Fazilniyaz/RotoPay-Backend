// src/app.ts
// ─────────────────────────────────────────────
// Express App Configuration
// Middleware stack, routes, and error handling
// ─────────────────────────────────────────────

import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { env } from "./utilities/env";
import { apiLimiter } from "./middlewares/rate.limiter";
import { attestationGuard } from "./middlewares/attestation.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";

// ── Import Routers ─────────────────────────────
import authRouter from "./routes/auth.router";
import employerRouter from "./routes/employer.router";
import shiftRouter from "./routes/shift.router";
import salaryRouter from "./routes/salary.router";
import clockRouter from "./routes/clock.router";
import calendarRouter from "./routes/calendar.router";
import settingsRouter from "./routes/settings.router";
import paymentRouter from "./routes/payment.router";
import currencyRouter from "./routes/currency.router";
import notificationRouter from "./routes/notification.router";
import reportRouter from "./routes/report.router";
import attestationRouter from "./routes/attestation.router";

// ─────────────────────────────────────────────

const app: Application = express();

// ── Trust the reverse proxy (GCP HTTPS Load Balancer / Cloud Armor) ──────────
// Behind the load balancer every request's connection IP is the LB's, and the
// caller's real IP arrives in the X-Forwarded-For header. Trusting the exact
// number of proxy hops restores the real client IP on `req.ip`, so the rate
// limiter, morgan logs and any IP-based logic act on the actual caller. We set a
// NUMBER (not `true`) so only our own LB's hop is trusted — a spoofed
// X-Forwarded-For from further upstream is ignored. See env.TRUST_PROXY.
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

// ── Security Headers ───────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────
app.use(
  cors({
    origin
        : [env.CLIENT_URL, "http://localhost:8081", "http://192.168.0.102:8081", "http://localhost:3000", "https://roto-pay-admin-web-app.vercel.app"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Client"],
  })
);

// ── Body Parser ────────────────────────────────
// Keep a tight 10kb cap globally, but skip the profile-picture route so its
// own route-scoped parser can accept the larger base64 image payload.
const jsonParser = express.json({ limit: "10kb" });
app.use((req, res, next) => {
  if (req.path === "/api/settings/profile-picture") return next();
  return jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ── Request Logger ─────────────────────────────
if (env.NODE_ENV !== "test") {
  app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
}

// ── Global Rate Limiter ────────────────────────
app.use("/api", apiLimiter);

// ── App Attestation guard ──────────────────────
// Zero-trust: when enforced, mobile binaries must prove they're genuine (via the
// attestation handshake) before any /api route is served. No-op until
// ATTESTATION_ENFORCED=true; self-skips the handshake + web clients.
app.use("/api", attestationGuard);

// ── Health Check ──────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "RotaPay API is running",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ─────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/employers", employerRouter);
app.use("/api/shifts", shiftRouter);
app.use("/api/salaries", salaryRouter);
app.use("/api/clock", clockRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/currency", currencyRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/attestation", attestationRouter);

// Future routes will be added here:
// app.use("/api/users", userRouter);
// app.use("/api/events", eventRouter);
// app.use("/api/notifications", notificationRouter);
// app.use("/api/dashboard", dashboardRouter);
// app.use("/api/reports", reportRouter);
// app.use("/api/search", searchRouter);
// app.use("/api/settings", settingsRouter);

// ── 404 Handler ────────────────────────────────
app.use(notFoundHandler);

// ── Global Error Handler ───────────────────────
// Must be last — 4 params signals Express it's the error handler
app.use(errorHandler);

export default app;
