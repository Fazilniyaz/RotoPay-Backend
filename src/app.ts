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

// ─────────────────────────────────────────────

const app: Application = express();

// ── Security Headers ───────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────
app.use(
  cors({
    origin
        : [env.CLIENT_URL, "http://localhost:8081", "http://192.168.0.102:8081", "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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
