// NIGHT HAWK CORTEX — the IO assembler: CortexInputs from EXISTING readers only.
//
// This is the ONLY file in the cortex that touches IO. It fans out over the same
// readers the platform already trusts (design §1 BIE: "the Cortex should USE those
// readers, not re-implement them") and maps their outputs onto the pure CortexInputs
// slices. NO new upstream API calls exist here — every dep below is an existing,
// already-warmed read:
//
//   - fetchVectorFullState(ticker, "0dte")  (src/lib/bie/vector-full-state.ts) — the
//     exact composer behind ecosystem-context's vector_full_state / Largo's
//     get_vector_full_state, called at the 0DTE horizon directly because the design
//     scopes the Cortex's dealer landscape to 0DTE (§1 "Vector GEX ladder (0DTE
//     horizon)") while the ecosystem field is horizon-"all". Supplies walls, the
//     wall-history rail (WallHistorySample rows — vector-wall-persist.ts shapes),
//     expected move, regime and dark-pool levels in one cached read.
//   - getGexPositioning(ticker)             (src/lib/providers/gex-positioning.ts) —
//     the canonical Thermal positioning read (net VEX, king node, spot, change %).
//   - getFlowTapeSummary({ticker})          (src/lib/platform/flow-service.ts) — the
//     exact reader behind ecosystem-context's flow_full_state / Largo's get_flow_tape.
//   - fetchTickerNews / fetchMarketCatalysts (src/lib/providers/polygon-news.ts) —
//     called directly (not via assembleEcosystemArsenal's summary) because the
//     arsenal's news slice drops the Benzinga CHANNELS the deterministic catalyst
//     tagging requires (design §1: channel/keyword tagging only).
//   - fetchNextEarningsDate(ticker)         (src/lib/providers/uw-earnings.ts).
//   - fetchSectorPerformance()              (src/lib/providers/polygon.ts) — the same
//     read behind the Thermal heatmap route AND the SPX desk's sector_heat.
//   - fetchMarketBreadthBundle()            (src/lib/bie/market-breadth.ts) — the
//     arsenal's own breadth leg, for index tickers.
//
// Discipline: fail-soft PER SOURCE (an erroring reader → that slice is null and the
// error CLASS is recorded in input.errors so the source reports "reader failed
// (TimeoutError)" instead of a fake "quiet"), and time-budgeted overall via
// Promise.allSettled + a per-read timeout — the Cortex runs on gate-stack survivors
// inside a scan tick and must never hang it.
//
// All reader modules are DYNAMICALLY imported at call time: several of them (the
// vector full state chain) are `server-only`, and a static import here would make
// this module — and every test that imports its pure mappers — unloadable outside
// the Next server runtime. Types are imported type-only (erased at runtime).

import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { MarketBreadthBundle } from "@/lib/bie/market-breadth";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { NewsResult } from "@/lib/providers/polygon-news";
import type { NextEarnings } from "@/lib/providers/uw-earnings";
import type { FlowTapeSummary } from "@/lib/platform/types";
import type { FlowRow } from "@/lib/db";
import { getSector } from "@/lib/sector-map";
import type {
  CortexDirection,
  CortexFlowPrintKind,
  CortexFlowSlice,
  CortexGexSlice,
  CortexInputs,
  CortexNewsSlice,
  CortexSectorSlice,
  CortexSourceId,
  CortexVexSlice,
  CortexWallTrendSlice,
} from "./types";

/** Per-read timeout. 2.5s: the Cortex runs on scan-tick survivors — a single slow
 *  provider must degrade that source to absent, never stall the scanner. Every
 *  reader here is Redis-cache-first, so 2.5s is generous for the healthy path. */
export const CORTEX_SOURCE_TIMEOUT_MS = 2_500;

/** How many recent HELIX prints to pull — matches ecosystem-context's own
 *  FLOW_FULL_STATE_LIMIT (one ticker's recent tape, not the whole platform). */
export const CORTEX_FLOW_PRINT_LIMIT = 50;

/** News items to pull — enough for deterministic catalyst tagging without paging. */
export const CORTEX_NEWS_LIMIT = 8;

/** Index/ETF tickers read market breadth instead of a sector row. Mirrors
 *  ecosystem-context's ARSENAL_INDEX_TICKERS (isEcosystemIndexTicker) — duplicated
 *  as a literal here because importing ecosystem-context would statically pull the
 *  `server-only` vector-full-state chain into this module's load graph. */
export const CORTEX_INDEX_TICKERS = new Set(["SPX", "SPXW", "SPY", "QQQ", "NDX", "IWM", "DIA", "VIX", "ES"]);

