// src/server.ts
// ─────────────────────────────────────────────
// Server Entry Point
// Starts the HTTP server, connects DB, verifies mailer
// ─────────────────────────────────────────────

import { env } from "./utilities/env";
import { prisma } from "./utilities/prisma.client";
import { verifyMailerConnection } from "./utilities/mailer";
import { startScheduler } from "./services/scheduler.service";
import { initMongoRateStore } from "./middlewares/mongo.rate.store";
import app from "./app";

async function startServer(): Promise<void> {
  try {
    // ── 1. Test Database Connection ──────────────
    console.log(" [Server] Connecting to MongoDB...");
    await prisma.$connect();
    console.log(" [Server] MongoDB connected");

    // ── 2. Verify Mailer ──────────────────────────
    await verifyMailerConnection();

    // ── 3. Start background scheduler (auto clock-in/out, reminders) ──
    startScheduler();

    // ── 3b. Ensure the rate-limit TTL index exists (auto-purges old windows) ──
    initMongoRateStore().then((ok) =>
      console.log(ok ? " [Server] Rate-limit store ready (MongoDB)" : " [Server] Rate-limit TTL index skipped")
    );

    // ── 4. Start Express ──────────────────────────
    const server = app.listen(env.PORT, () => {
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`🚀 RotaPay API running in ${env.NODE_ENV} mode`);
      console.log(`🌐 http://localhost:${env.PORT}`);
      console.log(`🏥 Health: http://localhost:${env.PORT}/health`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    });

    // ── 4. Graceful Shutdown ───────────────────────
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`\n⚠️  [Server] ${signal} received — shutting down gracefully`);
      server.close(async () => {
        await prisma.$disconnect();
        console.log("✅ [Server] MongoDB disconnected");
        console.log("👋 [Server] Server closed");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // ── 5. Unhandled Rejections ────────────────────
    process.on("unhandledRejection", (reason) => {
      console.error("🔥 [Server] Unhandled rejection:", reason);
      process.exit(1);
    });

    process.on("uncaughtException", (error) => {
      console.error("[Server] Uncaught exception:", error);
      process.exit(1);
    });

  } catch (error) {
    console.error("[Server] Failed to start:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
