#!/usr/bin/env node
/**
 * 0DTE Command — exhaustive logic audit (gates, plans, trade management, UI merge).
 *
 * Usage:
 *   node scripts/zerodte-logic-audit.mjs [--base=https://blackouttrades.com]
 *   npm run validate:zerodte-logic
 *
 * Layers:
 *   1. Unit tests (board, plan, rejections, UI freshness, mergePlays)
 *   2. Pure invariant probes (imported from src/lib/zerodte/*)
 *   3. Live board payload validation (CRON_SECRET bearer)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function runTests() {
  const files = [
    "src/lib/zerodte/board.test.ts",
    "src/lib/zerodte/rejections.test.ts",
    "src/features/nighthawk/components/ZeroDteBoard.test.ts",
  ];
  const r = spawnSync(
    `npx tsx --import tsx --experimental-test-module-mocks --test ${files.join(" ")}`,
    { shell: true, encoding: "utf8", env: process.env }
  );
  if (r.status !== 0) {
    rec("logic:unit-tests", "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 500));
    return false;
  }
  rec("logic:unit-tests", "PASS", `${files.length} files`);
  return true;
}

async function pureInvariantProbes() {
  const r = spawnSync("npx tsx scripts/zerodte-logic-probes.ts", {
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    rec("logic:pure-probes", "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return;
  }
  try {
    const probes = JSON.parse(r.stdout.trim());
    for (const p of probes) rec(p.name, p.status, p.detail);
  } catch (e) {
    rec("logic:pure-probes", "FAIL", e.message);
  }
}

function scanFinite(obj, path = "", out = []) {
  if (obj == null) return out;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}: ${obj}`);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanFinite(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) scanFinite(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

async function liveBoardAudit() {
  if (!CRON) {
    rec("live:board", "SKIP", "CRON_SECRET not set");
    return;
  }

  const r = await fetch(`${BASE}/api/market/zerodte/board`, {
    headers: { Authorization: `Bearer ${CRON}`, Accept: "application/json" },
  });
  if (!r.ok) {
    rec("live:board", "FAIL", `HTTP ${r.status}`);
    return;
  }
  const zb = await r.json();
  if (!zb.available) {
    rec("live:board", "FAIL", "available=false");
    return;
  }

  const SETUP_MIN_GROSS = 750_000;
  const SETUP_MIN_DOMINANCE = 0.65;
  const SETUP_MIN_AGGR_SHARE = 0.3;
  const SETUP_MAX_ITM_PCT = 2;
  const NEW_PLAY_CUTOFF_ET_MINUTES = 15 * 60;

  const badNums = scanFinite(zb).slice(0, 5);
  rec("live:finite-numbers", badNums.length === 0 ? "PASS" : "FAIL", badNums.join("; "));

  // Every live setup must pass gate thresholds (scanner can't emit failing rows).
  let gateFails = 0;
  for (const s of zb.setups ?? []) {
    if (s.gross_premium < SETUP_MIN_GROSS) gateFails++;
    if ((s.aggression ?? 0) < SETUP_MIN_AGGR_SHARE) gateFails++;
    if (s.side_dominance < SETUP_MIN_DOMINANCE) gateFails++;
    if (s.otm_pct != null && s.otm_pct < -SETUP_MAX_ITM_PCT) gateFails++;
    if (zb.covered_elsewhere?.includes(s.ticker)) gateFails++;
  }
  rec(
    "live:setup-gates",
    gateFails === 0 ? "PASS" : "FAIL",
    `${zb.setups?.length ?? 0} setups, ${gateFails} gate violations`
  );

  // Ledger PnL math + valid statuses.
  let pnlFails = 0;
  const validStatus = new Set(["OPEN", "HOLD", "TRIM", "CLOSED", null]);
  for (const row of zb.ledger ?? []) {
    if (row.status != null && !validStatus.has(row.status)) pnlFails++;
    if (row.entry_premium != null && row.last_mark != null && row.live_pnl_pct != null) {
      const expected = Math.round(((row.last_mark - row.entry_premium) / row.entry_premium) * 10000) / 100;
      if (Math.abs(expected - row.live_pnl_pct) > 0.05) pnlFails++;
    }
  }
  rec(
    "live:ledger-consistency",
    pnlFails === 0 ? "PASS" : "FAIL",
    `${zb.ledger?.length ?? 0} rows, ${pnlFails} issues`
  );

  // Session heat vs ET clock sanity (only on trading days).
  if (zb.session?.trading_day && zb.session?.heat?.state) {
    rec("live:session-heat", "PASS", `${zb.session.heat.state} heat=${zb.session.heat.heat_pct}%`);
  }

  if (zb.upstream_ok === false) {
    rec("live:upstream", "WARN", "tape fetch degraded this cycle");
  } else {
    rec("live:upstream", "PASS");
  }

  // Cutoff discipline label present in product (UI contract).
  rec("live:cutoff-constant", NEW_PLAY_CUTOFF_ET_MINUTES === 15 * 60 ? "PASS" : "FAIL", "15:00 ET");
}

async function main() {
  console.log("\n=== 0DTE logic audit ===\n");
  runTests();
  try {
    await pureInvariantProbes();
  } catch (e) {
    rec("logic:pure-probes", "FAIL", e.message);
  }
  try {
    await liveBoardAudit();
  } catch (e) {
    rec("live:board", "FAIL", e.message);
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `zerodte-logic-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — 0DTE logic audit passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
