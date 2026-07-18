#!/usr/bin/env node
/**
 * Continuous production spot-check — runs existing audit scripts on a loop.
 * Designed for Cloud Agent / ops: lightweight cycles with periodic deep sweeps.
 *
 * Usage:
 *   node scripts/continuous-spot-check.mjs              # loop every 5 min (default)
 *   node scripts/continuous-spot-check.mjs --once       # single cycle, exit 1 on fail
 *   node scripts/continuous-spot-check.mjs --interval=600
 *
 * Each cycle (always):
 *   - validate:gha-smoke        (~5s)
 *   - full-site-deep-audit.mjs  (~45s, 55 surfaces)
 *
 * Every 6th cycle (~30 min at 5m interval):
 *   - gha-rth-audit.mjs         (pages + crons + Postgres)
 *
 * Every 12th cycle (~60 min):
 *   - validate:deploy           (ECS + Postgres + sockets)
 *
 * Logs: audit-output/spot-check.log (JSON lines)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_MS = intervalArg
  ? Math.max(60_000, parseInt(intervalArg.slice("--interval=".length), 10) * 1000)
  : 5 * 60_000;

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "spot-check.log");

let cycle = 0;
let consecutiveFails = 0;

function log(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  appendFileSync(LOG, line + "\n");
  if (entry.level === "fail") console.error(`  ✗ ${entry.msg}`);
  else if (entry.level === "warn") console.log(`  ⚠ ${entry.msg}`);
  else console.log(`  ✓ ${entry.msg}`);
}

function runStep(name, cmd, cmdArgs = []) {
  const started = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ms = Date.now() - started;
  const ok = r.status === 0;
  const tail = (r.stdout || r.stderr || "").trim().split("\n").slice(-3).join(" | ");
  log({
    level: ok ? "ok" : "fail",
    cycle,
    step: name,
    ms,
    exit: r.status,
    msg: ok ? `${name} GREEN (${ms}ms)` : `${name} FAILED exit=${r.status} (${ms}ms) — ${tail}`,
  });
  return ok;
}

async function runCycle() {
  cycle += 1;
  console.log(`\n=== Spot-check cycle ${cycle} @ ${new Date().toISOString()} ===`);
  log({ level: "info", cycle, msg: `cycle ${cycle} start`, interval_ms: INTERVAL_MS });

  const steps = [
    ["gha-smoke", "npm", ["run", "validate:gha-smoke"]],
    ["full-site-deep", "node", ["scripts/full-site-deep-audit.mjs"]],
  ];

  if (cycle % 6 === 0) {
    steps.push(["gha-rth-audit", "node", ["scripts/gha-rth-audit.mjs"]]);
  }
  if (cycle % 12 === 0) {
    steps.push(["validate-deploy", "npm", ["run", "validate:deploy"]]);
  }

  let allOk = true;
  for (const [name, cmd, cmdArgs] of steps) {
    if (!runStep(name, cmd, cmdArgs)) allOk = false;
  }

  if (allOk) {
    consecutiveFails = 0;
    log({ level: "ok", cycle, msg: `cycle ${cycle} complete — all GREEN` });
  } else {
    consecutiveFails += 1;
    log({
      level: "fail",
      cycle,
      consecutive_fails: consecutiveFails,
      msg: `cycle ${cycle} had failures (consecutive=${consecutiveFails})`,
    });
  }

  return allOk;
}

async function main() {
  console.log(`Continuous spot-check → ${LOG}`);
  console.log(`Interval: ${INTERVAL_MS / 1000}s | once=${once}`);

  do {
    const ok = await runCycle();
    if (once) {
      process.exit(ok ? 0 : 1);
    }
    if (!ok && consecutiveFails >= 3) {
      log({
        level: "warn",
        cycle,
        msg: `${consecutiveFails} consecutive failed cycles — continuing loop (no auto-fix)`,
      });
    }
    console.log(`Next cycle in ${INTERVAL_MS / 1000}s…`);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (true);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
