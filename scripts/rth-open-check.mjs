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
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";
import { isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";

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

/** Weekday 09:00–16:15 ET — agent validation window (pre-open warm-up + 15m post-close cron grace). NOT the same as US equity RTH (9:30 AM–4:00 PM ET). */
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
    const tradingDay = isTradingDayEt(todayEtYmd(now));
    console.log("\n2. RTH session checks");
    if (!tradingDay) {
      console.log(
        `  ⚠ ${todayEtYmd(now)} is not a US equity trading session (market holiday) — skipping writer/regime freshness checks`
      );
    }
    const dbUrl = resolveAuditDbUrl();

    const failures = [];
    const ok = (m) => console.log(`  ✓ ${m}`);
    const fail = (m) => {
      failures.push(m);
      console.log(`  ✗ ${m}`);
    };
    if (dbUrl) {
      try {
        const c = createAuditClient(dbUrl);
        await c.connect();

        if (tradingDay) {
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
        }

        const dc = await c.query(
          `SELECT status, message FROM cron_job_runs WHERE job_key = 'data-correctness' ORDER BY started_at DESC LIMIT 1`
        );
        const latest = dc.rows[0];
        if (latest?.status === "ok") ok("data-correctness latest run ok");
        else fail(`data-correctness latest: ${latest?.status ?? "?"} — ${latest?.message ?? ""}`);

        const ph = await c.query(
          `SELECT status, started_at FROM cron_job_runs
           WHERE job_key = 'provider-health-reconcile'
           ORDER BY started_at DESC LIMIT 1`
        );
        const phRow = ph.rows[0];
        if (phRow?.status === "ok" || phRow?.status === "skipped") {
          ok(`provider-health-reconcile latest ${phRow.status}`);
        } else {
          fail(`provider-health-reconcile latest: ${phRow?.status ?? "never"}`);
        }

        if (tradingDay) {
          const grid15 = (
            await c.query(
              `SELECT COUNT(*)::int AS n FROM cron_job_runs
               WHERE job_key = 'zerodte-warm' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
            )
          ).rows[0].n;
          if (grid15 > 0) ok(`zerodte-warm ran in last 20m (${grid15} ok run(s))`);
          else fail("zerodte-warm: no ok run in last 20m during RTH");
        }

        await c.end();
      } catch (e) {
        fail(`Postgres RTH checks: ${e.message}`);
      }
    } else {
      console.log("  ⚠ DATABASE_URL not set — skipping Postgres RTH checks");
    }

    // Options socket — HTTP probe (reliable across multi-replica clusters; log grep misses the leader).
    const cron = process.env.CRON_SECRET?.trim() ?? "";
    if (cron) {
      try {
        const base = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
        const res = await fetch(`${base}/api/cron/socket-health`, {
          headers: { Authorization: `Bearer ${cron}` },
        });
        const body = await res.json();
        const opt = body.websockets?.options;
        if (res.status === 200 && opt) {
          if (opt.ok) ok(`options-socket: ${opt.detail}`);
          else if (et.mins >= 9 * 60 + 30) fail(`options-socket: ${opt.detail}`);
          else console.log(`  ⚠ options-socket: pre-09:30 — ${opt.detail}`);
        } else {
          fail(`options-socket probe HTTP ${res.status}`);
        }
      } catch (e) {
        fail(`options-socket probe failed: ${e.message}`);
      }
    } else {
      console.log("  ⚠ CRON_SECRET unset — skipping options-socket HTTP probe");
    }

    try {
      const logs = execSync(
        "railway logs --service blackout-web 2>/dev/null | rg 'uw-socket' | tail -20",
        { encoding: "utf8" }
      );
      if (/uw-socket.*stall watchdog/i.test(logs)) fail("uw-socket stall reconnects in recent logs");
      else ok("No uw-socket stall storms");
    } catch {
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log("  ⚠ CloudWatch uw-socket log check skipped in GitHub Actions");
      } else {
        console.log("  ⚠ Could not read CloudWatch logs for uw-socket");
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
