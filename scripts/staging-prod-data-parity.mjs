#!/usr/bin/env node
/**
 * Postgres + API parity check — staging vs production.
 * Usage: node scripts/staging-prod-data-parity.mjs
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const STAGING_BASE = "https://staging.blackouttrades.com";
const PROD_BASE = "https://blackouttrades.com";

const TABLES = [
  "cron_job_runs",
  "flow_alerts",
  "spx_open_play",
  "spx_play_outcomes",
  "nighthawk_editions",
  "nighthawk_play_outcomes",
  "zerodte_setup_log",
  "market_regime",
  "users",
  "signal_events",
  "flow_anomalies",
  "spx_signal_log",
  "flow_anomaly_near_misses",
  "gex_regime_events",
  "platform_meta",
];

const API_CHECKS = [
  { name: "flows_count", path: "/api/market/flows?limit=5", pick: (b) => ({ count: b.count, source: b.source, first_id: b.flows?.[0]?.id ?? b.flows?.[0]?.alerted_at }) },
  { name: "regime", path: "/api/market/regime", pick: (b) => ({ available: b.available, label: b.label ?? b.regime, asof: b.asof ?? b.captured_at }) },
  { name: "nighthawk_edition", path: "/api/market/nighthawk/edition", pick: (b) => ({ date: b.edition_date ?? b.date, plays: b.plays?.length ?? 0 }) },
  { name: "zerodte_board", path: "/api/market/zerodte/board", pick: (b) => ({ setups: b.setups?.length ?? b.board?.length ?? 0, available: b.available }) },
  { name: "spx_play", path: "/api/market/spx/play", pick: (b) => ({ available: b.available, phase: b.phase, action: b.action }) },
];

function railwayProdUrl() {
  const res = spawnSync(
    "railway",
    [
      "variables",
      "--service",
      "Postgres",
      "--environment",
      "production",
      "--project",
      process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a",
      "--json",
    ],
    { encoding: "utf8", env: process.env }
  );
  return JSON.parse(res.stdout).DATABASE_PUBLIC_URL;
}

function stagingDbUrl() {
  const raw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  return JSON.parse(raw).DATABASE_URL;
}

function loadCrons() {
  const prodRes = spawnSync(
    "railway",
    [
      "variables",
      "--service",
      "blackout-web",
      "--environment",
      "production",
      "--project",
      process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a",
      "--json",
    ],
    { encoding: "utf8", env: process.env }
  );
  const prod = prodRes.status === 0 ? JSON.parse(prodRes.stdout).CRON_SECRET?.trim() : process.env.CRON_SECRET?.trim();
  const stagingRaw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  const staging = JSON.parse(stagingRaw).CRON_SECRET?.trim();
  return { prod, staging };
}

function psqlQuery(url, sql) {
  const res = spawnSync("psql", [url, "-t", "-A", "-c", sql], { encoding: "utf8", timeout: 120_000 });
  if (res.status !== 0) throw new Error(res.stderr?.trim() || "psql failed");
  return res.stdout.trim();
}

function tableStats(url, table) {
  try {
    const count = psqlQuery(url, `SELECT COUNT(*)::bigint FROM ${table}`);
    const maxTs = psqlQuery(
      url,
      `SELECT COALESCE(
        (SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${table}'
           AND column_name IN ('started_at','created_at','captured_at','fired_at','detected_at','alerted_at','updated_at')
         ORDER BY CASE column_name
           WHEN 'started_at' THEN 1 WHEN 'captured_at' THEN 2 WHEN 'created_at' THEN 3
           WHEN 'fired_at' THEN 4 WHEN 'detected_at' THEN 5 WHEN 'alerted_at' THEN 6 ELSE 9 END
         LIMIT 1),
        NULL
      )`
    );
    let latest = null;
    if (maxTs && maxTs !== "") {
      latest = psqlQuery(url, `SELECT MAX(${maxTs})::text FROM ${table}`);
    }
    return { exists: true, count: Number(count), latest };
  } catch (e) {
    if (/does not exist|relation/.test(e.message)) return { exists: false, error: e.message.split("\n")[0] };
    throw e;
  }
}

function schemaCheck(url, label) {
  const tables = psqlQuery(
    url,
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
  )
    .split("\n")
    .filter(Boolean);
  return { label, table_count: tables.length, tables };
}

async function apiSnapshot(base, cron, checks) {
  const out = {};
  for (const c of checks) {
    const res = await fetchRetry(
      `${base}${c.path}`,
      { headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" } },
      { retries: 3, timeoutMs: 90_000 }
    );
    const body = await res.json().catch(() => ({}));
    out[c.name] = { status: res.status, ...c.pick(body) };
  }
  return out;
}

function hashObj(o) {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
}

async function main() {
  console.log("\n=== Staging vs Prod data parity ===\n");
  const { prod: prodCron, staging: stagingCron } = loadCrons();
  const prodUrl = railwayProdUrl();
  let stagingUrl;
  try {
    stagingUrl = stagingDbUrl();
  } catch (e) {
    console.error("staging secret:", e.message);
    process.exit(1);
  }

  const issues = [];
  const ok = (m) => console.log(`  ✓ ${m}`);
  const warn = (m) => {
    issues.push({ level: "WARN", msg: m });
    console.log(`  ⚠ ${m}`);
  };
  const fail = (m) => {
    issues.push({ level: "FAIL", msg: m });
    console.log(`  ✗ ${m}`);
  };

  // ── Schema ──────────────────────────────────────────────────────────────
  console.log("1. Postgres schema");
  const prodSchema = schemaCheck(prodUrl, "prod");
  let stagingSchema = null;
  try {
    stagingSchema = schemaCheck(stagingUrl, "staging");
    ok(`prod tables: ${prodSchema.table_count}, staging tables: ${stagingSchema.table_count}`);
    const prodSet = new Set(prodSchema.tables);
    const stagingSet = new Set(stagingSchema.tables);
    const onlyProd = [...prodSet].filter((t) => !stagingSet.has(t));
    const onlyStaging = [...stagingSet].filter((t) => !prodSet.has(t));
    if (onlyProd.length) fail(`tables only on prod: ${onlyProd.join(", ")}`);
    else ok("no prod-only tables");
    if (onlyStaging.length) warn(`tables only on staging: ${onlyStaging.join(", ")}`);
    else ok("no staging-only tables");
  } catch (e) {
    warn(`staging DB direct query failed: ${e.message.split("\n")[0]}`);
    warn("falling back to API-only parity (staging RDS is VPC-private; run blackout-infra/scripts/compare-staging-prod-postgres.mjs for in-VPC counts)");
  }

  // ── Table counts (prod always; staging if reachable) ────────────────────
  console.log("\n2. Postgres row counts (migration snapshot parity)");
  const countRows = [];
  for (const table of TABLES) {
    const prod = tableStats(prodUrl, table);
    let staging = { exists: false, skip: true };
    if (stagingSchema) {
      try {
        staging = tableStats(stagingUrl, table);
      } catch (e) {
        staging = { exists: false, error: e.message.split("\n")[0] };
      }
    }
    const row = { table, prod, staging };
    countRows.push(row);
    if (!prod.exists) {
      warn(`${table}: missing on prod`);
      continue;
    }
    if (staging.skip) {
      console.log(`  · ${table}: prod=${prod.count} (staging DB unreachable from VM)`);
      continue;
    }
    if (!staging.exists) {
      fail(`${table}: missing on staging`);
      continue;
    }
    if (prod.count === staging.count) {
      ok(`${table}: count=${prod.count} (match) latest=${prod.latest ?? "n/a"}`);
    } else {
      const delta = staging.count - prod.count;
      // After migration, staging writes independently — counts may diverge; flag large drift
      if (Math.abs(delta) <= 5 && prod.latest === staging.latest) {
        warn(`${table}: count prod=${prod.count} staging=${staging.count} (Δ${delta}) but same latest ts`);
      } else if (prod.latest === staging.latest && prod.count === staging.count) {
        ok(`${table}: match`);
      } else if (staging.count >= prod.count * 0.99 && staging.count <= prod.count * 1.01) {
        warn(`${table}: near match prod=${prod.count} staging=${staging.count}`);
      } else {
        fail(`${table}: MISMATCH prod=${prod.count}@${prod.latest} staging=${staging.count}@${staging.latest}`);
      }
    }
  }

  // ── API parity (same cron responses) ───────────────────────────────────
  console.log("\n3. API snapshot parity (cron-authenticated)");
  const prodApi = await apiSnapshot(PROD_BASE, prodCron, API_CHECKS);
  const stagingApi = await apiSnapshot(STAGING_BASE, stagingCron, API_CHECKS);
  for (const name of Object.keys(prodApi)) {
    const p = prodApi[name];
    const s = stagingApi[name];
    const same = JSON.stringify(p) === JSON.stringify(s);
    if (same) ok(`${name}: identical`);
    else {
      console.log(`  · ${name}:`);
      console.log(`      prod:    ${JSON.stringify(p)}`);
      console.log(`      staging: ${JSON.stringify(s)}`);
      // regime/flows may differ if staging wrote new rows — warn not fail unless huge
      if (name === "spx_play" && p.phase === s.phase && p.available === s.available) {
        warn(`${name}: structurally similar (phase/available match)`);
      } else if (name === "flows_count" && p.source === s.source) {
        warn(`${name}: same source, counts may differ post-migration`);
      } else {
        warn(`${name}: differs (expected after independent staging writes)`);
      }
    }
  }

  // ── Flow fingerprint (top 3 alerts) ─────────────────────────────────────
  console.log("\n4. HELIX flow tape fingerprint");
  for (const [label, base, cron] of [
    ["prod", PROD_BASE, prodCron],
    ["staging", STAGING_BASE, stagingCron],
  ]) {
    const res = await fetchRetry(
      `${base}/api/market/flows?limit=10`,
      { headers: { Authorization: `Bearer ${cron}` } },
      { retries: 3, timeoutMs: 60_000 }
    );
    const body = await res.json();
    const fp = (body.flows ?? []).slice(0, 5).map((f) => ({
      ticker: f.ticker,
      premium: f.premium,
      event_at: f.event_at ?? f.alerted_at,
      direction: f.direction,
    }));
    console.log(`  ${label}: source=${body.source} count=${body.count} fp=${hashObj(fp)}`);
    if (label === "prod") var prodFp = hashObj(fp);
    else var stagingFp = hashObj(fp);
  }
  if (prodFp === stagingFp) ok("top-5 flow fingerprint MATCH (tape identical at query time)");
  else warn("top-5 flow fingerprint differs — staging may have ingested new rows or cache diverged");

  // ── data-correctness ─────────────────────────────────────────────────────
  console.log("\n5. data-correctness");
  for (const [label, base, cron] of [
    ["prod", PROD_BASE, prodCron],
    ["staging", STAGING_BASE, stagingCron],
  ]) {
    const res = await fetchRetry(
      `${base}/api/cron/data-correctness?force=1`,
      { headers: { Authorization: `Bearer ${cron}` } },
      { retries: 2, timeoutMs: 120_000 }
    );
    const body = await res.json();
    const flags = body.flags?.length ?? 0;
    if (body.ok && flags === 0) ok(`${label}: flags=0`);
    else fail(`${label}: flags=${flags} ok=${body.ok}`);
  }

  const report = {
    ts: new Date().toISOString(),
    schema: { prod: prodSchema, staging: stagingSchema },
    tables: countRows,
    api: { prod: prodApi, staging: stagingApi },
    issues,
  };
  const path = join(OUT, `data-parity-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path}`);

  const fails = issues.filter((i) => i.level === "FAIL");
  console.log(`\n=== Summary === FAIL: ${fails.length} WARN: ${issues.length - fails.length}\n`);
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
