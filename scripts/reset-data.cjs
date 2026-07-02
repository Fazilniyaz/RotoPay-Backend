// scripts/reset-data.cjs
// ─────────────────────────────────────────────
// Reset app data for local testing.
//
//   npm run reset-data          → clears app data, KEEPS users/settings/sessions
//                                 (you stay logged in) — the usual clean slate.
//   npm run reset-data -- --all → also deletes users, settings and sessions
//                                 (full wipe; you'll re-register).
//
// "App data" = everything that feeds hours/pay/calendar/notifications:
// clock sessions, calendar entries, salaries, shifts, employers, events,
// notifications, paid months and reports. Deleted child → parent to minimise
// Mongo relation work. This is irreversible.
// ─────────────────────────────────────────────

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const wipeAll = process.argv.includes("--all");

// Ordered so records are removed before the things they point at.
const appData = [
  ["clockSession", () => prisma.clockSession.deleteMany({})],
  ["calendarEntry", () => prisma.calendarEntry.deleteMany({})],
  ["salary", () => prisma.salary.deleteMany({})],
  ["shift", () => prisma.shift.deleteMany({})],
  ["employer", () => prisma.employer.deleteMany({})],
  ["event", () => prisma.event.deleteMany({})],
  ["notification", () => prisma.notification.deleteMany({})],
  ["paidMonth", () => prisma.paidMonth.deleteMany({})],
  ["report", () => prisma.report.deleteMany({})],
];

// Account data — only removed with --all.
const accountData = [
  ["session", () => prisma.session.deleteMany({})],
  ["userSettings", () => prisma.userSettings.deleteMany({})],
  ["user", () => prisma.user.deleteMany({})],
];

async function main() {
  const steps = wipeAll ? [...appData, ...accountData] : appData;

  console.log(
    wipeAll
      ? "Full wipe — deleting ALL collections (users included)…\n"
      : "Clearing app data (keeping users / settings / sessions)…\n"
  );

  for (const [name, run] of steps) {
    const { count } = await run();
    console.log(`  deleted ${String(count).padStart(5)}  ${name}`);
  }

  if (!wipeAll) {
    const kept = {
      users: await prisma.user.count(),
      userSettings: await prisma.userSettings.count(),
      sessions: await prisma.session.count(),
    };
    console.log("\nKept:", kept);
  }
  console.log("\nDone ✅");
}

main()
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
