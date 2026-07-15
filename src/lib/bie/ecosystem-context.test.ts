import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
// SPX_FULL_STATE_FIXTURE lives in a plain (non-".test.ts") sibling file on
// purpose: tsconfig.json excludes "**/*.test.ts" from `npx tsc --noEmit`, so
// a fixture typed only inside this file would get zero real type-checking —
// tsx (esbuild) strips types at run time without validating them, and the
// project's type-check command never looks at test files. Importing a
// SpxPlayPayload-typed constant from a real .ts file gives this test an
// ACTUAL compile-time regression net: see spx-full-state-fixture.ts's module
// doc for the full rationale.
import { SPX_FULL_STATE_FIXTURE } from "./spx-full-state-fixture";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { FlowTapeSummary } from "@/lib/platform/types";
import type { FlowRow } from "@/lib/db";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { NextEarnings } from "@/lib/providers/uw-earnings";
import type { TickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import type { RelatedCompanies } from "@/lib/providers/polygon-related";
import type { NewsResult } from "@/lib/providers/polygon-news";
import type { PolygonMacroBackdrop } from "@/lib/providers/polygon-macro";
import type { MarketBreadthBundle } from "@/lib/bie/market-breadth";

// mock.module() must be registered before ecosystem-context.ts (and therefore
// its "@/lib/db" import) is ever loaded — an ordinary top-level `import` of
// ecosystem-context here would resolve the real db.ts first (ES module
// imports are hoisted ahead of any other module-body code, including a
// mock.module() call written textually above them). So everything under test
// is loaded dynamically inside `before()` instead, same pattern as
// src/lib/nighthawk/platform-intel-snapshot.test.ts.

const emptyRows = { rows: [], rowCount: 0 };

let mockOpenPlay: Record<string, unknown> | null = null;
let mockClosedRows: Record<string, unknown>[] = [];
let openPlayCalls = 0;
let closedPlayCalls = 0;

// spx_full_state's source: src/lib/platform/spx-service.ts::getSpxPlayState() —
// the SAME function backing Largo's own get_spx_play tool. Mocked as its own
// module (not re-derived from mockOpenPlay/mockClosedRows) because the real
// getSpxPlayState() calls loadMergedSpxDesk() -> buildPlayTechnicals() ->
// readSpxPlaySnapshot(), none of which this test file wants to exercise —
// only that fetchEcosystemContext() reuses it verbatim, ticker-gated exactly
// like fetchSpxPlaySummary above it.
let mockFullState: SpxPlayPayload | null = null;
let fullStateCalls = 0;

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    // Faithful copy of db.ts's isoDateString (a pure normalizer) — ecosystem-context
    // imports it from "@/lib/db", which this wholesale module mock replaces, so it
    // must exist here AND behave like the real one for the DATE-normalization test
    // below to prove anything.
    isoDateString: (value: unknown): string => {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
      }
      const s = String(value ?? "");
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const reparsed = new Date(s);
      if (!Number.isNaN(reparsed.getTime())) return reparsed.toISOString().slice(0, 10);
      return s.slice(0, 10);
    },
    // The 5 pre-existing ecosystem-context queries (zerodte/nighthawk/audit/
    // flow/anomalies) all go through dbQuery — none of them matter for the
    // spx_play assertions below, so a single empty-rows stub covers all of them.
    dbQuery: async () => emptyRows,
    fetchOpenSpxPlay: async () => {
      openPlayCalls++;
      return mockOpenPlay;
    },
    fetchClosedPlayOutcomes: async () => {
      closedPlayCalls++;
      return mockClosedRows;
    },
  },
});

mock.module("../../features/spx/lib/spx-service", {
  namedExports: {
    getSpxPlayState: async () => {
      fullStateCalls++;
      return mockFullState;
    },
  },
});

// flow_full_state's two sources, mocked separately so this test file can prove
// EACH is reused verbatim rather than re-derived: getFlowTapeSummary() (the
// exact function backing Largo's get_flow_tape tool — src/lib/platform/
// flow-service.ts) and enrichFlowsWithGex() (the exact GEX enrichment the live
// /flows member route applies — src/lib/flow-gex-enrichment.ts). Neither
// mock ever touches a real DB row or a real GEX/upstream call.
let mockFlowTapeSummary: FlowTapeSummary = { count: 0, total_premium: 0, top_tickers: [], recent: [] };
let flowTapeCalls: Array<{ ticker?: string; limit?: number } | undefined> = [];
let mockEnrichedRecent: unknown[] | null = null; // null = pass rows through unchanged
let enrichCalls: unknown[][] = [];

mock.module("../platform/flow-service", {
  namedExports: {
    getFlowTapeSummary: async (opts?: { ticker?: string; limit?: number }) => {
      flowTapeCalls.push(opts);
      return mockFlowTapeSummary;
    },
  },
});

