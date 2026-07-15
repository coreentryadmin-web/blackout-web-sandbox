// B-8 sync-path integration: the exit engine wired through the REAL
// syncLedgerLiveState (scan.ts), with the same wholesale hermetic-mock idiom
// scan.test.ts uses for the exact same module graph (see its header for the WHY per
// mock). Separate file on purpose: node --test runs each file in its own process,
// so these mocks/fixtures can't leak into scan.test.ts (ESM module cache).
//
// What this file proves that exit-engine.test.ts (pure tables) cannot:
//  - a ratchet-floor breach observed by the sync snapshot CLOSES the row (persisted
//    status + frozen last_mark = the exit mark) and stamps entry_context.exit;
//  - the FRESHEST mark wins: a fresh live-marks-lane mark exits a play the sync
//    snapshot alone would have kept open (and the frozen mark is the lane's);
//  - a stale lane mark is refused (staleness rule) — the sync mark decides;
//  - thesis break closes through the same path with the evidence reason;
//  - Cortex outage is fail-soft: evidence unavailable → no thesis exit, the row
//    stays live, and nothing else about the sync changes;
//  - a healthy row passes through the engine untouched.
//
// TIMING DISCIPLINE (same as zerodte-service-marks.test.ts): the lane-mark freshness
// check runs against the real clock inside exit-sync, so the fresh-direction seed is
// future-dated (+30s) and the stale direction uses a far-past asOf — both sides stay
// deterministic under CI scheduler stalls. All imports happen before any seeding.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";

type LedgerRow = Record<string, unknown>;

const state = {
  ledgerRows: [] as LedgerRow[],
  /** Snapshot mark served per OCC by the mocked unified-snapshot fetch. */
  snapMark: null as number | null,
  updateCalls: [] as Array<{ session_date: string; ticker: string; patch: { status: string; mark: number | null } }>,
  stampCalls: [] as Array<{ session_date: string; ticker: string; exit: Record<string, unknown> }>,
  /** Evidence the mocked Cortex compose returns; null → fetch throws (outage). */
  verdictItems: null as EvidenceItem[] | null,
};

function resetState() {
  state.ledgerRows = [];
  state.snapMark = null;
  state.updateCalls = [];
  state.stampCalls = [];
  state.verdictItems = null;
}

mock.module("server-only", { namedExports: {} });

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLog: async () => state.ledgerRows,
    updateZeroDteLiveState: async (session_date: string, ticker: string, patch: { status: string; mark: number | null }) => {
      state.updateCalls.push({ session_date, ticker, patch });
    },
    stampZeroDteExitContext: async (session_date: string, ticker: string, exit: Record<string, unknown>) => {
      state.stampCalls.push({ session_date, ticker, exit });
    },
    // Module-scope imports scan.ts needs resolvable (same list as scan.test.ts).
    fetchLatestNighthawkEdition: async () => null,
    fetchOpenSpxPlay: async () => null,
    fetchRecentFlows: async () => [],
    fetchUngradedZeroDteRows: async () => [],
    gradeZeroDteSetupRow: async () => {},
    insertAlertAuditLog: async () => {},
    updateZeroDtePlanOutcome: async () => {},
    upsertZeroDteSetupLog: async () => new Set<string>(),
  },
});

// The exit engine's evidence read: fetchCortexInputs → composeCortexEvidence. The
// fetch mock throws on demand (total-outage direction); the compose mock returns a
// state-controlled verdict. Compose's OTHER exports must exist because the cortex
// barrel re-exports them by name (ESM linking checks every one).
mock.module("../nighthawk/cortex/fetch", {
  namedExports: {
    fetchCortexInputs: async () => {
      if (state.verdictItems == null) throw new Error("hermetic: cortex outage");
      return {};
    },
    CORTEX_SOURCE_TIMEOUT_MS: 2_500,
  },
});
mock.module("../nighthawk/cortex/compose", {
  namedExports: {
    composeCortexEvidence: () => {
      const items = state.verdictItems ?? [];
      return {
        ticker: "X",
        direction: "long",
        asOf: new Date().toISOString(),
        vetoes: items.filter((i) => i.stance === "veto"),
        supports: items.filter((i) => i.stance === "supports"),
        opposes: items.filter((i) => i.stance === "opposes"),
        score: 0,
        absent: [],
        conviction: "C",
        narrative: [],
      };
    },
    cortexDecayFactor: () => 1,
    ABSENT_AFTER_HALF_LIVES: 3,
    CONVICTION_A_MIN_SCORE: 3,
    CONVICTION_B_MIN_SCORE: 1.5,
    SOURCE_SUPPORT_CAPS: {},
  },
});