/** SECTOR_MAP label → the sector ETF ticker fetchSectorPerformance() reports on
 *  (polygon.ts SECTOR_ETFS). The two lists use different display labels — this is
 *  the one place they meet. */
export const SECTOR_LABEL_TO_ETF: Record<string, string> = {
  Tech: "XLK",
  Financials: "XLF",
  Energy: "XLE",
  Healthcare: "XLV",
  Industrials: "XLI",
  "Cons.Disc.": "XLY",
  "Cons.Staples": "XLP",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  Materials: "XLB",
  "Comm.Svc.": "XLC",
};

export type SectorPerformanceRow = { name: string; ticker: string; change_pct: number; volume?: number };

/** The injectable reader set — defaults to the real platform readers (loaded
 *  lazily); tests inject fakes so the assembler's fail-soft/timeout behavior is
 *  testable without module mocks or a live platform. */
export type CortexFetchDeps = {
  fetchVectorFullState: (ticker: string, horizon: "0dte") => Promise<VectorFullState | null>;
  getGexPositioning: (ticker: string) => Promise<GexPositioning | null>;
  getFlowTapeSummary: (opts: { ticker: string; limit: number }) => Promise<FlowTapeSummary>;
  fetchTickerNews: (ticker: string, opts: { limit: number }) => Promise<NewsResult>;
  fetchMarketCatalysts: (opts: { limit: number }) => Promise<NewsResult>;
  fetchNextEarningsDate: (ticker: string) => Promise<NextEarnings | null>;
  fetchSectorPerformance: () => Promise<SectorPerformanceRow[]>;
  fetchMarketBreadthBundle: () => Promise<MarketBreadthBundle | null>;
};

async function loadDefaultDeps(): Promise<CortexFetchDeps> {
  const [vectorFullState, gexPositioning, flowService, polygonNews, uwEarnings, polygon, marketBreadth] =
    await Promise.all([
      import("@/lib/bie/vector-full-state"),
      import("@/lib/providers/gex-positioning"),
      import("@/lib/platform/flow-service"),
      import("@/lib/providers/polygon-news"),
      import("@/lib/providers/uw-earnings"),
      import("@/lib/providers/polygon"),
      import("@/lib/bie/market-breadth"),
    ]);
  return {
    fetchVectorFullState: (t, h) => vectorFullState.fetchVectorFullState(t, h),
    getGexPositioning: (t) => gexPositioning.getGexPositioning(t),
    getFlowTapeSummary: (o) => flowService.getFlowTapeSummary(o),
    fetchTickerNews: (t, o) => polygonNews.fetchTickerNews(t, o),
    fetchMarketCatalysts: (o) => polygonNews.fetchMarketCatalysts(o),
    fetchNextEarningsDate: (t) => uwEarnings.fetchNextEarningsDate(t),
    fetchSectorPerformance: () => polygon.fetchSectorPerformance(),
    fetchMarketBreadthBundle: () => marketBreadth.fetchMarketBreadthBundle(),
  };
}

/** Race a reader against the per-source budget. The timeout rejects with a named
 *  error so input.errors carries a recognizable class ("CortexSourceTimeout"). */
export function withSourceTimeout<T>(p: Promise<T>, ms: number = CORTEX_SOURCE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`source read exceeded ${ms}ms`);
      err.name = "CortexSourceTimeout";
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** The error CLASS (constructor/name), never the message — messages can carry
 *  URLs/params that don't belong in a member-adjacent evidence table. */
function errorClass(reason: unknown): string {
  if (reason instanceof Error) return reason.name || reason.constructor.name;
  return typeof reason;
}

