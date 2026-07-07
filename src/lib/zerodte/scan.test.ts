import { test, mock } from "node:test";
import assert from "node:assert/strict";

// scan.ts pulls in the FULL 0DTE provider graph (Night Hawk dossier builder, Polygon
// bar/quote providers, the options WS socket, server-cache) to run the live scan
// pipeline — irrelevant to what this file actually tests (zeroDtePlaysFeed's ledger-
// read + live-sync path). Every provider-touching import scan.ts pulls in gets a
// hermetic stand-in below, the same wholesale-mock idiom rejections.test.ts and
// largo-terminal.test.ts already use for this exact module graph (largo-terminal.test.ts
// mocks "./zerodte/scan" wholesale for the same reason, one level up). ./board,
// ./intraday, ./plan, ./rejections, and nighthawk/constants are left REAL — they're
// provider-import-free pure modules by their own module docs, so importing them for
// real here is both safe and a better test (derivePlayStatus's actual logic runs).
//
// P1 regression guard (found during the 0DTE Command entry-gate audit — see
// FINDINGS.md "0DTE Command's ambient Largo feed used a stale parallel scan path"):
// zeroDtePlaysFeed() used to read readZeroDteLedger() RAW with no live-quote sync,
// trusting the ~2-min grid-warm cron's last write. This proves it now calls the same
// syncLedgerLiveState() the canonical board payload (zerodte-service.ts) uses, so a
// play that has since stopped out no longer shows as "OPEN" in Largo's context.

type LedgerRow = Record<string, unknown>;

const state = {
  ledgerRows: [] as LedgerRow[],
  liveMark: null as number | null,
  updateCalls: [] as Array<{ session_date: string; ticker: string; patch: unknown }>,
};

function resetState() {
  state.ledgerRows = [];
  state.liveMark = null;
  state.updateCalls = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLog: async () => state.ledgerRows,
    updateZeroDteLiveState: async (session_date: string, ticker: string, patch: unknown) => {
      state.updateCalls.push({ session_date, ticker, patch });
    },
    // Unused by the functions under test, but scan.ts imports these at module scope
    // from "@/lib/db" (which resolves to this same mocked file) — must exist or the
    // ESM import throws "does not provide an export named ...".
    fetchLatestNighthawkEdition: async () => null,
    fetchRecentFlows: async () => [],
    fetchUngradedZeroDteRows: async () => [],
    gradeZeroDteSetupRow: async () => {},
    insertAlertAuditLog: async () => {},
    updateZeroDtePlanOutcome: async () => {},
    upsertZeroDteSetupLog: async () => new Set<string>(),
  },
});

mock.module("../../features/nighthawk/lib/dossier", {
  namedExports: {
    createDossierBuildCache: () => ({}),
    fetchTickerDossier: async () => null,
  },
});

mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-06",
    etNowParts: () => ({ hour: 11, minute: 30 }),
  },
});

mock.module("../providers/polygon-largo", {
  namedExports: { fetchAggBars: async () => [] },
});

mock.module("../providers/options-snapshot", {
  namedExports: {
    // syncLedgerLiveState only reads `.mark` off each returned snapshot.
    fetchOptionsUnifiedSnapshot: async (occs: string[]) => {
      const map = new Map<string, { mark: number | null; bid: number | null; ask: number | null; underlyingPrice: number | null }>();
      for (const occ of occs) {
        if (state.liveMark != null) {
          map.set(occ, { mark: state.liveMark, bid: state.liveMark, ask: state.liveMark, underlyingPrice: null });
        }
      }
      return map;
    },
  },
});

mock.module("../ws/options-socket", {
  namedExports: {
    // Never actually invoked by zeroDtePlaysFeed/syncLedgerLiveState (they read occ
    // straight off plan_json) — stubbed only so the module-scope import resolves.
    buildOcc: () => null,
  },
});

mock.module("../server-cache", {
  namedExports: {
    withServerCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  },
});

// ./rejections (left real below) imports @/lib/providers/spx-session directly (for
// todayEtYmd), which transitively pulls @/lib/et-date's `import "server-only"` —
// same "server-only" pull-in problem run-tool.test.ts/rejections.test.ts document
// for their own siblings. Stubbed for the same reason.
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