mock.module("../flow-gex-enrichment", {
  namedExports: {
    enrichFlowsWithGex: async (flows: unknown[]) => {
      enrichCalls.push(flows);
      return mockEnrichedRecent ?? flows;
    },
  },
});

// gex_positioning's single source: getGexPositioning() (src/lib/providers/
// gex-positioning.ts), the same canonical cache-reader the Heat Maps UI, the
// SPX rail, and Night Hawk's fetchPositioningSummary primary branch already
// read. Mocked as its own module — never a real GEX-heatmap fetch or UW
// cross-validation call — so this test file can prove fetchEcosystemContext()
// calls it VERBATIM (no wrapper reshaping the result) and unconditionally
// (not gated by isSpxSlayerTicker the way spx_play/spx_full_state are).
let mockGexPositioning: GexPositioning | null = null;
let gexPositioningCalls: string[] = [];

mock.module("../providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async (ticker: string) => {
      gexPositioningCalls.push(ticker);
      return mockGexPositioning;
    },
  },
});

// vector_full_state's single source: fetchVectorFullState() (src/lib/bie/
// vector-full-state.ts), the same composer Largo's get_vector_full_state tool
// runs. Mocked as its own module (not re-derived) so this test file can prove
// fetchEcosystemContext() calls it VERBATIM (no wrapper) and UNCONDITIONALLY (for
// every ticker, not gated by isSpxSlayerTicker), without pulling the real Vector
// server graph (uw-socket / polygon providers) into the test at all.
let mockVectorFullState: VectorFullState | null = null;
let vectorFullStateCalls: Array<[string, string]> = [];

mock.module("./vector-full-state", {
  namedExports: {
    fetchVectorFullState: async (ticker: string, horizon: string) => {
      vectorFullStateCalls.push([ticker, horizon]);
      return mockVectorFullState;
    },
  },
});

// The #60 data-arsenal readers, mocked as their own modules so this test file stays hermetic (no real
// Polygon/UW HTTP even if CI has keys) AND can prove the relevance gate: which readers run for an
// index ticker vs a single name. All default to null → an all-null arsenal (relevant legs surface in
// unavailable_sources), which the existing assertions above don't touch.
let mockEarnings: NextEarnings | null = null;
let mockFundamentals: TickerFundamentalsBundle | null = null;
let mockRelated: RelatedCompanies | null = null;
let mockTickerNews: NewsResult | null = null;
let mockCatalysts: NewsResult | null = null;
let mockMacro: PolygonMacroBackdrop | null = null;
let mockBreadth: MarketBreadthBundle | null = null;
let earningsCalls: string[] = [];
let fundamentalsCalls: string[] = [];
let relatedCalls: string[] = [];
let tickerNewsCalls: string[] = [];
let catalystCalls = 0;
let macroCalls = 0;
let breadthCalls = 0;

mock.module("../providers/uw-earnings", {
  namedExports: {
    fetchNextEarningsDate: async (ticker: string) => {
      earningsCalls.push(ticker);
      return mockEarnings;
    },
  },
});
mock.module("./ticker-fundamentals", {
  namedExports: {
    fetchTickerFundamentalsBundle: async (ticker: string) => {
      fundamentalsCalls.push(ticker);
      return mockFundamentals;
    },
  },
});
mock.module("../providers/polygon-related", {
  namedExports: {
    fetchRelatedCompanies: async (ticker: string) => {
      relatedCalls.push(ticker);
      return mockRelated;
    },
  },
});
mock.module("../providers/polygon-news", {
  namedExports: {
    fetchTickerNews: async (ticker: string) => {
      tickerNewsCalls.push(ticker);
      return mockTickerNews;
    },
    fetchMarketCatalysts: async () => {
      catalystCalls++;
      return mockCatalysts;
    },
  },
});
mock.module("../providers/polygon-macro", {
  namedExports: {
    fetchPolygonMacroBackdrop: async () => {
      macroCalls++;
      return mockMacro;
    },
  },
});
mock.module("./market-breadth", {
  namedExports: {
    fetchMarketBreadthBundle: async () => {
      breadthCalls++;
      return mockBreadth;
    },
  },
});

let fetchEcosystemContext: typeof import("./ecosystem-context").fetchEcosystemContext;
let ECOSYSTEM_CONTEXT_FIELDS: typeof import("./ecosystem-context").ECOSYSTEM_CONTEXT_FIELDS;
let mapNighthawkEchoRows: typeof import("./ecosystem-context").mapNighthawkEchoRows;
let assembleEcosystemArsenal: typeof import("./ecosystem-context").assembleEcosystemArsenal;
let isEcosystemIndexTicker: typeof import("./ecosystem-context").isEcosystemIndexTicker;

before(async () => {
  ({ fetchEcosystemContext, ECOSYSTEM_CONTEXT_FIELDS, mapNighthawkEchoRows, assembleEcosystemArsenal, isEcosystemIndexTicker } =
    await import("./ecosystem-context"));
});