// ---------------------------------------------------------------------------
// Pure mappers (exported for unit tests)
// ---------------------------------------------------------------------------

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 1σ expected move in POINTS from the Vector full state (bands carry movePts per
 *  sigma; the 1σ band is the desk's headline "expected move"). */
export function expectedMovePtsFrom(state: Pick<VectorFullState, "expectedMove"> | null): number | null {
  const em = state?.expectedMove;
  if (!em) return null;
  const oneSigma = em.bands?.find((b) => b.sigma === 1) ?? em.bands?.[0];
  return finiteOrNull(oneSigma?.movePts ?? null);
}

export function mapGexSlice(
  state: Pick<VectorFullState, "asOf" | "spot" | "gexWalls" | "gammaFlip" | "regime"> | null
): CortexGexSlice | null {
  if (!state) return null;
  const spot = finiteOrNull(state.spot);
  if (spot == null) return null;
  return {
    asOf: state.asOf,
    spot,
    callWalls: (state.gexWalls?.callWalls ?? []).map((w) => ({ strike: w.strike, pct: w.pct })),
    putWalls: (state.gexWalls?.putWalls ?? []).map((w) => ({ strike: w.strike, pct: w.pct })),
    gammaFlip: finiteOrNull(state.gammaFlip),
    regimePosture: state.regime?.posture ?? "unknown",
  };
}

/** The wall-history rail → trend samples, GEX lens (the flagship trends dealer
 *  GAMMA walls — design §1 bead history; the VEX lens rides vex-charm instead).
 *  Sample.time stays in the rail's native epoch-seconds bucket convention. */
export function mapWallTrendSlice(
  state: Pick<VectorFullState, "asOf" | "wallHistory"> | null
): CortexWallTrendSlice | null {
  if (!state) return null;
  const samples = (state.wallHistory ?? [])
    .filter((s) => Number.isFinite(s.time))
    .map((s) => ({
      time: s.time,
      callWalls: (s.walls?.callWalls ?? []).map((w) => ({ strike: w.strike, pct: w.pct })),
      putWalls: (s.walls?.putWalls ?? []).map((w) => ({ strike: w.strike, pct: w.pct })),
    }))
    .sort((a, b) => a.time - b.time);
  return { asOf: state.asOf, samples };
}

/** Deterministic print-texture class from the UW alert rule name: sweep rules carry
 *  urgency, floor/block rules are negotiated size (design §1 Helix); anything else
 *  (RepeatedHits, VolumeOverOi, missing rule) is "other". */
export function classifyFlowPrintKind(alertRule: string | null | undefined): CortexFlowPrintKind {
  const rule = (alertRule ?? "").toLowerCase();
  if (rule.includes("sweep")) return "sweep";
  if (rule.includes("floor") || rule.includes("block")) return "block";
  return "other";
}

export function mapFlowSlice(tape: Pick<FlowTapeSummary, "recent"> | null, asOf: string): CortexFlowSlice | null {
  if (!tape) return null;
  const prints = (tape.recent ?? []).map((r: FlowRow) => ({
    premium: finiteOrNull(r.premium) ?? 0,
    direction: (r.direction === "bullish" || r.direction === "bearish" ? r.direction : "unknown") as
      | "bullish"
      | "bearish"
      | "unknown",
    kind: classifyFlowPrintKind(r.alert_rule),
    // event_at is UW's real print time; alerted_at may be "" (the parser's honesty
    // sentinel) — pass through unchanged, the cluster math excludes unstamped prints.
    at: r.event_at ?? r.alerted_at ?? "",
  }));
  return { asOf, prints };
}

export function mapNewsSlice(
  news: NewsResult | null,
  earnings: NextEarnings | null,
  asOf: string
): CortexNewsSlice | null {
  if (!news || news.unavailable) return null;
  return {
    asOf,
    items: news.items.map((i) => ({
      headline: i.headline,
      channels: i.channels,
      publishedAt: i.publishedAt,
      tickers: i.tickers,
    })),
    earningsToday:
      earnings && earnings.days_until === 0 ? (earnings.report_time ?? "unknown") : null,
  };
}

export function mapVexSlice(positioning: GexPositioning | null): CortexVexSlice | null {
  if (!positioning) return null;
  return {
    asOf: positioning.asof,
    netVex: finiteOrNull(positioning.net_vex),
    kingStrike: finiteOrNull(positioning.gex_king_strike),
  };
}

export function mapSectorSlice(args: {
  ticker: string;
  sectors: SectorPerformanceRow[] | null;
  breadth: MarketBreadthBundle | null;
  tickerChangePct: number | null;
  asOf: string;
}): CortexSectorSlice | null {
  const upper = args.ticker.toUpperCase();
  if (CORTEX_INDEX_TICKERS.has(upper)) {
    if (!args.breadth) return null;
    return {
      asOf: args.asOf,
      sectorName: null,
      sectorChangePct: null,
      breadthTone: args.breadth.tone,
      tickerChangePct: args.tickerChangePct,
    };
  }
  if (!args.sectors) return null;
  const etf = SECTOR_LABEL_TO_ETF[getSector(upper)];
  const row = etf ? args.sectors.find((s) => s.ticker === etf) : undefined;
  if (!row) return null; // unmapped sector ("Other") — the source reports absent
  return {
    asOf: args.asOf,
    sectorName: row.name,
    sectorChangePct: finiteOrNull(row.change_pct),
    breadthTone: null,
    tickerChangePct: args.tickerChangePct,
  };
}

// ---------------------------------------------------------------------------
// The assembler
// ---------------------------------------------------------------------------

/**
 * Assemble a CortexInputs snapshot for (ticker, direction). `now` defaults to the
 * wall clock HERE — the one sanctioned boundary; from this point inward the clock
 * only ever travels as input.now (composer purity). Never throws: the worst case is
 * a snapshot whose every slice is null with the error classes recorded — the
 * composer then reports every source absent, which is the honest verdict.
 */
export async function fetchCortexInputs(
  ticker: string,
  direction: CortexDirection,
  opts: { now?: Date; deps?: CortexFetchDeps; timeoutMs?: number } = {}
): Promise<CortexInputs> {
  const upper = ticker.toUpperCase().trim();
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? CORTEX_SOURCE_TIMEOUT_MS;
  const deps = opts.deps ?? (await loadDefaultDeps());
  const isIndex = CORTEX_INDEX_TICKERS.has(upper);
  const errors: Partial<Record<CortexSourceId, string>> = {};

  const [vectorRes, positioningRes, flowRes, newsRes, earningsRes, sectorRes, breadthRes] =
    await Promise.allSettled([
      withSourceTimeout(deps.fetchVectorFullState(upper, "0dte"), timeoutMs),
      withSourceTimeout(deps.getGexPositioning(upper), timeoutMs),
      withSourceTimeout(deps.getFlowTapeSummary({ ticker: upper, limit: CORTEX_FLOW_PRINT_LIMIT }), timeoutMs),
      withSourceTimeout(
        isIndex
          ? deps.fetchMarketCatalysts({ limit: CORTEX_NEWS_LIMIT })
          : deps.fetchTickerNews(upper, { limit: CORTEX_NEWS_LIMIT }),
        timeoutMs
      ),
      // Earnings only exist for single names; an index "read" resolves null without a call.
      isIndex ? Promise.resolve(null) : withSourceTimeout(deps.fetchNextEarningsDate(upper), timeoutMs),
      isIndex ? Promise.resolve(null) : withSourceTimeout(deps.fetchSectorPerformance(), timeoutMs),
      isIndex ? withSourceTimeout(deps.fetchMarketBreadthBundle(), timeoutMs) : Promise.resolve(null),
    ]);

  const note = (sources: CortexSourceId[], reason: unknown) => {
    const cls = errorClass(reason);
    for (const s of sources) errors[s] = errors[s] ?? cls;
  };

  // The vector read feeds three sources + the shared spot/EM yardstick.
  const vector = vectorRes.status === "fulfilled" ? vectorRes.value : null;
  if (vectorRes.status === "rejected") note(["gex-walls", "wall-trend", "darkpool-confluence"], vectorRes.reason);

  const positioning = positioningRes.status === "fulfilled" ? positioningRes.value : null;
  if (positioningRes.status === "rejected") note(["vex-charm"], positioningRes.reason);

  const flowTape = flowRes.status === "fulfilled" ? flowRes.value : null;
  if (flowRes.status === "rejected") note(["flow-quality", "catalyst-news"], flowRes.reason);

  const news = newsRes.status === "fulfilled" ? newsRes.value : null;
  if (newsRes.status === "rejected") note(["catalyst-news"], newsRes.reason);
  if (news?.unavailable) note(["catalyst-news"], { name: news.unavailable } as Error);

  const earnings = earningsRes.status === "fulfilled" ? earningsRes.value : null;
  // Earnings feed catalyst-news too, but its news leg may still answer — only note
  // the error class if nothing else already did.
  if (earningsRes.status === "rejected") note(["catalyst-news"], earningsRes.reason);

  const sectors = sectorRes.status === "fulfilled" ? sectorRes.value : null;
  if (sectorRes.status === "rejected") note(["sector-heat"], sectorRes.reason);
  const breadth = breadthRes.status === "fulfilled" ? breadthRes.value : null;
  if (breadthRes.status === "rejected") note(["sector-heat"], breadthRes.reason);

  const nowIso = now.toISOString();
  const spot = finiteOrNull(vector?.spot) ?? finiteOrNull(positioning?.spot);

  return {
    ticker: upper,
    direction,
    now: nowIso,
    spot,
    expectedMovePts: expectedMovePtsFrom(vector),
    gex: mapGexSlice(vector),
    wallTrend: mapWallTrendSlice(vector),
    flow: mapFlowSlice(flowTape, nowIso),
    sector: mapSectorSlice({
      ticker: upper,
      sectors,
      breadth,
      tickerChangePct: finiteOrNull(positioning?.change_pct),
      asOf: nowIso,
    }),
    news: mapNewsSlice(news, earnings, nowIso),
    vex: mapVexSlice(positioning),
    darkPool: vector
      ? {
          asOf: vector.asOf,
          levels: (vector.darkPoolLevels ?? []).map((l) => ({ price: l.strike, premium: l.premium })),
        }
      : null,
    errors,
  };
}
