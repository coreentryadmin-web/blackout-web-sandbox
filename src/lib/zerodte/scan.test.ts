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
  /** When true, fetchZeroDteSetupLog throws — drives the P0 ledger-read-failure tests. */
  ledgerReadFails: false,
  liveMark: null as number | null,
  updateCalls: [] as Array<{ session_date: string; ticker: string; patch: unknown }>,
  // gradeZeroDteLedger wiring (index-root mapping test below)
  ungradedRows: [] as LedgerRow[],
  gradeCalls: [] as Array<{ sessionDate: string; ticker: string; grade: Record<string, unknown> }>,
  aggBarCalls: [] as Array<{ symbol: string; timespan: string }>,
  dailyBars: new Map<string, Array<{ t: number; o: number; h: number; l: number; c: number }>>(),
};

function resetState() {
  state.ledgerRows = [];
  state.ledgerReadFails = false;
  state.liveMark = null;
  state.updateCalls = [];
  state.ungradedRows = [];
  state.gradeCalls = [];
  state.aggBarCalls = [];
  state.dailyBars = new Map();
}

// scan.ts's exit-engine wiring (./exit-sync) imports ./live-marks, which reaches
// @/lib/et-market-hours → @/lib/et-date → `import "server-only"` — same stub the
// platform service tests use for the same boundary.
mock.module("server-only", { namedExports: {} });

// The exit engine's thesis-break check fetches Cortex evidence for OPEN rows
// (bounded + fail-soft). Hermetic stand-in: a throwing fetch degrades to
// "evidence unavailable → thesis check skipped" — the fail-soft contract itself —
// so no real reader fan-out (or its 2.5s per-source budgets) ever runs in here.
// CORTEX_SOURCE_TIMEOUT_MS must exist too: the cortex barrel re-exports it from
// this same module, and ESM linking checks every re-exported name.
mock.module("../nighthawk/cortex/fetch", {
  namedExports: {
    fetchCortexInputs: async () => {
      throw new Error("hermetic: no cortex reads in scan.test.ts");
    },
    CORTEX_SOURCE_TIMEOUT_MS: 2_500,
  },
});

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    stampZeroDteExitContext: async () => {},
    fetchZeroDteSetupLog: async () => {
      if (state.ledgerReadFails) throw new Error("hermetic: simulated ledger read failure");
      return state.ledgerRows;
    },
    updateZeroDteLiveState: async (session_date: string, ticker: string, patch: unknown) => {
      state.updateCalls.push({ session_date, ticker, patch });
    },
    // Unused by the functions under test, but scan.ts imports these at module scope
    // from "@/lib/db" (which resolves to this same mocked file) — must exist or the
    // ESM import throws "does not provide an export named ...".
    fetchLatestNighthawkEdition: async () => null,
    fetchOpenSpxPlay: async () => null,
    fetchRecentFlows: async () => [],
    fetchUngradedZeroDteRows: async () => state.ungradedRows,
    gradeZeroDteSetupRow: async (sessionDate: string, ticker: string, grade: Record<string, unknown>) => {
      state.gradeCalls.push({ sessionDate, ticker, grade });
    },
    insertAlertAuditLog: async () => {},
    updateZeroDtePlanOutcome: async () => {},
    upsertZeroDteSetupLog: async () => new Set<string>(),
  },
});

// scan.ts's G-6 calibration context reads the Night Hawk echo through
// @/lib/bie/ecosystem-context, whose real import graph reaches @/lib/db and beyond —
// stubbed to an empty map (no takes → no conflicts), same wholesale idiom as below.
mock.module("../bie/ecosystem-context", {
  namedExports: {
    fetchNighthawkEchoForTickers: async () => new Map(),
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
    // ./exit-sync pulls ./live-marks into scan.ts's graph, which reaches
    // @/lib/et-market-hours and @/features/spx/lib/spx-play-session-guards — both
    // real modules importing these names from this (mocked) module.
    isTradingDayEt: () => true,
    formatEtDate: (d: Date) => d.toISOString().slice(0, 10),
  },
});