test("ECOSYSTEM_CONTEXT_FIELDS: covers every real field with a non-empty description", () => {
  const expected = [
    "zerodte_today",
    "nighthawk_recent",
    "recent_audit_entries",
    "recent_flow",
    "flow_full_state",
    "recent_anomalies",
    "spx_play",
    "spx_full_state",
    "flow_feed_fresh",
    "gex_positioning",
    "vector_full_state",
    "arsenal",
  ];
  assert.deepEqual(
    ECOSYSTEM_CONTEXT_FIELDS.map((f) => f.field).sort(),
    [...expected].sort()
  );
  for (const f of ECOSYSTEM_CONTEXT_FIELDS) {
    assert.ok(f.description.length > 10, `${f.field} needs a real description, not a stub`);
  }
});

// Regression: fetchEcosystemContext() read zerodte_setup_log, nighthawk_play_outcomes,
// alert_audit_log, flow_alerts and flow_anomalies but never SPX Slayer's own
// spx_open_play/spx_play_outcomes tables — so this cross-instrument snapshot's
// own play engine was invisible to itself. spx_play closes that gap by reusing
// the exact fetchOpenSpxPlay/fetchClosedPlayOutcomes fetchers spx-service.ts
// already calls, scoped to SPX/SPXW only since those tables carry no ticker column.

test('fetchEcosystemContext("SPX"): spx_play.open_play is populated when an open play exists', async () => {
  openPlayCalls = 0;
  closedPlayCalls = 0;
  mockOpenPlay = {
    id: 1,
    session_date: "2026-07-04",
    direction: "long",
    entry_price: 5500,
    entry_score: 80,
    stop: 5480,
    target: 5550,
    grade: "A",
    headline: "SPX cold buy long",
    trim_done: false,
    mfe_pts: 10,
    mae_pts: 2,
    opened_at: "2026-07-04T14:35:00.000Z",
    status: "open",
  };
  mockClosedRows = [];

  const ctx = await fetchEcosystemContext("SPX");
  assert.equal(openPlayCalls, 1, "fetchOpenSpxPlay should run exactly once for ticker SPX");
  assert.deepEqual(ctx.spx_play, {
    open_play: {
      direction: "long",
      grade: "A",
      entry_price: 5500,
      stop: 5480,
      target: 5550,
      headline: "SPX cold buy long",
      status: "open",
      opened_at: "2026-07-04T14:35:00.000Z",
    },
    last_closed: null,
  });
});

test('fetchEcosystemContext("SPXW"): spx_play.last_closed reflects the most recent closed play', async () => {
  mockOpenPlay = null;
  mockClosedRows = [
    {
      id: 2,
      open_play_id: 1,
      session_date: "2026-07-03",
      direction: "short",
      entry_path: "cold_buy",
      grade: "B",
      score: 60,
      confidence: 70,
      entry_price: 5600,
      exit_price: 5580,
      stop: 5620,
      target: 5560,
      mfe_pts: 25,
      mae_pts: 5,
      trim_done: true,
      pnl_pts: 20,
      outcome: "win",
      exit_action: "TARGET",
      headline: "SPX watch promote short",
      opened_at: "2026-07-03T15:00:00.000Z",
      closed_at: "2026-07-03T15:40:00.000Z",
    },
  ];

  // SPXW (0DTE weeklies) shares the same single-instrument engine as SPX.
  const ctx = await fetchEcosystemContext("SPXW");
  assert.deepEqual(ctx.spx_play, {
    open_play: null,
    last_closed: {
      direction: "short",
      grade: "B",
      entry_price: 5600,
      exit_price: 5580,
      pnl_pts: 20,
      outcome: "win",
      headline: "SPX watch promote short",
      closed_at: "2026-07-03T15:40:00.000Z",
    },
  });
});

test("fetchEcosystemContext: spx_play is null for a non-SPX ticker, and the SPX-only fetchers never run", async () => {
  openPlayCalls = 0;
  closedPlayCalls = 0;
  // Deliberately leave an open play mocked to prove the ticker gate — not the
  // data — is what keeps a non-SPX ticker's spx_play null.
  mockOpenPlay = {
    id: 3,
    session_date: "2026-07-04",
    direction: "long",
    entry_price: 100,
    entry_score: 1,
    stop: null,
    target: null,
    grade: "A",
    headline: "irrelevant to AAPL",
    trim_done: false,
    mfe_pts: 0,
    mae_pts: 0,
    opened_at: "2026-07-04T10:00:00.000Z",
    status: "open",
  };
  mockClosedRows = [];

  const ctx = await fetchEcosystemContext("AAPL");
  assert.equal(ctx.spx_play, null);
  assert.equal(openPlayCalls, 0, "fetchOpenSpxPlay must not run for a non-SPX ticker");
  assert.equal(closedPlayCalls, 0, "fetchClosedPlayOutcomes must not run for a non-SPX ticker");
});

