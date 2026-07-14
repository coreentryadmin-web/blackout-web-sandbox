// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/fetch.test.ts
//
// The assembler is tested through its INJECTED deps (CortexFetchDeps) — no module
// mocks and no live platform: fetch.ts's default deps are dynamically imported
// precisely so importing this file never touches the server-only reader chain.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  classifyFlowPrintKind,
  expectedMovePtsFrom,
  fetchCortexInputs,
  mapGexSlice,
  mapNewsSlice,
  mapOpeningSlice,
  mapSectorSlice,
  mapWallTrendSlice,
  withSourceTimeout,
  type CortexFetchDeps,
  type PolygonAggBar,
} from "./fetch";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { FlowRow } from "@/lib/db";

const NOW = new Date("2026-07-13T15:00:00.000Z");

// --- minimal reader payloads (structural) -----------------------------------

/** Only the fields the mappers read — cast through unknown for the rest. */
function vectorState(): VectorFullState {
  return {
    ticker: "NVDA",
    horizon: "0dte",
    timeframeMin: 5,
    spot: 100,
    regime: { posture: "short" },
    gexWalls: {
      callWalls: [{ strike: 105, pct: 20 }],
      putWalls: [{ strike: 95, pct: 15 }],
    },
    gammaFlip: 102,
    magnet: null,
    proximity: null,
    expectedMove: {
      atmIv: 0.3,
      dteDays: 0.4,
      spot: 100,
      movePct: 0.04,
      bands: [
        { sigma: 1, low: 96, high: 104, movePts: 4 },
        { sigma: 2, low: 92, high: 108, movePts: 8 },
      ],
    },
    maxPain: 100,
    confluenceZones: [],
    wallIntegrity: null,
    technicals: null,
    bie: null,
    play: null,
    asOf: NOW.toISOString(),
    flowMarkers: null,
    ladder: null,
    heatmap: null,
    wallHistory: [
      {
        time: 1_784_000_000,
        walls: { callWalls: [{ strike: 105, pct: 18 }], putWalls: [{ strike: 95, pct: 12 }] },
      },
      {
        time: 1_783_999_985,
        walls: { callWalls: [{ strike: 105, pct: 17 }], putWalls: [] },
      },
    ],
    wallEvents: [],
    vexWalls: null,
    vexFlip: null,
    darkPoolLevels: [{ strike: 95.2, premium: 12_000_000, pct: 30 }],
  } as unknown as VectorFullState;
}

function positioning(): GexPositioning {
  return {
    ticker: "NVDA",
    spot: 100.1,
    change_pct: -1.4,
    asof: NOW.toISOString(),
    net_vex: -3e8,
    gex_king_strike: 101,
  } as unknown as GexPositioning;
}

function flowRow(over: Partial<FlowRow>): FlowRow {
  return {
    ticker: "NVDA",
    premium: 400_000,
    option_type: "CALL",
    expiry: "2026-07-13",
    strike: 100,
    direction: "bullish",
    score: 80,
    route: "0dte",
    alerted_at: NOW.toISOString(),
    ...over,
  };
}

