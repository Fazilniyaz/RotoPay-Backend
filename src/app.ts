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

// ─────────────────────────────────────────────

const app: Application = express();

// ── Security Headers ───────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Body Parser ────────────────────────────────
app.use(express.json({ limit: "10kb" })); // Limit body size
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

// Future routes will be added here:
// app.use("/api/users", userRouter);
// app.use("/api/employers", employerRouter);
// app.use("/api/shifts", shiftRouter);
// app.use("/api/clock", clockRouter);
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