// Regression: Largo's own get_spx_play tool (src/lib/largo/run-tool.ts ->
// src/lib/platform/spx-service.ts::getSpxPlayState()) already returns SPX
// Slayer's FULL play-engine payload — phase, confluence factors, gates,
// confirmations, technicals, telemetry, option ticket, everything the member
// dashboard renders — while BIE's get_ecosystem_context tool only ever got
// spx_play's slim open/last-closed mirror. spx_full_state closes that gap by
// reusing getSpxPlayState() verbatim (not a second derivation), so BIE and
// Largo see the exact same entire numerical picture per the user's explicit
// "share its entire data...to both BIE and largo" instruction.

test('fetchEcosystemContext("SPX"): spx_full_state reuses getSpxPlayState() verbatim, full fidelity', async () => {
  fullStateCalls = 0;
  mockFullState = SPX_FULL_STATE_FIXTURE;

  const ctx = await fetchEcosystemContext("SPX");
  // Exactly once, not just ">0": fetchSpxFullState() (and therefore Largo's own
  // get_spx_play tool path, which shares this same function) must be invoked a
  // single time per fetchEcosystemContext() call — a second/duplicate call
  // would risk two independently-timed live-desk evaluations (loadMergedSpxDesk
  // is cache-backed but not instantaneous) disagreeing with each other within
  // the same response, undermining the "one derivation" guarantee this field
  // exists to provide.
  assert.equal(fullStateCalls, 1, "getSpxPlayState should run exactly once for ticker SPX");
  assert.deepEqual(ctx.spx_full_state, SPX_FULL_STATE_FIXTURE, "spx_full_state must pass through the entire payload untouched, not a summarized subset");
});

test('fetchEcosystemContext("SPXW"): spx_full_state also populates (same single-instrument engine as SPX)', async () => {
  fullStateCalls = 0;
  mockFullState = { ...SPX_FULL_STATE_FIXTURE, headline: "SPXW 0DTE variant" };

  const ctx = await fetchEcosystemContext("SPXW");
  assert.equal(fullStateCalls, 1, "getSpxPlayState should run exactly once for ticker SPXW");
  assert.deepEqual(ctx.spx_full_state, mockFullState);
});

test("fetchEcosystemContext: spx_full_state is null for a non-SPX ticker, and getSpxPlayState never runs", async () => {
  fullStateCalls = 0;
  // Deliberately leave a full-state fixture mocked to prove the ticker gate —
  // not the data — is what keeps a non-SPX ticker's spx_full_state null.
  mockFullState = SPX_FULL_STATE_FIXTURE;

  const ctx = await fetchEcosystemContext("AAPL");
  assert.equal(ctx.spx_full_state, null);
  assert.equal(fullStateCalls, 0, "getSpxPlayState must not run for a non-SPX ticker");
});

// Regression: fetchEcosystemContext()'s recent_flow hand-rolled its own raw
// SQL aggregate against flow_alerts, never reusing getFlowTapeSummary() (the
// exact function backing Largo's own get_flow_tape tool) or enrichFlowsWithGex
// (the GEX/dark-pool enrichment the live /flows member route already applies
// to every alert). flow_full_state closes that gap the same way spx_full_state
// closed it for the play engine: reuse the real functions verbatim instead of
// re-deriving a second, independently-drifting flow view.

function makeFlowRow(overrides: Partial<FlowRow> = {}): FlowRow {
  return {
    ticker: "NVDA",
    premium: 250000,
    option_type: "CALL",
    expiry: "2026-07-10",
    strike: 130,
    direction: "bullish",
    score: 80,
    route: "sweep",
    alerted_at: "2026-07-05T14:00:00.000Z",
    ...overrides,
  };
}

test('fetchEcosystemContext("NVDA"): flow_full_state reuses getFlowTapeSummary() ticker-scoped, then enriches recent via enrichFlowsWithGex()', async () => {
  flowTapeCalls = [];
  enrichCalls = [];
  const rowA = makeFlowRow({ strike: 130 });
  const rowB = makeFlowRow({ strike: 140, premium: 90000 });
  mockFlowTapeSummary = {
    count: 2,
    total_premium: 340000,
    top_tickers: [{ ticker: "NVDA", premium: 340000, count: 2 }],
    recent: [rowA, rowB],
  };
  // Simulate enrichFlowsWithGex tagging only the row sitting near a GEX wall —
  // exactly the shape the real src/lib/flow-gex-proximity.ts helper produces.
  mockEnrichedRecent = [{ ...rowA, gex_proximity: "near_call_wall" }, rowB];

  const ctx = await fetchEcosystemContext("NVDA");

  assert.equal(flowTapeCalls.length, 1, "getFlowTapeSummary should run exactly once");
  assert.deepEqual(flowTapeCalls[0], { ticker: "NVDA", limit: 50 }, "must be ticker-scoped, not a global tape fetch");
  assert.equal(enrichCalls.length, 1, "enrichFlowsWithGex should run exactly once, over the exact rows getFlowTapeSummary returned");
  assert.deepEqual(enrichCalls[0], [rowA, rowB]);
  assert.deepEqual(ctx.flow_full_state, {
    count: 2,
    total_premium: 340000,
    top_tickers: [{ ticker: "NVDA", premium: 340000, count: 2 }],
    recent: [{ ...rowA, gex_proximity: "near_call_wall" }, rowB],
  });
});

