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

// ── Hermetic payload tests (mock.module, RELATIVE specifiers — the CI tsx ESM
// loader cannot resolve "@/" aliases inside mock.module/dynamic import) ──────────
//
// Mocks are hoisted to module scope with a mutable `state` driving each test's
// scenario: node:test's mock.module registrations persist for the process, so
// per-test re-registration of the same specifier is not reliable — one mock,
// many scenarios.

type MockLedgerRow = Record<string, unknown>;

function ledgerRow(over: Partial<Record<string, unknown>> = {}): MockLedgerRow {
  return {
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
    ...over,
  };
}

/** Minimal EnrichedZeroDteSetup stand-in — only the fields the fresh-find lane and
 *  buildIntelNote actually read. */
function freshFind(ticker: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ticker,
    direction: "long",
    top_strike: 100,
    expiry: "2026-07-07",
    score: 75,
    gross_premium: 2_000_000,
    side_dominance: 0.8,
    aggression: 0.6,
    new_money: false,
    spike: false,
    top_strike_avg_fill: 4.2,
    plan: {
      occ: "O:X",
      flow_avg_fill: 4.2,
      bid: 4,
      ask: 4.4,
      mark: 4.2,
      entry_max: 4.2,
      vs_flow_pct: 0,
      entry_status: "IN_RANGE",
      spread_pct: 5,
      illiquid: false,
      stop_premium: 2.1,
      target_premium: 8.4,
      time_stop_et: "15:30",
      underlying_target: null,
      underlying_invalid: null,
    },
    gate: null,
    cortex: null,
    ...over,
  };
}

const state = {
  ledgerRead: { rows: [ledgerRow()] as MockLedgerRow[], committed_known: true },
  setups: [] as Array<Record<string, unknown>>,
};