mock.module("../providers/polygon-largo", {
  namedExports: {
    // Mirrors the real provider's failure mode this suite guards against: an
    // unknown/unmapped symbol does NOT throw — Polygon answers status OK with an
    // EMPTY result set. Only symbols seeded into state.dailyBars return bars.
    fetchAggBars: async (symbol: string, _mult: number, timespan: string) => {
      state.aggBarCalls.push({ symbol, timespan });
      return state.dailyBars.get(symbol) ?? [];
    },
  },
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
    // ./live-marks (pulled in via ./exit-sync) imports these at module scope; the
    // exit path only READS the lane's in-memory store, never the WS pool itself.
    getLiveOptionMark: async () => null,
    subscribeContracts: () => {},
    unsubscribeContracts: () => {},
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
    // Recent relative to the REAL clock: the exit engine's flat-timeout ages a row
    // off first_flagged_at vs Date.now(), and a fixture stamped hours/days in the
    // past would read as ≥45min of flat theta bleed and (correctly) exit — these
    // tests are about the sync/grade paths, not the timeout rule (covered in
    // exit-engine.test.ts / exit-sync.test.ts).
    first_flagged_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString(),
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

// ── P0 one-way commit door: readZeroDteLedgerChecked's last-good latch ────────────
// The old readZeroDteLedger swallowed ANY read failure into [], indistinguishable
// from "no plays committed today" — one transient DB blip made every committed play
// vanish from the board payload, and (because committed tickers usually still rank
// in the scan's fresh finds) a member's OPEN card re-rendered as an uncommitted
// watch card. These prove: failure serves the last-good same-session snapshot, and
// a failure with NO snapshot says committed_known:false so consumers fail closed.

test("readZeroDteLedgerChecked: a transient read failure serves the last-good same-session snapshot (committed rows never vanish)", async () => {
  resetState();
  const { readZeroDteLedgerChecked, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerRows = [baseRow({ status: "OPEN" })];
  const first = await readZeroDteLedgerChecked();
  assert.equal(first.committed_known, true);
  assert.equal(first.rows.length, 1);

  // Next build: the DB read blips. Pre-fix this returned [] — the OPEN play gone.
  state.ledgerReadFails = true;
  const second = await readZeroDteLedgerChecked();
  assert.equal(second.committed_known, true, "a same-session snapshot stands in — the committed set is still knowable");
  assert.equal(second.rows.length, 1, "the committed row survives the blip");
  assert.equal(second.rows[0]!.ticker, "NVDA");
});

test("readZeroDteLedgerChecked: failure with NO same-session snapshot is committed_known:false — never a lying empty ledger", async () => {
  resetState();
  const { readZeroDteLedgerChecked, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerReadFails = true;
  const read = await readZeroDteLedgerChecked();
  assert.equal(read.committed_known, false);
  assert.deepEqual(read.rows, []);
});

test("readZeroDteLedger: delegates through the checked read (empty on unknowable, latched rows on a blip)", async () => {
  resetState();
  const { readZeroDteLedger, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerRows = [baseRow({ status: "HOLD" })];
  assert.equal((await readZeroDteLedger()).length, 1);
  state.ledgerReadFails = true;
  assert.equal((await readZeroDteLedger()).length, 1, "latched snapshot serves through the legacy read too");
});

test("gradeZeroDteLedger: an index-root row (SPXW) fetches its close from I:SPX and gets a REAL direction grade", async () => {
  resetState();
  // Prior-session SPXW row, plan already graded (plan_outcome set) so only the
  // direction grade runs. Live numbers from the 2026-07-13 audit: flagged at
  // 7564.68, I:SPX closed 7575.39 → long direction_hit = true.
  state.ungradedRows = [
    baseRow({
      ticker: "SPXW",
      session_date: "2026-07-03",
      underlying_at_flag: 7564.68,
      plan_outcome: "stopped",
      plan_pnl_pct: -50,
      plan_json: { occ: "O:SPXW260703C07565000" },
    }),
  ];
  // Polygon has NO daily bars under the raw root "SPXW" — only under I:SPX.
  // Pre-fix, the scan asked for "SPXW", got [], and stamped a permanent null grade.
  state.dailyBars.set("I:SPX", [{ t: 1751500800000, o: 7547.64, h: 7579.93, l: 7508.16, c: 7575.39 }]);

  const { gradeZeroDteLedger } = await mod();
  const graded = await gradeZeroDteLedger(true);

  assert.equal(graded, 1);
  const daily = state.aggBarCalls.filter((c) => c.timespan === "day");
  assert.deepEqual(
    daily.map((c) => c.symbol),
    ["I:SPX"],
    "the daily-close fetch must use the mapped index symbol, never the raw option root"
  );
  assert.equal(state.gradeCalls.length, 1);
  const grade = state.gradeCalls[0]!.grade as { close_price: number | null; direction_hit: boolean | null; move_pct: number | null };
  assert.equal(grade.close_price, 7575.39, "close must come from the I:SPX bar");
  assert.equal(grade.direction_hit, true, "long from 7564.68 into a 7575.39 close is a hit");
  assert.ok(grade.move_pct != null && grade.move_pct > 0);
});