// scan.ts's last line re-exports zeroDtePlaysForLargo from zerodte-service.ts (a
// deliberate circular import: zerodte-service.ts itself imports FROM scan.ts) —
// zerodte-service.ts pulls in @/lib/bie/ecosystem-context, @/lib/providers/polygon,
// @/lib/zerodte/earnings, and @/lib/zerodte/intel, one of which transitively reaches
// a "server-only" boundary. Not needed for anything this file tests, so mocked
// wholesale to keep the import graph hermetic.
mock.module("../platform/zerodte-service", {
  namedExports: { zeroDtePlaysForLargo: async () => ({}) },
});

const mod = () => import("./scan");

function baseRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    session_date: "2026-07-06",
    ticker: "NVDA",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 140,
    first_flagged_at: "2026-07-06T14:00:00.000Z",
    last_seen_at: "2026-07-06T14:00:00.000Z",
    entry_premium: 4.2,
    last_mark: 4.2,
    status: "OPEN",
    top_strike: 145,
    conviction: null,
    gross_premium: 2_000_000,
    flow_avg_fill: 4.2,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    plan_json: { occ: "O:NVDA260706C00145000" },
    underlying_latest: null,
    flags_json: null,
    expiry: "2026-07-06",
    dossier_score: null,
    close_price: null,
    peak_premium: 4.2,
    trough_premium: 4.2,
    ...overrides,
  };
}

test("zeroDtePlaysFeed: reflects the FRESH live-synced status/mark, not the stale cron-written row", async () => {
  resetState();
  // The DB row as the ~2-min grid-warm cron last wrote it: status "OPEN", mark 4.2.
  // A live quote snapshot now shows 2.0 — the play's -50% stop (2.1) has since fired,
  // but nothing has told Postgres yet.
  state.ledgerRows = [baseRow({ last_mark: 4.2, status: "OPEN", trough_premium: 2.0 })];
  state.liveMark = 2.0;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { available: boolean; plays: Array<Record<string, unknown>> };

  assert.equal(feed.available, true);
  const play = feed.plays[0]!;
  // Pre-fix, this read the raw ledger row unsynced and would have asserted
  // status "OPEN" / last_mark 4.2 — the exact stale-parallel-path divergence.
  assert.equal(play.status, "CLOSED", "status must reflect the live-synced stop, not the stale cron write");
  assert.equal(play.last_mark, 2.0, "last_mark must be the fresh quote, not the stale DB value");
  // Proves syncLedgerLiveState actually ran (it persists the derived state back).
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0]!.ticker, "NVDA");
});

test("zeroDtePlaysFeed: a still-live play with no quote change stays exactly as flagged", async () => {
  resetState();
  state.ledgerRows = [baseRow({ status: "OPEN", last_mark: 4.2 })];
  state.liveMark = 4.2;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { plays: Array<Record<string, unknown>> };

  assert.equal(feed.plays[0]!.status, "OPEN");
  assert.equal(feed.plays[0]!.last_mark, 4.2);
});

test("zeroDtePlaysFeed: no ledger rows today — available:false, never a guess", async () => {
  resetState();
  const { zeroDtePlaysFeed } = await mod();
  const feed = await zeroDtePlaysFeed();
  assert.deepEqual(feed, { available: false, note: "no 0DTE plays flagged this session" });
});

test("zeroDtePlaysFeed: a graded CLOSED play surfaces its result string unchanged", async () => {
  resetState();
  state.ledgerRows = [
    baseRow({ status: "CLOSED", plan_outcome: "doubled", plan_pnl_pct: 100, last_mark: 8.4 }),
  ];
  // CLOSED rows are terminal — syncLedgerLiveState skips them, no live quote needed.
  state.liveMark = null;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { plays: Array<Record<string, unknown>> };

  assert.equal(feed.plays[0]!.status, "CLOSED");
  assert.equal(feed.plays[0]!.result, "doubled +100%");
  assert.equal(state.updateCalls.length, 0, "a CLOSED row must never be re-synced");
});