test("fetchEcosystemContext: flow_full_state is null (not an all-zero object) when getFlowTapeSummary finds no prints, mirroring recent_flow's null-when-quiet convention", async () => {
  flowTapeCalls = [];
  enrichCalls = [];
  mockFlowTapeSummary = { count: 0, total_premium: 0, top_tickers: [], recent: [] };
  mockEnrichedRecent = null;

  const ctx = await fetchEcosystemContext("XYZ");

  assert.equal(ctx.flow_full_state, null);
  assert.equal(enrichCalls.length, 0, "enrichFlowsWithGex must not run when there is nothing to enrich");
});

test('fetchEcosystemContext("SPX"): flow_full_state is NOT gated by isSpxSlayerTicker — populates for SPX same as any other ticker', async () => {
  flowTapeCalls = [];
  enrichCalls = [];
  fullStateCalls = 0;
  mockFullState = SPX_FULL_STATE_FIXTURE;
  const row = makeFlowRow({ ticker: "SPX" });
  mockFlowTapeSummary = {
    count: 1,
    total_premium: 250000,
    top_tickers: [{ ticker: "SPX", premium: 250000, count: 1 }],
    recent: [row],
  };
  mockEnrichedRecent = null; // pass through unchanged this time

  const ctx = await fetchEcosystemContext("SPX");

  assert.deepEqual(flowTapeCalls[0], { ticker: "SPX", limit: 50 });
  assert.deepEqual(ctx.flow_full_state, {
    count: 1,
    total_premium: 250000,
    top_tickers: [{ ticker: "SPX", premium: 250000, count: 1 }],
    recent: [row],
  });
  // Distinct gate check: spx_full_state still requires isSpxSlayerTicker and
  // still populates here — proving flow_full_state's unconditional fetch
  // didn't accidentally disturb the SPX-only fields' own gating.
  assert.equal(fullStateCalls, 1);
});

// Regression: fetchEcosystemContext() had NO gamma/GEX-positioning field at
// all — BlackOut Thermal already computes dealer gamma/vanna/delta/charm
// positioning for every ticker (getGexPositioning(), the same canonical
// cache-reader the Heat Maps UI, the SPX rail, and Night Hawk's positioning
// read all already use), but "what does the desk know about this ticker" via
// BIE never surfaced it. gex_positioning closes that gap by calling
// getGexPositioning() verbatim — no wrapper, no reshaping — unconditionally
// for every ticker, since GEX positioning (unlike the SPX play engine) is not
// a single-instrument product.

function makeGexPositioning(overrides: Partial<GexPositioning> = {}): GexPositioning {
  return {
    ticker: "NVDA",
    spot: 150,
    change_pct: 1.2,
    asof: "2026-07-05T14:00:00.000Z",
    flip: 148,
    call_wall: 155,
    put_wall: 140,
    max_pain: 150,
    gex_king_strike: 155,
    net_gex: -500_000_000,
    gamma_posture: "short",
    gamma_regime_read: "short gamma below flip",
    net_vex: 10_000_000,
    vanna_posture: "positive",
    vanna_regime_read: "positive vanna",
    net_dex: null,
    dex_posture: null,
    dex_regime_read: null,
    net_charm: null,
    charm_posture: null,
    charm_regime_read: null,
    nearest_wall: { strike: 155, kind: "resistance", distance_pts: 5 },
    distance_to_flip_pct: 1.35,
    shift_summary: null,
    source: "polygon",
    ...overrides,
  };
}

test('fetchEcosystemContext("NVDA"): gex_positioning reuses getGexPositioning() verbatim, ticker-scoped', async () => {
  gexPositioningCalls = [];
  mockGexPositioning = makeGexPositioning();

  const ctx = await fetchEcosystemContext("NVDA");

  assert.deepEqual(gexPositioningCalls, ["NVDA"], "getGexPositioning should run exactly once, with the uppercased ticker");
  assert.deepEqual(ctx.gex_positioning, mockGexPositioning, "gex_positioning must pass through the entire canonical object untouched, not a summarized subset");
});

test("fetchEcosystemContext: gex_positioning is null when getGexPositioning finds a cold/no-data matrix, not a fabricated reading", async () => {
  gexPositioningCalls = [];
  mockGexPositioning = null;

  const ctx = await fetchEcosystemContext("ZZZZ");

  assert.deepEqual(gexPositioningCalls, ["ZZZZ"]);
  assert.equal(ctx.gex_positioning, null);
});

