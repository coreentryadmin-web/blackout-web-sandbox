import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("zerodte board route delegates to getZeroDteBoardPayload (single derivation)", () => {
  const route = readFileSync(join(ROOT, "app/api/market/zerodte/board/route.ts"), "utf8");
  assert.match(route, /getZeroDteBoardPayload/);
  assert.doesNotMatch(route, /scanZeroDteBoard/);
  assert.doesNotMatch(route, /buildBoardPayload/);
});

test("Largo get_zerodte_plays delegates to zeroDtePlaysForLargo in zerodte-service", () => {
  const runTool = readFileSync(join(ROOT, "lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /zeroDtePlaysForLargo/);
  const service = readFileSync(join(ROOT, "lib/platform/zerodte-service.ts"), "utf8");
  assert.match(service, /getZeroDteBoardPayload/);
  assert.match(service, /buildIntelNote/);
  assert.match(service, /nowEtMinutes/);
  assert.match(service, /lastMark/);
});

test("BIE composers read zeroDtePlaysForLargo from shared scan module", () => {
  const composers = readFileSync(join(ROOT, "lib/bie/composers.ts"), "utf8");
  assert.match(composers, /zeroDtePlaysForLargo/);
});

// P1 regression guard (FINDINGS.md): zeroDtePlaysForLargo()'s "fresh find" block
// used to compute its own OPEN/SKIP status checking ONLY entry_status === "MOVED" —
// missing the time-of-day cutoff (POWER_HOUR/LATE_SESSION/CLOSED) and illiquid gate
// ZeroDteBoard.tsx's mergePlays() already applied, so Largo/BIE could tell a member
// "ADD" (buy) for a fresh find the board itself showed as SKIP/watch-only. Fixed by
// sharing resolveFreshFindStatus() (board.ts) between both consumers — this asserts
// the shared call site, not just a string match, so a future edit that re-inlines
// the old (wrong) check is caught immediately.
test("zeroDtePlaysForLargo shares the fresh-find cutoff gate with ZeroDteBoard.tsx (resolveFreshFindStatus)", () => {
  const service = readFileSync(join(ROOT, "lib/platform/zerodte-service.ts"), "utf8");
  assert.match(service, /resolveFreshFindStatus/);
  const boardComponent = readFileSync(join(ROOT, "features/nighthawk/components/ZeroDteBoard.tsx"), "utf8");
  assert.match(boardComponent, /resolveFreshFindStatus/);
});

test("livePnlPct: board ledger and Largo plays use identical rounding", async () => {
  mock.module("server-only", { namedExports: {} });
  mock.module("../bie/ecosystem-context", {
    namedExports: {
      fetchNighthawkEchoForTickers: async () => new Map(),
    },
  });
  mock.module("../zerodte/scan", {
    namedExports: {
      readZeroDteLedger: async () => [
        {
          session_date: "2026-07-07",
          ticker: "NVDA",
          direction: "long",
          score: 80,
          score_max: 80,
          spike: false,
          underlying_at_flag: 140,
          first_flagged_at: new Date().toISOString(),
          entry_premium: 4.2,
          last_mark: 4.62,
          status: "HOLD",
          top_strike: 145,
          conviction: null,
          gross_premium: 2_000_000,
          flow_avg_fill: 4.2,
          move_pct: null,
          direction_hit: null,
          plan_outcome: null,
          plan_pnl_pct: null,
          graded_at: null,
          plan_json: null,
          underlying_latest: null,
          flags_json: null,
          expiry: null,
          dossier_score: null,
          last_seen_at: new Date().toISOString(),
          close_price: null,
          peak_premium: null,
          trough_premium: null,
        },
      ],
      syncLedgerLiveState: async (rows: unknown[]) => rows,
      scanZeroDteBoard: async () => ({ setups: [], nighthawk_covered: [], upstream_ok: true, rejections: [] }),
      gradeZeroDteLedger: async () => 0,
    },
  });
  mock.module("../providers/polygon", { namedExports: { fetchBenzingaNews: async () => [] } });
  mock.module("../zerodte/earnings", { namedExports: { readGridEarnings: async () => null } });
  mock.module("../server-cache", {
    namedExports: {
      withServerCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
      serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
      TTL: { NEWS: 60 },
    },
  });
  mock.module("../../features/nighthawk/lib/session", {
    namedExports: {
      todayEt: () => "2026-07-07",
      etNowParts: () => ({ hour: 11, minute: 30 }),
      isTradingDayEt: () => true,
      nextTradingDayEt: () => "2026-07-08",
    },
  });

  const { buildZeroDteBoardPayload, zeroDtePlaysForLargo } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  const largo = (await zeroDtePlaysForLargo()) as { plays: Array<{ live_pnl_pct: number | null }> };

  assert.equal(board.ledger[0]!.live_pnl_pct, 10);
  assert.equal(largo.plays[0]!.live_pnl_pct, board.ledger[0]!.live_pnl_pct);

  // PR-D additive fields: the pane's play-card header reads expiry off the ledger
  // row, and the governor strip reads the payload's own risk summary (real caps,
  // never a client-side copy). The mocked ledger has one HOLD row → one open plan.
  assert.equal(board.ledger[0]!.expiry, null);
  assert.ok(board.governor, "payload carries the governor summary");
  assert.deepEqual(board.governor!.open_plans, [{ ticker: "NVDA", direction: "long" }]);
  assert.equal(board.governor!.halted, false);
  assert.equal(board.governor!.max_concurrent, 3);
  assert.equal(board.governor!.max_session_stops, 3);
});