mock.module("../bie/ecosystem-context", {
  namedExports: { fetchNighthawkEchoForTickers: async () => new Map() },
});
mock.module("../../features/nighthawk/lib/dossier", {
  namedExports: { createDossierBuildCache: () => ({}), fetchTickerDossier: async () => null },
});
mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-14",
    etNowParts: () => ({ hour: 11, minute: 30 }),
    isTradingDayEt: () => true,
    formatEtDate: (d: Date) => d.toISOString().slice(0, 10),
  },
});
mock.module("../providers/polygon-largo", {
  namedExports: { fetchAggBars: async () => [] },
});
mock.module("../providers/options-snapshot", {
  namedExports: {
    fetchOptionsUnifiedSnapshot: async (occs: string[]) => {
      const map = new Map<string, { mark: number | null; bid: number | null; ask: number | null; underlyingPrice: number | null }>();
      for (const occ of occs) {
        if (state.snapMark != null) {
          map.set(occ, { mark: state.snapMark, bid: state.snapMark, ask: state.snapMark, underlyingPrice: null });
        }
      }
      return map;
    },
  },
});
mock.module("../ws/options-socket", {
  namedExports: {
    buildOcc: () => null,
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
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-14" },
});
mock.module("../platform/zerodte-service", {
  namedExports: { zeroDtePlaysForLargo: async () => ({}) },
});

// Lazy imports (no top-level await under the local CJS transform — scan.test.ts's
// `mod()` idiom): each test loads both graphs BEFORE any clock-sensitive seeding.
// The lane store is seeded through the SAME specifier exit-sync resolves
// ("./live-marks"), so the test writes to the module instance the engine reads.
const mods = async () => {
  const lane = await import("./live-marks");
  const { syncLedgerLiveState } = await import("./scan");
  return { lane, syncLedgerLiveState };
};

const OCC = "O:NVDA260714C00180000";

function baseRow(overrides: LedgerRow = {}): LedgerRow {
  return {
    session_date: "2026-07-14",
    ticker: "NVDA",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 178,
    // 10 minutes old vs the REAL clock (the engine ages rows off first_flagged_at):
    // young enough that flat-timeout can never fire unless a test says so.
    first_flagged_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    entry_premium: 4.0,
    last_mark: 4.0,
    status: "OPEN",
    top_strike: 180,
    conviction: null,
    gross_premium: 2_000_000,
    flow_avg_fill: 4.0,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    plan_json: { occ: OCC, stop_premium: 2.0, target_premium: 8.0 },
    underlying_latest: null,
    flags_json: null,
    expiry: "2026-07-14",
    dossier_score: null,
    close_price: null,
    peak_premium: 4.0,
    trough_premium: 4.0,
    entry_context: null,
    gate_calibration_json: null,
    ...overrides,
  };
}

const laneMark = (mark: number, asOf: number) => ({
  occ: OCC,
  bid: mark,
  ask: mark,
  mid: mark,
  last: mark,
  mark,
  source: "mid" as const,
  asOf,
  lane: "rest" as const,
});

test("ratchet floor breach via the sync mark: row CLOSES at the exit mark and entry_context.exit is stamped", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  // Peaked +30% (5.2) earlier; the snapshot now shows 3.98 (−0.5%) — at/below the
  // breakeven floor the +25% peak armed. Pre-engine this row stayed live all the
  // way down to the −50% stop: the exact green-turned-red class.
  state.ledgerRows = [baseRow({ peak_premium: 5.2 })];
  state.snapMark = 3.98;

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 3.98, "the frozen mark is the mark the engine exited at");
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0]!.patch, { status: "CLOSED", mark: 3.98 });
  assert.equal(state.stampCalls.length, 1, "the counterfactual exit record must persist");
  const exit = state.stampCalls[0]!.exit as { reason: string; mark: number; pnl_pct: number; peak_pnl_pct: number };
  assert.equal(exit.reason, "ratchet_breakeven_floor");
  assert.equal(exit.mark, 3.98);
  assert.equal(exit.pnl_pct, -0.5);
  assert.equal(exit.peak_pnl_pct, 30);
});