test('fetchEcosystemContext("SPX"): gex_positioning is NOT gated by isSpxSlayerTicker — populates for every ticker, unlike spx_play/spx_full_state', async () => {
  gexPositioningCalls = [];
  fullStateCalls = 0;
  mockFullState = SPX_FULL_STATE_FIXTURE;
  mockGexPositioning = makeGexPositioning({ ticker: "SPX", spot: 5500, call_wall: 5550, put_wall: 5450 });

  const ctx = await fetchEcosystemContext("SPX");

  assert.deepEqual(gexPositioningCalls, ["SPX"]);
  assert.deepEqual(ctx.gex_positioning, mockGexPositioning);
  // Distinct gate check, mirroring flow_full_state's own equivalent test above:
  // spx_full_state still requires isSpxSlayerTicker and still populates here —
  // proving gex_positioning's unconditional fetch didn't disturb the SPX-only
  // fields' own gating in the same Promise.all.
  assert.equal(fullStateCalls, 1);
});

test('fetchEcosystemContext("AAPL"): gex_positioning populates for an ordinary single-name ticker exactly like SPX or a quiet ticker', async () => {
  gexPositioningCalls = [];
  mockGexPositioning = makeGexPositioning({ ticker: "AAPL", spot: 210, call_wall: 215, put_wall: 205 });

  const ctx = await fetchEcosystemContext("AAPL");

  assert.deepEqual(gexPositioningCalls, ["AAPL"]);
  assert.deepEqual(ctx.gex_positioning, mockGexPositioning);
});

// Regression: fetchEcosystemContext() had NO Vector signal at all — Vector already
// computes a full desk state (regime/walls/beads/VEX/dark-pool/play) for any
// optionable ticker, but "what does the desk know about this name" via BIE never
// surfaced it. vector_full_state closes that gap by calling fetchVectorFullState()
// verbatim, unconditionally, horizon "all" — the Vector analogue of spx_full_state.

test('fetchEcosystemContext("NVDA"): vector_full_state reuses fetchVectorFullState() verbatim, horizon "all"', async () => {
  vectorFullStateCalls = [];
  mockVectorFullState = VECTOR_FULL_STATE_FIXTURE;

  const ctx = await fetchEcosystemContext("NVDA");

  assert.deepEqual(vectorFullStateCalls, [["NVDA", "all"]], "fetchVectorFullState should run once, uppercased ticker + 'all' horizon");
  assert.deepEqual(ctx.vector_full_state, VECTOR_FULL_STATE_FIXTURE, "vector_full_state must pass through the entire object untouched");
});

test("fetchEcosystemContext: vector_full_state is null when fetchVectorFullState has no live spot", async () => {
  vectorFullStateCalls = [];
  mockVectorFullState = null;

  const ctx = await fetchEcosystemContext("ZZZZ");

  assert.deepEqual(vectorFullStateCalls, [["ZZZZ", "all"]]);
  assert.equal(ctx.vector_full_state, null);
});

test('fetchEcosystemContext: vector_full_state is NOT gated by isSpxSlayerTicker — populates for every ticker', async () => {
  vectorFullStateCalls = [];
  fullStateCalls = 0;
  mockFullState = SPX_FULL_STATE_FIXTURE;
  mockVectorFullState = VECTOR_FULL_STATE_FIXTURE;

  const ctx = await fetchEcosystemContext("SPX");

  assert.deepEqual(vectorFullStateCalls, [["SPX", "all"]]);
  assert.deepEqual(ctx.vector_full_state, VECTOR_FULL_STATE_FIXTURE);
  // Distinct gate check: the SPX-only spx_full_state still populates here too.
  assert.equal(fullStateCalls, 1);
});

test("mapNighthawkEchoRows: maps rows keyed by uppercased ticker", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "aapl", edition_for: "2026-07-01", direction: "long", conviction: "high", outcome: "target", score: 82 },
  ]);
  assert.deepEqual(map.get("AAPL"), {
    edition_for: "2026-07-01",
    direction: "long",
    conviction: "high",
    outcome: "target",
    score: 82,
  });
});

test("mapNighthawkEchoRows: null score stays null, not 0", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "NVDA", edition_for: "2026-07-02", direction: "short", conviction: "medium", outcome: "pending", score: null },
  ]);
  assert.equal(map.get("NVDA")?.score, null);
});

test("mapNighthawkEchoRows: pg DATE edition_for (a JS Date object) normalizes to YYYY-MM-DD", () => {
  // node-postgres returns DATE columns as Date objects; pre-fix this mapped via
  // String(Date) and the member-visible 0DTE board's nighthawk_echo shipped
  // "Fri Jul 10 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" (live-caught
  // 2026-07-13 on staging /api/market/zerodte/board).
  const map = mapNighthawkEchoRows([
    { ticker: "META", edition_for: new Date("2026-07-10T00:00:00Z"), direction: "LONG", conviction: "A", outcome: "pending", score: 55 },
  ]);
  assert.equal(map.get("META")?.edition_for, "2026-07-10");
});

