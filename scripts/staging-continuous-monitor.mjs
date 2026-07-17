#!/usr/bin/env node
/**
 * Continuous staging RTH monitor — runs CTO audit cycles through the session.
 *
 * Usage:
 *   node scripts/staging-continuous-monitor.mjs
 *   node scripts/staging-continuous-monitor.mjs --once
 *   node scripts/staging-continuous-monitor.mjs --interval=300
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { etParts } from "./gha-et-window.mjs";

const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_MS = intervalArg
  ? Math.max(60_000, parseInt(intervalArg.slice("--interval=".length), 10) * 1000)
  : 5 * 60_000;

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "staging-monitor.log");

let cycle = 0;

function log(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  appendFileSync(LOG, line + "\n");
  const icon = entry.ok ? "✓" : "✗";
  console.log(`${icon} [cycle ${entry.cycle}] ${entry.msg}`);
}

function run(name, cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    env: { ...process.env, SKIP_ECS: "1" },
    timeout: 20 * 60_000,
  });
  return { name, ok: r.status === 0, code: r.status, tail: (r.stderr || r.stdout || "").slice(-400) };
}

function phaseForEt() {
  const { mins } = etParts();
  if (mins < 9 * 60 + 30) return "preopen";
  if (mins < 16 * 60 + 15) return "open";
  return "postclose";
}

async function cycleOnce() {
  cycle++;
  const et = etParts();
  const phase = phaseForEt();
  console.log(`\n── Staging monitor cycle ${cycle} (${et.label}, phase=${phase}) ──\n`);

  const steps = [
    ["spot", "node", ["scripts/staging-live-check.mjs"]],
  ];

  if (cycle % 2 === 0) {
    steps.push(["latency", "node", ["scripts/latency-burst-audit.mjs", "--rounds=3"]]);
    steps.push(["staging-vs-prod", "node", ["scripts/staging-prod-latency-watch.mjs", "--once"]]);
  }
  if (cycle % 3 === 0 || phase === "open") {
    steps.push(["rth", "node", ["scripts/staging-rth-check.mjs", "--force"]]);
  }
  if (cycle % 6 === 0 || (phase === "open" && cycle % 3 === 0)) {
    steps.push(["cto", "node", ["scripts/staging-cto-audit.mjs", `--phase=${phase === "preopen" ? "preopen" : "full"}`]]);
  }
  if (cycle % 4 === 0) {
    steps.push(["parity", "node", ["scripts/staging-prod-data-parity.mjs"]]);
  }

  const outcomes = [];
  for (const [name, cmd, cmdArgs] of steps) {
    const r = run(name, cmd, cmdArgs);
    outcomes.push(r);
    log({ cycle, phase, step: name, ok: r.ok, msg: r.ok ? `${name} PASS` : `${name} FAIL: ${r.tail}` });
    if (!r.ok && name === "spot") break;
  }

  const allOk = outcomes.every((o) => o.ok);
  log({ cycle, phase, ok: allOk, msg: allOk ? "cycle GREEN" : "cycle RED" });
  return allOk;
}

async function main() {
  console.log(`Staging continuous monitor — interval ${INTERVAL_MS / 1000}s, log ${LOG}\n`);
  do {
    const ok = await cycleOnce();
    if (once) process.exit(ok ? 0 : 1);
    if (!ok) console.log("\n⚠ Failures detected — next cycle in", INTERVAL_MS / 1000, "s\n");
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
