#!/usr/bin/env node
/**
 * Staging RTH validation — AWS ECS staging only (no Railway log grep).
 *
 * Usage:
 *   npm run validate:staging-rth
 *   node scripts/staging-rth-check.mjs --force
 */
import { execSync, spawnSync } from "node:child_process";
import { createAuditClient } from "./pg-audit.mjs";
import { isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const ET = "America/New_York";
const force = process.argv.includes("--force");
const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

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

function inRthOpenWindow(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 && mins <= 16 * 60 + 15;
}

function shouldAgentRun(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60;
}

function loadStagingSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  console.log(`\n=== Staging RTH check ===`);
  console.log(`Target: ${BASE}`);
  console.log(`Time: ${now.toISOString()} (${et.label})\n`);

  if (!force && !shouldAgentRun(now)) {
    console.log("Off-hours / weekend — skipping (use --force).\n");
    return;
  }

  const secret = loadStagingSecret();
  const cron = secret.CRON_SECRET?.trim();
  if (!cron) {
    console.error("CRON_SECRET missing in staging secret");
    process.exit(1);
  }

  const env = {
    ...process.env,
    CRON_TARGET_BASE_URL: BASE,
    CRON_SECRET: cron,
    DATABASE_URL: secret.DATABASE_URL,
    DATABASE_PUBLIC_URL: secret.DATABASE_URL,
    SKIP_RAILWAY: "1",
    REPLICA_COUNT: secret.REPLICA_COUNT ?? "3",
    STAGING_CRON_WARM: "1",
  };

  console.log("1. Post-deploy validation (staging)");
  const deploy = spawnSync("node", ["scripts/validate-deploy.mjs"], {
    stdio: "inherit",
    env,
  });
  if (deploy.status !== 0) {
    console.error("\nStaging RTH FAILED — validate-deploy\n");
    process.exit(1);
  }

  if (!(force || inRthOpenWindow(now))) {
    console.log("\nPre-09:00 ET — deploy only; full session checks after open window.\n");
    return;
  }

  const failures = [];
  const ok = (m) => console.log(`  ✓ ${m}`);
  const fail = (m) => {
    failures.push(m);
    console.log(`  ✗ ${m}`);
  };

  console.log("\n2. RTH session checks (staging Postgres)");
  const tradingDay = isTradingDayEt(todayEtYmd(now));
  if (!tradingDay) {
    console.log(`  ⚠ ${todayEtYmd(now)} — not a US equity session; skipping writer freshness`);
  }

  const dbUrl = secret.DATABASE_URL?.trim();
  let pgOk = false;
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
        if (eval15 > 0) ok(`spx-evaluate ok in last 20m (${eval15})`);
        else fail("spx-evaluate: no ok run in last 20m");

        const flow15 = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM cron_job_runs
             WHERE job_key = 'flow-ingest' AND started_at > NOW() - INTERVAL '20 minutes' AND status IN ('ok','skipped')`
          )
        ).rows[0].n;
        if (flow15 > 0) ok(`flow-ingest ran in last 20m (${flow15})`);
        else fail("flow-ingest: no run in last 20m");

        const regime15 = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '20 minutes'`
          )
        ).rows[0].n;
        if (regime15 > 0) ok(`market_regime writes last 20m (${regime15})`);
        else fail("market_regime: no writes in last 20m");
      }

      const dc = await c.query(
        `SELECT status, message FROM cron_job_runs WHERE job_key = 'data-correctness' ORDER BY started_at DESC LIMIT 1`
      );
      const latest = dc.rows[0];
      if (latest?.status === "ok") ok("data-correctness latest ok");
      else fail(`data-correctness latest: ${latest?.status ?? "?"}`);

      await c.end();
      pgOk = true;
    } catch (e) {
      console.log(`  ⚠ Postgres unreachable from monitor host (${e.message}) — cron API fallback`);
    }
  } else {
    fail("DATABASE_URL missing in staging secret");
  }

  if (!pgOk) {
    try {
      const dcRes = await fetchRetry(
        `${BASE}/api/cron/data-correctness?force=1`,
        { headers: { Authorization: `Bearer ${cron}` } },
        { retries: 3, timeoutMs: 120_000 }
      );
      const dcBody = await dcRes.json();
      if (dcRes.status === 200 && (dcBody.flags?.length ?? 0) === 0) ok("data-correctness cron ok (VPC fallback)");
      else fail(`data-correctness cron: HTTP ${dcRes.status} flags=${dcBody.flags?.length ?? "?"}`);
    } catch (e) {
      fail(`data-correctness cron fallback: ${e.message}`);
    }

    if (tradingDay && et.mins >= 9 * 60 + 30) {
      try {
        const regimeRes = await fetchRetry(`${BASE}/api/market/regime`, {}, { retries: 2, timeoutMs: 30_000 });
        const regimeBody = await regimeRes.json();
        if (regimeRes.status === 200 && regimeBody.regime) ok(`market_regime live (VPC fallback: ${regimeBody.regime})`);
        else fail(`market_regime API: HTTP ${regimeRes.status}`);
      } catch (e) {
        fail(`market_regime API fallback: ${e.message}`);
      }
    } else if (tradingDay) {
      console.log("  ⚠ spx-evaluate / flow-ingest — check after 09:30 ET (VPC-only writers)");
    }
  }

  console.log("\n3. Live sockets + SPX play");
  try {
    const sh = await fetchRetry(
      `${BASE}/api/cron/socket-health`,
      { headers: { Authorization: `Bearer ${cron}` } },
      { retries: 4, baseDelayMs: 1500, timeoutMs: 90_000 }
    );
    const body = await sh.json();
    const opt = body.websockets?.options ?? body.options;
    if (sh.status === 200 && opt?.ok) ok(`options-socket: ${opt.detail ?? "ok"}`);
    else if (et.mins >= 9 * 60 + 30) fail(`options-socket: ${opt?.detail ?? sh.status}`);
    else console.log(`  ⚠ options-socket pre-09:30: ${opt?.detail ?? "pending"}`);
  } catch (e) {
    fail(`socket-health: ${e.message}`);
  }

  try {
    const play = await fetchRetry(
      `${BASE}/api/market/spx/play`,
      { headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" } },
      { retries: 3, timeoutMs: 60_000 }
    );
    const body = await play.json();
    if (play.status !== 200) fail(`spx/play HTTP ${play.status}`);
    else if (body.available && body.premium != null && body.premium !== "—") {
      ok(`spx/play premium present (${body.premium})`);
    } else if (!tradingDay || et.mins < 9 * 60 + 35) {
      console.log(`  ⚠ spx/play idle (phase=${body.phase ?? "?"}) — early session`);
    } else if (!body.available) {
      console.log(`  ⚠ spx/play unavailable: ${body.idle_message ?? body.phase ?? "idle"}`);
    } else {
      fail("spx/play: available but premium missing");
    }
  } catch (e) {
    fail(`spx/play probe: ${e.message}`);
  }

  console.log("\n4. Site latency (API)");
  const lat = spawnSync(
    "node",
    ["scripts/site-latency-audit.mjs", `--base=${BASE}`, "--api-only"],
    { stdio: "inherit", env: { ...env, SITE_LATENCY_API_ONLY: "1" } }
  );
  if (lat.status !== 0) fail("site-latency-audit failed");

  if (failures.length) {
    console.error(`\nStaging RTH FAILED (${failures.length}):`);
    failures.forEach((f) => console.error(`  · ${f}`));
    process.exit(1);
  }
  console.log("\nGREEN — staging RTH validation passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