test("mapNighthawkEchoRows: empty input returns empty map", () => {
  assert.equal(mapNighthawkEchoRows([]).size, 0);
});

test("mapNighthawkEchoRows: last row wins per ticker if duplicates slip through", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "TSLA", edition_for: "2026-07-01", direction: "long", conviction: "low", outcome: "stop", score: 40 },
    { ticker: "TSLA", edition_for: "2026-06-30", direction: "short", conviction: "high", outcome: "target", score: 90 },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("TSLA")?.edition_for, "2026-06-30");
});

// ── #60 data arsenal ────────────────────────────────────────────────────────
// Pure assembler (relevance gate + honesty) is tested directly; the fetch wiring's gate (which
// readers run for an index vs a single name) is proven at the integration level below.

test("isEcosystemIndexTicker: index/ETF class vs single name", () => {
  for (const t of ["SPX", "SPXW", "SPY", "QQQ", "NDX", "IWM", "VIX"]) assert.equal(isEcosystemIndexTicker(t), true, `${t} is index`);
  for (const t of ["NVDA", "AAPL", "TSLA", "ASTS"]) assert.equal(isEcosystemIndexTicker(t), false, `${t} is single name`);
});

test("assembleEcosystemArsenal(single_name): earnings/fundamentals/peers/news populate; macro/breadth stay null; no false unavailables", () => {
  const ars = assembleEcosystemArsenal({
    scope: "single_name",
    earnings: { earnings_date: "2026-07-20", days_until: 5, report_time: "afterhours", is_confirmed: true } as NextEarnings,
    fundamentals: { as_of: "2026-07-10", short_interest: { days_to_cover: 6.1 }, short_volume_ratio: 0.42, price_target: null } as unknown as TickerFundamentalsBundle,
    related: { ticker: "NVDA", related: ["AMD", "AVGO", "MU"], as_of: "2026-07-10" } as unknown as RelatedCompanies,
    news: { items: [{ headline: "NVDA guidance raised" }, { headline: "new GPU" }], asOf: "2026-07-13T00:00:00Z", newest: "2026-07-12T00:00:00Z" } as unknown as NewsResult,
    macro: null,
    breadth: null,
  });
  assert.equal(ars.scope, "single_name");
  assert.deepEqual(ars.earnings, { earnings_date: "2026-07-20", days_until: 5, report_time: "afterhours", is_confirmed: true });
  assert.equal(ars.fundamentals?.days_to_cover, 6.1);
  assert.equal(ars.fundamentals?.short_volume_ratio, 0.42);
  assert.deepEqual(ars.related, ["AMD", "AVGO", "MU"]);
  assert.equal(ars.news?.count, 2);
  assert.deepEqual(ars.news?.headlines, ["NVDA guidance raised", "new GPU"]);
  // Macro/breadth aren't relevant to a single name → plain null, and NOT surfaced as "unavailable".
  assert.equal(ars.macro, null);
  assert.equal(ars.breadth, null);
  assert.deepEqual(ars.unavailable_sources, []);
});

test("assembleEcosystemArsenal(index): macro/breadth/catalysts populate; single-name legs null", () => {
  const ars = assembleEcosystemArsenal({
    scope: "index",
    earnings: null,
    fundamentals: null,
    related: null,
    news: { items: [{ headline: "FOMC minutes" }], asOf: "2026-07-13T00:00:00Z", newest: "2026-07-12T00:00:00Z" } as unknown as NewsResult,
    macro: { as_of: "2026-07-11", treasury: { yield_10_year: 4.2, curve_10y_1y_spread: -0.3 }, inflation: { cpi: 3.1 } } as unknown as PolygonMacroBackdrop,
    breadth: { as_of: "2026-07-13", tone: "risk_on", summary: "Market breadth: 62% advancing — risk on." } as unknown as MarketBreadthBundle,
  });
  assert.equal(ars.scope, "index");
  assert.deepEqual(ars.macro, { yield_10_year: 4.2, curve_10y_1y_spread: -0.3, cpi: 3.1, as_of: "2026-07-11" });
  assert.equal(ars.breadth?.tone, "risk_on");
  assert.equal(ars.news?.count, 1);
  assert.equal(ars.earnings, null);
  assert.equal(ars.fundamentals, null);
  assert.equal(ars.related, null);
  assert.deepEqual(ars.unavailable_sources, []);
});

