#!/usr/bin/env node
/**
 * SPX Slayer all-day RTH audit — orchestrates every SPX-specific probe in one pass.
 *
 * Usage:
 *   node scripts/spx-rth-all-day-audit.mjs [--force] [--phase=verify|post-close]
 *   npm run validate:spx-rth
 *
 * Requires: CRON_SECRET (Bearer for premium SPX routes + data-correctness cron)
 * Optional: DATABASE_PUBLIC_URL (rth-open writer checks via validate:rth-open)
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTradingDayEt, inRthOpenWindow, todayEtYmd, etParts } from "./gha-et-window.mjs";

const force = process.argv.includes("--force");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "verify";
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

function run(cmd, label) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    rec(label, "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return false;
  }
  rec(label, "PASS");
  return true;
}

async function fetchJson(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${CRON}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

function spotDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b);
}

async function spxCrossEndpointCheck() {
  if (!CRON) {
    rec("spx:cross-endpoint", "SKIP", "CRON_SECRET not set");
    return;
  }
  try {
    const [desk, heatmap, positioning, play] = await Promise.all([
      fetchJson("/api/market/spx/desk"),
      fetchJson("/api/market/gex-heatmap?ticker=SPX"),
      fetchJson("/api/market/gex-positioning?ticker=SPX"),
      fetchJson("/api/market/spx/play"),
    ]);

    const deskSpot = Number(desk?.price ?? desk?.quote?.price ?? desk?.spot);
    const hmSpot = Number(heatmap?.spot);
    const posSpot = Number(positioning?.spot);

    const issues = [];
    if (spotDelta(deskSpot, hmSpot) > 0.15) {
      issues.push(`desk spot ${deskSpot} vs heatmap ${hmSpot} Δ=${spotDelta(deskSpot, hmSpot).toFixed(3)}`);
    }
    if (spotDelta(hmSpot, posSpot) > 0.15) {
      issues.push(`heatmap spot ${hmSpot} vs positioning ${posSpot}`);
    }
    if (Number.isFinite(hmSpot) && heatmap?.gex?.flip != null && positioning?.flip != null) {
      if (Math.abs(Number(heatmap.gex.flip) - Number(positioning.flip)) > 1) {
        issues.push(`flip matrix ${heatmap.gex.flip} vs positioning ${positioning.flip}`);
      }
    }
    if (play?.available && play?.levels?.spot != null && Number.isFinite(hmSpot)) {
      if (spotDelta(Number(play.levels.spot), hmSpot) > 0.25) {
        issues.push(`play spot ${play.levels.spot} vs heatmap ${hmSpot}`);
      }
    }
    if (play?.action === "SCANNING" && play?.confirmations?.checks?.length) {
      issues.push("play SCANNING still carries confirmations (stale layer bug)");
    }

    if (issues.length) {
      rec("spx:cross-endpoint", "FAIL", issues.join("; "));
    } else {
      rec(
        "spx:cross-endpoint",
        "PASS",
        `spot desk=${deskSpot} hm=${hmSpot} play=${play?.action}/${play?.phase}`
      );
    }
  } catch (e) {
    rec("spx:cross-endpoint", "FAIL", e.message);
  }
}

async function deskLaneCheck() {
  if (!CRON) {
    rec("spx:desk-lanes", "SKIP", "CRON_SECRET not set");
    return;
  }
  try {
    const [desk, pulse, flow, mergedWrap] = await Promise.all([
      fetchJson("/api/market/spx/desk"),
      fetchJson("/api/market/spx/pulse"),
      fetchJson("/api/market/spx/flow"),
      fetchJson("/api/market/spx/merged"),
    ]);
    const merged = mergedWrap?.merged ?? mergedWrap;

    const deskSpot = Number(desk?.price ?? desk?.quote?.price ?? desk?.spot);
    const mergedSpot = Number(merged?.price ?? merged?.quote?.price ?? merged?.spot);

    const issues = [];
    if (Number.isFinite(deskSpot) && Number.isFinite(mergedSpot) && spotDelta(deskSpot, mergedSpot) > 0.01) {
      issues.push(`desk vs merged spot Δ=${spotDelta(deskSpot, mergedSpot).toFixed(3)}`);
    }

    if (pulse?.available && Number(pulse?.price) > 0) {
      const pulseSpot = Number(pulse.price);
      if (spotDelta(deskSpot, pulseSpot) > 0.15) {
        issues.push(`desk vs pulse spot Δ=${spotDelta(deskSpot, pulseSpot).toFixed(3)}`);
      }
    }
    if (flow?.available && Number(flow?.price) > 0) {
      const flowSpot = Number(flow.price);
      if (spotDelta(deskSpot, flowSpot) > 0.15) {
        issues.push(`desk vs flow spot Δ=${spotDelta(deskSpot, flowSpot).toFixed(3)}`);
      }
    }

    if (!pulse?.available && !flow?.available) {
      rec("spx:desk-lanes", "SKIP", "pulse/flow unavailable (off-hours or holiday)");
      return;
    }

    if (issues.length) {
      rec("spx:desk-lanes", "FAIL", issues.join("; "));
    } else {
      rec("spx:desk-lanes", "PASS", `spot=${deskSpot} pulse=${pulse?.available} flow=${flow?.available}`);
    }
  } catch (e) {
    rec("spx:desk-lanes", "FAIL", e.message);
  }
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  const ymd = todayEtYmd(now);

  console.log(`\n=== SPX Slayer all-day RTH audit ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})`);
  console.log(`Phase: ${PHASE} | Target: ${BASE}\n`);

  if (!force && !inRthOpenWindow(now) && PHASE === "verify") {
    console.log("Outside RTH window — skipping (use --force).\n");
    process.exit(0);
  }

  if (!isTradingDayEt(ymd) && !force) {
    console.log(`${ymd} is not a trading day — skipping.\n`);
    process.exit(0);
  }

  if (!CRON) {
    rec("env:CRON_SECRET", "FAIL", "required for SPX API probes");
  } else {
    rec("env:CRON_SECRET", "PASS");
  }

  // 1. RTH infra gate
  if (force || inRthOpenWindow(now)) {
    run("npm run validate:rth-open", "infra:validate:rth-open");
  }

  // 2. SPX matrix — every cell invariant (SPX only during all-day pass)
  if (CRON) {
    run("node scripts/heatmap-matrix-audit.mjs --tickers=SPX", "spx:matrix-deep-audit");
  }

  // 3. Cross-endpoint + desk lanes
  await spxCrossEndpointCheck();
  await deskLaneCheck();

  // 4. BIE/Largo single-derivation cross-check
  run("npm run validate:spx-bie", "spx:bie-consistency");

  // 5. Ops + data-correctness
  if (CRON) {
    try {
      const dc = await fetchJson("/api/cron/data-correctness?force=1");
      const flags = dc.totals?.flags ?? dc.flags?.length ?? 0;
      const spxFlags = (dc.flags ?? []).filter(
        (f) =>
          /spx|gex|heatmap|desk|slayer/i.test(f.metric ?? "") ||
          /spx|gex|heatmap|desk/i.test(f.layer ?? "")
      );
      if (spxFlags.length) {
        rec("spx:data-correctness", "FAIL", `${spxFlags.length} SPX-layer flag(s)`);
        for (const f of spxFlags.slice(0, 5)) {
          console.log(`    · [${f.layer}/${f.metric}] ${f.detail}`);
        }
      } else if (flags > 0 && PHASE === "verify") {
        rec("spx:data-correctness", "WARN", `${flags} non-SPX flags (see cron report)`);
      } else {
        rec("spx:data-correctness", "PASS", `flags=${flags}`);
      }
    } catch (e) {
      rec("spx:data-correctness", "FAIL", e.message);
    }
  }

  run("npm run ops:collect", "ops:collect");

  const fails = checks.filter((c) => c.status === "FAIL");
  const warns = checks.filter((c) => c.status === "WARN");
  const reportPath = join(OUT, `spx-rth-${ymd}-${PHASE}-${Date.now()}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ ts: now.toISOString(), phase: PHASE, et: et.label, checks }, null, 2)
  );

  console.log(`\n=== Summary (${PHASE}) ===`);
  console.log(`  PASS: ${checks.filter((c) => c.status === "PASS").length}`);
  console.log(`  WARN: ${warns.length}`);
  console.log(`  FAIL: ${fails.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    console.log("FAILURES:");
    for (const f of fails) console.log(`  · ${f.name}: ${f.detail ?? ""}`);
    console.log("");
    if (PHASE === "fix") {
      console.log("Post-close fix mode — agent MUST fix all failures before ending session.\n");
    } else {
      console.log("Verify mode — log to OPEN-ISSUES.md; defer non-P0 fixes to post-close.\n");
    }
    process.exit(1);
  }

  console.log("GREEN — SPX all-day audit passed.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
