#!/usr/bin/env node
/**
 * RTH-open validation — run autonomously at market open (no user prompt).
 *
 * Usage:
 *   npm run validate:rth-open
 *   node scripts/rth-open-check.mjs --force   # run even off-hours
 *
 * Cloud agents: run this at the start of any weekday session when ET >= 09:00,
 * or within 30 minutes after 09:30 open. Do NOT wait for the user to ask.
 */

import { execSync, spawnSync } from "node:child_process";

const ET = "America/New_York";
const force = process.argv.includes("--force");

function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday: parts.weekday,
    mins: hour * 60 + minute,
    label: `${parts.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
  };
}

/** Weekday 09:00–16:15 ET (open window + 15m grace after close for crons). */
function inRthOpenWindow(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 && mins <= 16 * 60 + 15;
}

/** Weekday 09:00+ (agent should resume work — includes pre-open warm-up). */
function shouldAgentRun(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60;
}

async function main() {
  const now = new Date();
  const et = etParts(now);

  console.log(`\n=== BlackOut RTH-open check ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})\n`);

  if (!force && !shouldAgentRun(now)) {
    console.log("Off-hours / weekend — skipping RTH-open checks (use --force to override).\n");
    return;
  }

  if (!force && !inRthOpenWindow(now)) {
    console.log("Pre-open warm-up window — running deploy validation only (full RTH checks after 09:30 ET).\n");
  }

  console.log("1. Post-deploy validation");
  const deploy = spawnSync("node", ["scripts/validate-deploy.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
  if (deploy.status !== 0) {
    console.error("\nRTH-open FAILED — validate:deploy did not pass.\n");
    process.exit(1);
  }

  if (force || inRthOpenWindow(now)) {
    console.log("\n2. RTH session checks");
    let dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      try {
        const vars = JSON.parse(
          execSync("railway variables --service blackout-web --json 2>/dev/null", { encoding: "utf8" })
        );
        dbUrl = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
      } catch {
        /* optional */
      }
    }

    const failures = [];
    const ok = (m) => console.log(`  ✓ ${m}`);
    const fail = (m) => {
      failures.push(m);
      console.log(`  ✗ ${m}`);
    };
    let openPos = 0;
    let nw15 = 0;

    if (dbUrl) {
      try {
        const pg = await import("pg");
        const c = new pg.default.Client({
          connectionString: dbUrl,
          ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
        });
        await c.connect();

        const eval15 = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM cron_job_runs
             WHERE job_key = 'spx-evaluate' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
          )
        ).rows[0].n;
        if (eval15 > 0) ok(`spx-evaluate ran in last 20m (${eval15} ok run(s))`);
        else fail("spx-evaluate: no ok run in last 20m during RTH");

        const regime15 = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '20 minutes'`
          )
        ).rows[0].n;
        if (regime15 > 0) ok(`market_regime fresh (writes last 20m: ${regime15})`);
        else fail("market_regime: no writes in last 20m during RTH");

        const dc = await c.query(
          `SELECT status, message FROM cron_job_runs WHERE job_key = 'data-correctness' ORDER BY started_at DESC LIMIT 1`
        );
        const latest = dc.rows[0];
        if (latest?.status === "ok") ok("data-correctness latest run ok");
        else fail(`data-correctness latest: ${latest?.status ?? "?"} — ${latest?.message ?? ""}`);

        const grid15 = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM cron_job_runs
             WHERE job_key = 'grid-warm' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
          )
        ).rows[0].n;
        if (grid15 > 0) ok(`grid-warm ran in last 20m (${grid15} ok run(s))`);
        else fail("grid-warm: no ok run in last 20m during RTH");

        const nw15Row = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM cron_job_runs
             WHERE job_key = 'nights-watch-warm' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
          )
        ).rows[0].n;
        nw15 = nw15Row;
        openPos = (
          await c.query(`SELECT COUNT(*)::int AS n FROM user_positions WHERE status = 'open'`)
        ).rows[0].n;

        await c.end();
      } catch (e) {
        fail(`Postgres RTH checks: ${e.message}`);
      }
    } else {
      console.log("  ⚠ DATABASE_URL not set — skipping Postgres RTH checks");
    }

    try {
      const logs = execSync(
        "railway logs --service blackout-web 2>/dev/null | rg 'options-socket|uw-socket' | tail -20",
        { encoding: "utf8" }
      );
      const optAuth = /options-socket.*authenticated/.test(logs);
      if (optAuth) ok("options-socket authenticated in recent logs");
      else if (et.mins < 9 * 60 + 30) {
        console.log("  ⚠ options-socket: pre-09:30 — auth line not required yet");
      } else if (openPos === 0) {
        ok("options-socket idle (no open positions — WS auth not required)");
      } else if (nw15 > 0) {
        ok(`options path live (nights-watch-warm ok ×${nw15} in last 20m; log auth line optional on multi-replica)`);
      } else if (et.mins >= 9 * 60 + 30) {
        fail("options-socket: no auth logs and nights-watch-warm stale during RTH with open positions");
      }
      if (/uw-socket.*stall watchdog/i.test(logs)) fail("uw-socket stall reconnects in recent logs");
      else ok("No uw-socket stall storms");
    } catch {
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log("  ⚠ Railway logs skipped in GitHub Actions");
        if (et.mins >= 9 * 60 + 30 && openPos > 0 && nw15 > 0) {
          ok(`options path live (nights-watch-warm ok ×${nw15} in last 20m; logs skipped in GHA)`);
        } else if (et.mins >= 9 * 60 + 30 && openPos === 0) {
          ok("options-socket idle (no open positions)");
        }
      } else if (et.mins >= 9 * 60 + 30 && openPos > 0 && nw15 > 0) {
        ok(`options path live (nights-watch-warm ok ×${nw15} in last 20m; Railway logs unavailable)`);
      } else if (et.mins >= 9 * 60 + 30 && openPos === 0) {
        ok("options-socket idle (no open positions)");
      } else {
        console.log("  ⚠ Could not read Railway logs");
      }
    }

    if (failures.length) {
      console.error(`\nRTH-open FAILED (${failures.length}):`);
      failures.forEach((f) => console.error(`  · ${f}`));
      process.exit(1);
    }
  }

  console.log("\nGREEN — RTH-open validation passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