test("assembleEcosystemArsenal: requested-but-thin legs surface in unavailable_sources; irrelevant legs do NOT", () => {
  const ars = assembleEcosystemArsenal({
    scope: "single_name",
    earnings: null, // requested (single name) but empty → unavailable
    fundamentals: null,
    related: { ticker: "ZZZZ", related: [], as_of: null } as unknown as RelatedCompanies, // empty peer list → unavailable
    news: { items: [], asOf: "x", newest: null, unavailable: "timeout" } as unknown as NewsResult, // errored → unavailable
    macro: null, // NOT requested for a single name → must NOT appear as unavailable
    breadth: null,
  });
  const sources = ars.unavailable_sources.map((u) => u.source).sort();
  assert.deepEqual(sources, ["earnings", "fundamentals/short-interest", "news", "peers"]);
  assert.ok(!sources.includes("macro backdrop"), "an irrelevant leg is never 'unavailable'");
  assert.ok(!sources.includes("breadth"));
});

test("assembleEcosystemArsenal: an empty-but-successful news read is 'no recent news' (count 0), not unavailable", () => {
  const ars = assembleEcosystemArsenal({
    scope: "single_name",
    earnings: { earnings_date: "2026-08-01", days_until: 19, report_time: "unknown", is_confirmed: false } as NextEarnings,
    fundamentals: null,
    related: null,
    news: { items: [], asOf: "2026-07-13T00:00:00Z", newest: null } as unknown as NewsResult, // success, just empty
    macro: null,
    breadth: null,
  });
  assert.equal(ars.news?.count, 0);
  assert.ok(!ars.unavailable_sources.some((u) => u.source === "news"), "empty-but-successful news is real info, not an error");
});

test('fetchEcosystemContext("AAPL"): runs ONLY the single-name arsenal readers, never macro/breadth/catalysts', async () => {
  earningsCalls = []; fundamentalsCalls = []; relatedCalls = []; tickerNewsCalls = []; catalystCalls = 0; macroCalls = 0; breadthCalls = 0;
  mockEarnings = { earnings_date: "2026-07-25", days_until: 12, report_time: "afterhours", is_confirmed: true } as NextEarnings;
  mockFundamentals = { as_of: "2026-07-10", short_interest: { days_to_cover: 2.1 }, short_volume_ratio: 0.3, price_target: null } as unknown as TickerFundamentalsBundle;
  mockRelated = { ticker: "AAPL", related: ["MSFT", "GOOGL"], as_of: "2026-07-10" } as unknown as RelatedCompanies;
  mockTickerNews = { items: [{ headline: "Apple ships" }], asOf: "x", newest: "y" } as unknown as NewsResult;

  const ctx = await fetchEcosystemContext("AAPL");

  assert.deepEqual(earningsCalls, ["AAPL"]);
  assert.deepEqual(fundamentalsCalls, ["AAPL"]);
  assert.deepEqual(relatedCalls, ["AAPL"]);
  assert.deepEqual(tickerNewsCalls, ["AAPL"]);
  assert.equal(catalystCalls, 0, "market catalysts must NOT run for a single name");
  assert.equal(macroCalls, 0, "macro must NOT run for a single name");
  assert.equal(breadthCalls, 0, "breadth must NOT run for a single name");
  assert.equal(ctx.arsenal.scope, "single_name");
  assert.equal(ctx.arsenal.earnings?.days_until, 12);
  assert.deepEqual(ctx.arsenal.related, ["MSFT", "GOOGL"]);
});

test('fetchEcosystemContext("SPX"): runs ONLY the index arsenal readers (macro/breadth/catalysts), never the single-name ones', async () => {
  earningsCalls = []; fundamentalsCalls = []; relatedCalls = []; tickerNewsCalls = []; catalystCalls = 0; macroCalls = 0; breadthCalls = 0;
  mockMacro = { as_of: "2026-07-11", treasury: { yield_10_year: 4.1, curve_10y_1y_spread: -0.2 }, inflation: { cpi: 3.0 } } as unknown as PolygonMacroBackdrop;
  mockBreadth = { as_of: "2026-07-13", tone: "risk_on", summary: "breadth risk on" } as unknown as MarketBreadthBundle;
  mockCatalysts = { items: [{ headline: "CPI print" }], asOf: "x", newest: "y" } as unknown as NewsResult;

  const ctx = await fetchEcosystemContext("SPX");

  assert.equal(macroCalls, 1);
  assert.equal(breadthCalls, 1);
  assert.equal(catalystCalls, 1);
  assert.deepEqual(earningsCalls, [], "earnings must NOT run for an index");
  assert.deepEqual(fundamentalsCalls, [], "fundamentals must NOT run for an index");
  assert.deepEqual(relatedCalls, [], "related must NOT run for an index");
  assert.deepEqual(tickerNewsCalls, [], "ticker news must NOT run for an index");
  assert.equal(ctx.arsenal.scope, "index");
  assert.equal(ctx.arsenal.macro?.yield_10_year, 4.1);
  assert.equal(ctx.arsenal.breadth?.tone, "risk_on");
});