function deps(over: Partial<CortexFetchDeps> = {}): CortexFetchDeps {
  return {
    fetchVectorFullState: async () => vectorState(),
    getGexPositioning: async () => positioning(),
    getFlowTapeSummary: async () => ({
      count: 2,
      total_premium: 900_000,
      top_tickers: [],
      recent: [
        flowRow({ alert_rule: "SweepsFollowedByFloor" }),
        flowRow({ alert_rule: "FloorTradeLargeCap", event_at: "2026-07-13T14:50:00.000Z" }),
      ],
    }),
    fetchTickerNews: async () => ({
      items: [
        {
          id: "1",
          headline: "NVDA receives FDA approval",
          source: "benzinga",
          publishedAt: "2026-07-13T12:00:00Z",
          channels: ["fda"],
          tickers: ["NVDA"],
          url: "",
        },
      ],
      asOf: NOW.toISOString(),
      newest: "2026-07-13T12:00:00Z",
    }),
    fetchMarketCatalysts: async () => ({ items: [], asOf: NOW.toISOString(), newest: null }),
    fetchNextEarningsDate: async () => ({
      ticker: "NVDA",
      earnings_date: "2026-07-13",
      days_until: 0,
      report_time: "afterhours",
      is_confirmed: true,
      source: "uw",
    }),
    fetchSectorPerformance: async () => [
      { name: "Technology", ticker: "XLK", change_pct: -1.1 },
      { name: "Energy", ticker: "XLE", change_pct: 0.4 },
    ],
    fetchMarketBreadthBundle: async () => ({
      as_of: "2026-07-13",
      breadth: null,
      movers: [],
      tone: "negative",
      summary: "decliners lead",
    }),
    fetchMinuteBars: async () => [
      { t: Date.parse("2026-07-13T13:30:00Z"), o: 100, h: 100.5, l: 99.8, c: 100.4 },
      { t: Date.parse("2026-07-13T13:31:00Z"), o: 100.4, h: 100.9, l: 100.3, c: 100.8 },
    ],
    fetchPreviousDayBar: async () => ({ t: 1, o: 98, h: 99, l: 97, c: 98.6 }),
    fetchBreadthUniverseSnapshots: async () => [{ change_pct: -1 }, { change_pct: -0.6 }, { change_pct: 0.2 }],
    todayEtYmd: () => "2026-07-13",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("fetch: pure mappers", () => {
  test("expectedMovePtsFrom picks the 1-sigma band", () => {
    assert.equal(expectedMovePtsFrom(vectorState()), 4);
    assert.equal(expectedMovePtsFrom(null), null);
  });

  test("mapGexSlice mirrors walls/flip/regime; null without a spot", () => {
    const slice = mapGexSlice(vectorState());
    assert.equal(slice?.spot, 100);
    assert.deepEqual(slice?.callWalls, [{ strike: 105, pct: 20 }]);
    assert.equal(slice?.gammaFlip, 102);
    assert.equal(slice?.regimePosture, "short");
    assert.equal(mapGexSlice({ ...vectorState(), spot: null } as never), null);
  });

  test("mapWallTrendSlice sorts the rail ascending and keeps the GEX lens", () => {
    const slice = mapWallTrendSlice(vectorState());
    assert.equal(slice?.samples.length, 2);
    assert.ok(slice!.samples[0].time < slice!.samples[1].time);
    assert.deepEqual(slice!.samples[1].callWalls, [{ strike: 105, pct: 18 }]);
  });

  test("classifyFlowPrintKind: deterministic rule-name texture classes", () => {
    assert.equal(classifyFlowPrintKind("SweepsFollowedByFloor"), "sweep");
    assert.equal(classifyFlowPrintKind("FloorTradeLargeCap"), "block");
    assert.equal(classifyFlowPrintKind("RepeatedHitsAscendingFill"), "other");
    assert.equal(classifyFlowPrintKind(null), "other");
  });

  test("mapNewsSlice: earnings-today mapping + unavailable honesty", () => {
    const news = { items: [], asOf: "x", newest: null };
    const earnings = { earnings_date: "2026-07-13", days_until: 0, report_time: "afterhours" as const, is_confirmed: true };
    assert.equal(mapNewsSlice(news, earnings as never, "x")?.earningsToday, "afterhours");
    assert.equal(mapNewsSlice(news, { ...earnings, days_until: 3 } as never, "x")?.earningsToday, null);
    assert.equal(mapNewsSlice({ ...news, unavailable: "timeout" }, null, "x"), null);
  });

  test("mapSectorSlice: single name -> its sector ETF row; index -> breadth tone", () => {
    const sectors = [{ name: "Technology", ticker: "XLK", change_pct: -1.1 }];
    const single = mapSectorSlice({ ticker: "NVDA", sectors, breadth: null, tickerChangePct: -2, asOf: "x" });
    assert.equal(single?.sectorName, "Technology");
    assert.equal(single?.sectorChangePct, -1.1);
    assert.equal(single?.breadthTone, null);

    const index = mapSectorSlice({
      ticker: "QQQ",
      sectors: null,
      breadth: { as_of: "x", breadth: null, movers: [], tone: "negative", summary: "" },
      tickerChangePct: null,
      asOf: "x",
    });
    assert.equal(index?.breadthTone, "negative");
    assert.equal(index?.sectorName, null);

    // Unmapped sector ("Other") -> null slice -> the source reports absent.
    assert.equal(mapSectorSlice({ ticker: "ZZZZ", sectors, breadth: null, tickerChangePct: null, asOf: "x" }), null);
  });

  test("mapOpeningSlice: ms->sec bar times, unstamped bars dropped", () => {
    const bars: PolygonAggBar[] = [
      { t: 1_784_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5 },
      { o: 1, h: 2, l: 0.5, c: 1.5 }, // no timestamp -> dropped
    ];
    const slice = mapOpeningSlice({ bars, priorClose: 99, internals: { tick: -100, add: -500 }, asOf: "x" });
    assert.equal(slice?.bars.length, 1);
    assert.equal(slice?.bars[0].time, 1_784_000_000);
    assert.equal(slice?.tick, -100);
    assert.equal(mapOpeningSlice({ bars: null, priorClose: 99, internals: null, asOf: "x" }), null);
  });
});

describe("fetch: assembler (injected deps)", () => {
  test("happy path: every slice populated from the readers", async () => {
    const input = await fetchCortexInputs("nvda", "long", { now: NOW, deps: deps() });
    assert.equal(input.ticker, "NVDA");
    assert.equal(input.now, NOW.toISOString());
    assert.equal(input.spot, 100);
    assert.equal(input.expectedMovePts, 4);
    assert.equal(input.gex?.callWalls[0].strike, 105);
    assert.equal(input.wallTrend?.samples.length, 2);
    assert.equal(input.flow?.prints.length, 2);
    assert.equal(input.flow?.prints[0].kind, "sweep");
    assert.equal(input.flow?.prints[1].kind, "block");
    // event_at (real print time) wins over alerted_at when present.
    assert.equal(input.flow?.prints[1].at, "2026-07-13T14:50:00.000Z");
    assert.equal(input.sector?.sectorName, "Technology");
    assert.equal(input.news?.items[0].channels[0], "fda");
    assert.equal(input.news?.earningsToday, "afterhours");
    assert.equal(input.vex?.netVex, -3e8);
    assert.equal(input.darkPool?.levels[0].price, 95.2);
    assert.equal(input.opening?.priorClose, 98.6);
    assert.equal(input.opening?.bars.length, 2);
    assert.ok(input.opening!.tick != null && input.opening!.tick < 0);
    assert.deepEqual(input.errors, {});
  });

  test("index ticker routes: market catalysts + breadth, no earnings/sector calls", async () => {
    let earningsCalls = 0;
    let sectorCalls = 0;
    let catalystCalls = 0;
    const input = await fetchCortexInputs("SPY", "short", {
      now: NOW,
      deps: deps({
        fetchNextEarningsDate: async () => {
          earningsCalls++;
          return null;
        },
        fetchSectorPerformance: async () => {
          sectorCalls++;
          return [];
        },
        fetchMarketCatalysts: async () => {
          catalystCalls++;
          return { items: [], asOf: NOW.toISOString(), newest: null };
        },
      }),
    });
    assert.equal(earningsCalls, 0);
    assert.equal(sectorCalls, 0);
    assert.equal(catalystCalls, 1);
    assert.equal(input.sector?.breadthTone, "negative");
    assert.equal(input.news?.earningsToday, null);
  });

  test("index roots map to Polygon's I: namespace for bars/prev-day", async () => {
    const symbols: string[] = [];
    await fetchCortexInputs("SPXW", "long", {
      now: NOW,
      deps: deps({
        fetchMinuteBars: async (sym) => {
          symbols.push(sym);
          return [];
        },
        fetchPreviousDayBar: async (sym) => {
          symbols.push(sym);
          return null;
        },
      }),
    });
    assert.deepEqual(symbols.sort(), ["I:SPX", "I:SPX"]);
  });

  test("a rejected reader fails soft: null slice + error class per fed source", async () => {
    const boom = async () => {
      throw new TypeError("matrix cold");
    };
    const input = await fetchCortexInputs("NVDA", "long", {
      now: NOW,
      deps: deps({ fetchVectorFullState: boom, getFlowTapeSummary: boom }),
    });
    assert.equal(input.gex, null);
    assert.equal(input.wallTrend, null);
    assert.equal(input.darkPool, null);
    assert.equal(input.flow, null);
    assert.equal(input.errors["gex-walls"], "TypeError");
    assert.equal(input.errors["wall-trend"], "TypeError");
    assert.equal(input.errors["darkpool-confluence"], "TypeError");
    assert.equal(input.errors["flow-quality"], "TypeError");
    // Spot falls back to the positioning read.
    assert.equal(input.spot, 100.1);
  });

  test("a hung reader is cut at the per-source budget with CortexSourceTimeout", async () => {
    const never = () => new Promise<never>(() => {});
    const input = await fetchCortexInputs("NVDA", "long", {
      now: NOW,
      timeoutMs: 25,
      deps: deps({ getGexPositioning: never as never }),
    });
    assert.equal(input.vex, null);
    assert.equal(input.errors["vex-charm"], "CortexSourceTimeout");
    // The rest of the fan-out still landed.
    assert.equal(input.gex?.spot, 100);
  });

  test("news 'unavailable' (fail-open reader convention) surfaces as an error, not a slice", async () => {
    const input = await fetchCortexInputs("NVDA", "long", {
      now: NOW,
      deps: deps({
        fetchTickerNews: async () => ({ items: [], asOf: NOW.toISOString(), newest: null, unavailable: "timeout" }),
      }),
    });
    assert.equal(input.news, null);
    assert.ok(input.errors["catalyst-news"]);
  });

  test("withSourceTimeout resolves fast reads untouched", async () => {
    assert.equal(await withSourceTimeout(Promise.resolve(7), 50), 7);
    await assert.rejects(withSourceTimeout(new Promise(() => {}), 10), /CortexSourceTimeout|exceeded/);
  });
});