test("freshest mark wins: a FRESH lane mark below the floor exits even when the sync snapshot is still above it", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 5.2 })];
  state.snapMark = 4.5; // +12.5% — above the breakeven floor, sync alone would hold
  // Future-dated (+30s) so the real-clock freshness check can never flake (header).
  lane.putZeroDteLiveMark(laneMark(3.9, Date.now() + 30_000));

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 3.9, "the exit freezes at the LANE's fresher mark, not the snapshot's");
  assert.equal((state.stampCalls[0]!.exit as { reason: string }).reason, "ratchet_breakeven_floor");
  lane._resetZeroDteLiveMarksForTest();
});

test("staleness honesty: a STALE lane mark is refused — the sync mark decides and the row stays live", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 5.2 })];
  state.snapMark = 4.5; // above the floor
  lane.putZeroDteLiveMark(laneMark(3.9, Date.now() - 60_000)); // 60s old — stale

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED", "a stale lane mark must never trigger an exit");
  assert.equal(state.stampCalls.length, 0);
  lane._resetZeroDteLiveMarksForTest();
});

test("thesis break closes through the same path — at a loss, with the evidence reason stamped", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 4.1 })];
  state.snapMark = 3.4; // −15%: no floor armed, above the plan stop — only the thesis fires
  state.verdictItems = [
    {
      source: "wall-trend",
      stance: "veto",
      weight: 2,
      halfLifeSec: 600,
      asOf: new Date().toISOString(),
      detail: "opposing wall building through the strike",
    },
  ] as EvidenceItem[];

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 3.4);
  const exit = state.stampCalls[0]!.exit as { reason: string; pnl_pct: number };
  assert.equal(exit.reason, "thesis_break:wall-trend");
  assert.equal(exit.pnl_pct, -15, "a broken thesis exits at market even red");
});

test("fail-soft: Cortex outage → no thesis exit, the row stays live, sync otherwise unchanged", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 4.1 })];
  state.snapMark = 3.4; // same −15% tick as above…
  state.verdictItems = null; // …but the evidence read throws (outage)

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED", "missing evidence must NEVER exit a play");
  assert.equal(state.stampCalls.length, 0);
  assert.equal(state.updateCalls.length, 1, "the normal live-state persist still runs");
  assert.equal(state.updateCalls[0]!.patch.mark, 3.4);
});

test("flat timeout through the sync path: a 50-minute ±10% sleeper is scratched", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.verdictItems = []; // Cortex sees, and sees nothing wrong — only the clock fires
  state.ledgerRows = [baseRow({ first_flagged_at: new Date(Date.now() - 50 * 60_000).toISOString() })];
  state.snapMark = 4.05; // +1.25%, never left the band (peak 4.05)

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal((state.stampCalls[0]!.exit as { reason: string }).reason, "flat_theta_bleed");
});

test("healthy green row passes the engine untouched (no exit, no stamp)", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.verdictItems = [];
  state.ledgerRows = [baseRow({ peak_premium: 4.4 })]; // peak +10% — below the arm threshold
  state.snapMark = 4.3;

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 4.3);
  assert.equal(state.stampCalls.length, 0);
});
