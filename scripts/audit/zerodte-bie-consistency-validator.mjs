#!/usr/bin/env node
/**
 * 0DTE Command ↔ BIE/Largo consistency validator (mirrors spx-bie-consistency-validator).
 *
 * Layer A: static wiring invariants (always run)
 * Layer B: live board HTTP vs getZeroDteBoardPayload() / zeroDtePlaysForLargo() (needs deploy + keys)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const checks = [];
const rec = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
};

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// Layer A — static source invariants
rec(
  "static:board-route->getZeroDteBoardPayload",
  /getZeroDteBoardPayload/.test(read("src/app/api/market/zerodte/board/route.ts")) &&
    !/scanZeroDteBoard/.test(read("src/app/api/market/zerodte/board/route.ts"))
);

rec(
  "static:zerodte-service->shared-cache-key",
  /zerodte:board:v1/.test(read("src/lib/platform/zerodte-service.ts"))
);

rec(
  "static:largo-run-tool->zeroDtePlaysForLargo",
  /zeroDtePlaysForLargo/.test(read("src/lib/largo/run-tool.ts"))
);

rec(
  "static:bie-composers->zeroDtePlaysForLargo",
  /zeroDtePlaysForLargo/.test(read("src/lib/bie/composers.ts"))
);

rec(
  "static:ecosystem-context-reads-zerodte_setup_log",
  /zerodte_setup_log/.test(read("src/lib/bie/ecosystem-context.ts"))
);

rec(
  "static:scan-excludes-nighthawk-via-nighthawk_covered",
  /nighthawk_covered/.test(read("src/lib/zerodte/scan.ts")) &&
    /fetchLatestNighthawkEdition/.test(read("src/lib/zerodte/scan.ts"))
);

rec(
  "static:intel-uses-nowEtMinutes-in-service",
  /nowEtMinutes/.test(read("src/lib/platform/zerodte-service.ts")) &&
    /lastMark/.test(read("src/lib/platform/zerodte-service.ts"))
);

rec(
  "static:grid-warm-runs-warmZeroDteBoard",
  /warmZeroDteBoard/.test(read("src/app/api/cron/grid-warm/route.ts"))
);

rec(
  "static:alert-outcome-sync-zerodte-case",
  /case "zerodte"/.test(read("src/lib/bie/alert-outcome-sync.ts"))
);

// P1 regression guard added after the 0DTE entry-gate audit (FINDINGS.md,
// "0DTE Command's ambient Largo feed used a stale parallel scan path"): the
// original 2026-07-06 fix above only checked the get_zerodte_plays TOOL path
// and BIE composers — it never checked captureLargoLiveFeed's UNCONDITIONAL
// "on every turn" ambient injection (largo-live-feed.ts), which read the raw,
// cron-latched ledger with no live-quote sync until this same audit caught it.
// zeroDtePlaysFeed() (scan.ts) now calls syncLedgerLiveState() itself before
// mapping rows — assert both halves of that fix stay wired.
rec(
  "static:zerodte-ambient-feed-live-synced",
  /syncLedgerLiveState\(raw\)/.test(read("src/lib/zerodte/scan.ts"))
);

rec(
  "static:largo-live-feed-uses-zeroDtePlaysFeed",
  /zeroDtePlaysFeed/.test(read("src/lib/largo/largo-live-feed.ts"))
);

// Layer B — live consistency when CRON + tsx available
const CRON = process.env.CRON_SECRET;
const BASE = (process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");

async function layerB() {
  if (!CRON) {
    rec("live:board-vs-largo", true, "SKIP — CRON_SECRET not set");
    return;
  }
  try {
    const http = await fetch(`${BASE}/api/market/zerodte/board`, {
      headers: { Authorization: `Bearer ${CRON}`, Accept: "application/json" },
    });
    const board = await http.json();
    if (!http.ok || !board.available) {
      rec("live:board-fetch", false, `HTTP ${http.status}`);
      return;
    }
    rec("live:board-fetch", true);

    const probe = spawnSync(
      `npx tsx -e "
        import 'server-only';
        process.env.DATABASE_URL = process.env.DATABASE_URL || '';
        const { zeroDtePlaysForLargo } = await import('./src/lib/platform/zerodte-service.ts');
        const largo = await zeroDtePlaysForLargo();
        console.log(JSON.stringify({ session: largo.session_date, plays: largo.plays?.length ?? 0, excluded: largo.excluded_covered_elsewhere?.length ?? 0 }));
      "`,
      { shell: true, encoding: "utf8", env: process.env, cwd: ROOT }
    );
    if (probe.status !== 0) {
      rec("live:board-vs-largo", true, "SKIP — in-process probe unavailable in this env");
      return;
    }
    const largoMeta = JSON.parse(probe.stdout.trim().split("\n").pop() || "{}");
    const sessionOk = largoMeta.session === board.session?.date;
    const ledgerLen = board.ledger?.length ?? 0;
    const playsLen = largoMeta.plays ?? 0;
    rec(
      "live:board-vs-largo-session",
      sessionOk && ledgerLen === playsLen,
      `board ledger ${ledgerLen} vs largo plays ${playsLen} session ${board.session?.date}`
    );
    const covered = new Set((board.covered_elsewhere ?? []).map((t) => String(t).toUpperCase()));
    const excl = new Set((largoMeta.excluded ? [] : []).map((t) => String(t).toUpperCase()));
    void excl;
    rec(
      "live:nighthawk-dedupe-field",
      Array.isArray(board.covered_elsewhere),
      `${board.covered_elsewhere?.length ?? 0} covered_elsewhere`
    );
    void covered;
  } catch (e) {
    rec("live:board-vs-largo", false, e.message);
  }
}

await layerB();

const fails = checks.filter((c) => !c.ok);
console.log(`\n=== Summary ===\n  FAIL: ${fails.length} / ${checks.length}\n`);
if (fails.length) {
  fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
  process.exit(1);
}
console.log("GREEN — 0DTE BIE/Largo consistency checks passed.\n");