mock.module("server-only", { namedExports: {} });
mock.module("../bie/ecosystem-context", {
  namedExports: {
    fetchNighthawkEchoForTickers: async () => new Map(),
  },
});
mock.module("../zerodte/scan", {
  namedExports: {
    readZeroDteLedgerChecked: async () => state.ledgerRead,
    readZeroDteLedger: async () => state.ledgerRead.rows,
    syncLedgerLiveState: async (rows: unknown[]) => rows,
    scanZeroDteBoard: async () => ({
      setups: state.setups,
      nighthawk_covered: [],
      upstream_ok: true,
      rejections: [],
    }),
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

test("livePnlPct: board ledger and Largo plays use identical rounding", async () => {
  state.ledgerRead = { rows: [ledgerRow()], committed_known: true };
  state.setups = [];

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

// ── P0 one-way commit door (fix/zerodte-status-latch) ─────────────────────────────

test("commit latch: a committed ticker's concurrent fresh find is dropped as a duplicate — never re-told as WATCH/SKIP (both scan orders, case-insensitive)", async () => {
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");

  // The exact regression shape: NVDA committed (OPEN in the ledger) while the next
  // scan build still ranks it as a fresh find whose re-evaluated gate is now
  // BLOCKED (governor cap reached BECAUSE the play committed). The ledger row must
  // be the ONLY presentation of NVDA; the blocked find is a duplicate, dropped.
  const blockedDup = freshFind("nvda", {
    gate: { verdict: "BLOCKED", blocks: [{ code: "governor_max_concurrent", reason: "cap", threshold: null, unlock_et: null }] },
  });
  const other = freshFind("TSLA");

  for (const setups of [
    [blockedDup, other],
    [other, blockedDup],
  ]) {
    state.ledgerRead = { rows: [ledgerRow({ status: "OPEN" })], committed_known: true };
    state.setups = setups;
    const largo = (await zeroDtePlaysForLargo()) as {
      plays: Array<{ ticker: string; status: string }>;
      fresh_finds: Array<{ ticker: string; status: string }>;
    };
    assert.deepEqual(
      largo.plays.map((p) => [p.ticker, p.status]),
      [["NVDA", "OPEN"]],
      "committed play presented from the ledger row, status intact"
    );
    assert.ok(
      !largo.fresh_finds.some((f) => f.ticker.toUpperCase() === "NVDA"),
      "the committed ticker never re-enters the fresh lane"
    );
    assert.deepEqual(largo.fresh_finds.map((f) => f.ticker), ["TSLA"]);
  }
});

test("commit latch: an uncommitted fresh find is WATCH with non-actionable intel — never OPEN/ADD", async () => {
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");
  state.ledgerRead = { rows: [], committed_known: true };
  state.setups = [freshFind("TSLA")];
  const largo = (await zeroDtePlaysForLargo()) as {
    fresh_finds: Array<{ ticker: string; status: string; intel: string }>;
  };
  assert.equal(largo.fresh_finds[0]!.status, "WATCH");
  assert.doesNotMatch(largo.fresh_finds[0]!.intel, /Enter ≤/);
  assert.match(largo.fresh_finds[0]!.intel, /NOT committed/);
});

// ── PR-F tier wiring: pinned tier passthrough + F for refused finds ────────────────

test("tier passthrough: entry_context.tier rides the board ledger row AND the Largo play unchanged (mirror of the cortex passthrough)", async () => {
  const pinnedTier = {
    tier: "B",
    factors: [
      { label: "Prime score band", direction: "up", detail: "Score 78 sits in 75-84 — the best measured band." },
      { label: "Cortex evidence missing", direction: "down", detail: "Cortex abstained — A is out of reach." },
    ],
  };
  state.ledgerRead = {
    rows: [ledgerRow({ entry_context: { tier: pinnedTier, cortex: null } })],
    committed_known: true,
  };
  state.setups = [];

  const { buildZeroDteBoardPayload, zeroDtePlaysForLargo } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.deepEqual(board.ledger[0]!.tier, pinnedTier, "board row carries the pinned blob verbatim");
  const largo = (await zeroDtePlaysForLargo()) as { plays: Array<{ tier: unknown }> };
  assert.deepEqual(largo.plays[0]!.tier, pinnedTier, "Largo play cites the same pinned tier — zero extra IO");
});

test("tier passthrough: a pre-wiring row (no entry_context.tier) serves tier:null — no chip, never a re-derived grade", async () => {
  state.ledgerRead = { rows: [ledgerRow({ entry_context: { cortex: null } })], committed_known: true };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.tier, null);
});

test("fresh-lane tiers: a refused (SKIP) find carries tierForSkip's F with each block as a down factor; a WATCH candidate carries NO tier", async () => {
  state.ledgerRead = { rows: [], committed_known: true };
  state.setups = [
    freshFind("TSLA"), // clean RTH find → WATCH (not a decision — must get no tier)
    freshFind("META", {
      gate: {
        verdict: "BLOCKED",
        blocks: [{ code: "score_floor", reason: "Score 62 is under the 65 floor.", threshold: 65, unlock_et: null }],
      },
    }),
  ];
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");
  const largo = (await zeroDtePlaysForLargo()) as {
    fresh_finds: Array<{ ticker: string; status: string; tier: { tier: string; factors: Array<Record<string, unknown>> } | null }>;
  };
  const meta = largo.fresh_finds.find((f) => f.ticker === "META")!;
  assert.equal(meta.status, "SKIP");
  assert.equal(meta.tier!.tier, "F");
  assert.deepEqual(meta.tier!.factors, [
    { label: "score_floor", direction: "down", detail: "Score 62 is under the 65 floor." },
  ]);
  const tsla = largo.fresh_finds.find((f) => f.ticker === "TSLA")!;
  assert.equal(tsla.status, "WATCH");
  assert.equal(tsla.tier, null, "an uncommitted, unrefused candidate is not a decision — no invented grade");
});

test("commit latch: unknowable committed set (ledger read failed, no same-session snapshot) fails CLOSED — no fresh finds render, upstream degraded", async () => {
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  // WHY: with the committed set unreadable, a committed play's ticker (which
  // usually still ranks in the scan) would render as an uncommitted find — the
  // member's OPEN card demoted to a watch card. Same fail-closed rule
  // persistZeroDteScan applies to commits, applied to display.
  state.ledgerRead = { rows: [], committed_known: false };
  state.setups = [freshFind("NVDA"), freshFind("TSLA")];
  const board = await buildZeroDteBoardPayload();
  assert.deepEqual(board.setups, [], "no fresh find may render when fresh-vs-committed is unknowable");
  assert.equal(board.upstream_ok, false, "the freshness badge must say degraded, not impersonate a live empty board");
});
