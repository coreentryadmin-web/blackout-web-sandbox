import "server-only";

// ---------------------------------------------------------------------------
// Massive OPTIONS TRADES — independent flow reconstruction (NOT Unusual Whales).
//
// HELIX's flow tape is sourced 100% from Unusual Whales today (single provider). This module
// reconstructs the SAME headline numbers (total / call$ / put$ / by-strike premium) from a
// COMPLETELY DIFFERENT provider — Massive's tick-level options TRADES endpoint — so the two
// can be cross-checked against each other (see correctness/flows-verifier.ts). Two independent
// sources agreeing within tolerance is a genuine cross-provider confirmation; today UW is the
// sole source and the flow metric is consistency-only.
//
// ENDPOINT (probe-verified 2026-06-26, plan = Options Advanced):
//   GET {BASE}/v3/trades/{optionsTicker}?apiKey=...&timestamp.gte=<ns>&order=desc&sort=timestamp&limit=...
//   → 200 { results: [{ price, size, decimal_size, conditions:[int], exchange, sip_timestamp(ns),
//                        sequence_number, id }], status, request_id, next_url }
//   Per-OCC ONLY. /v3/trades/{UNDERLYING} returns STOCK trades, not options — there is NO
//   underlying-level options-trades pull — so we scope to a BOUNDED set of near-the-money
//   contracts (cap below) and fan out per OCC through the rate-limited Polygon/Massive funnel.
//
// PREMIUM: per print, premium = price × size × 100 (standard 100-multiplier options contract).
// We aggregate total + call/put + by-strike. Multi-leg / canceled / late prints are filtered via
// the trade `conditions` codes (probe-verified against /v3/reference/options/conditions).
//
// SCALING / RATE DISCIPLINE: every call goes through polygonRawJson → polygonTrackedFetch (the
// ONE permissive Massive funnel + reactive breaker). This is Massive (NOT the scarce 2-RPS UW
// budget) but it is still bounded: a contract cap, a per-contract page cap, and a single banded
// chain-snapshot to discover contracts. The whole result is wrapped in serverCache with a short
// TTL so concurrent callers collapse to one fan-out per window. Never throws; degrades to an
// empty/partial result on any upstream failure (never fabricates).
// ---------------------------------------------------------------------------

import { polygonConfigured } from "./config";
import { polygonRawJson, resolveOptionsRoot } from "./polygon-options-gex";
import { fetchIndexSnapshot, fetchStockSnapshot } from "./polygon";
import { todayEtYmd } from "./spx-session";
import { serverCache, TTL } from "@/lib/server-cache";
import { classifyTradeSide } from "./gex-intraday-adjust-core";

// ── Bounds (all env-tunable; defaults are conservative) ────────────────────────
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max distinct OCC contracts we'll pull trades for in one reconstruction (the hard fan-out cap). */
const MAX_CONTRACTS = envInt("OPTION_TRADES_MAX_CONTRACTS", 40);
/** Max trades-pages per contract (each page ≤ TRADES_PAGE_LIMIT prints). */
const MAX_PAGES_PER_CONTRACT = envInt("OPTION_TRADES_MAX_PAGES", 2);
/** Prints per trades page. */
const TRADES_PAGE_LIMIT = envInt("OPTION_TRADES_PAGE_LIMIT", 250);
/** Strike band (± fraction of spot) used to pick near-the-money contracts. */
const STRIKE_BAND_PCT = envFloat("OPTION_TRADES_BAND_PCT", 0.04);
/** Lookback window for the trades pull (minutes). */
const DEFAULT_WINDOW_MIN = envInt("OPTION_TRADES_WINDOW_MIN", 60);
/** Cache TTL for a full reconstruction. Short — flow moves fast. Reuses OPTIONS_CHAIN (30s). */
const RECON_TTL_MS = envInt("OPTION_TRADES_TTL_MS", TTL.OPTIONS_CHAIN);

// ── Trade-condition codes (probe-verified via /v3/reference/options/conditions) ─
// Multi-leg / stock-options combos: the print premium is a packaged spread, NOT a clean
// single-contract directional bet, so we EXCLUDE them from the single-leg premium reconstruction.
const MULTILEG_CONDITIONS = new Set<number>([
  232, 233, 234, 235, 236, 238, 239, // multi-leg auto/auction/cross/floor (+ against single leg)
  237, 240, 241, 242, 243, 244, 245, // stock-options auto/auction/cross/floor (+ against single leg)
  246, 247, // multi-leg / multilateral compression of proprietary products
]);
// Canceled / late / out-of-sequence: not a clean executable fill — EXCLUDE.
const CANCELED_LATE_CONDITIONS = new Set<number>([
  201, 202, 203, 204, 205, 206, 207, // canceled / late / OOO / opening-trade-canceled variants
]);

/** A single reconstructed option print. */
export type OptionTradePrint = {
  occ: string;
  strike: number;
  type: "call" | "put";
  price: number;
  size: number;
  /** price × size × 100. */
  premium: number;
  /** epoch ms (sip_timestamp is nanoseconds upstream). */
  tsMs: number;
};

/** Per-strike premium split. */
export type StrikePremium = {
  strike: number;
  callPremium: number;
  putPremium: number;
  totalPremium: number;
  prints: number;
  /**
   * SIGNED net CUSTOMER premium classified via the quote rule (at/above ask → customer BUY → +,
   * at/below bid → customer SELL → −, mid/unclassifiable → 0), split by option type. Positive =
   * net customer buying. These power the intraday-adjusted GEX model; the gross *Premium fields
   * above are unchanged. Only populated when an NBBO reference was available for the contract;
   * otherwise the print contributes 0 here (and `classifiedPrints` does not count it).
   */
  netCallPremiumSigned: number;
  netPutPremiumSigned: number;
  /**
   * SIGNED net CUSTOMER contract count (Σ side · size) by type — the quantity used to convert
   * intraday flow into a dollar-gamma adjustment (premium is path-dependent on price; contracts
   * are what hedging scales with). Positive = net customer LONG that side intraday.
   */
  netCallContractsSigned: number;
  netPutContractsSigned: number;
  /** Number of prints at this strike that COULD be side-classified (had a usable NBBO). */
  classifiedPrints: number;
};

/** The aggregated reconstruction for one ticker/window. */
export type OptionTradesAggregate = {
  ticker: string;
  optionsRoot: string;
  expiry: string;
  windowStartMs: number;
  windowEndMs: number;
  /** Σ premium across every counted single-leg print. */
  totalPremium: number;
  callPremium: number;
  putPremium: number;
  /** total / call / put PRINT counts. */
  totalPrints: number;
  callPrints: number;
  putPrints: number;
  /** call$ / (call$+put$) × 100, 0..100 (50 when both zero). */
  callPct: number;
  byStrike: StrikePremium[];
  /** How bounded the pull actually was (for honest diagnostics). */
  meta: {
    contractsRequested: number;
    contractsWithTrades: number;
    contractsCapped: boolean;
    /** prints dropped as multi-leg / canceled-late. */
    filteredPrints: number;
    /** true when at least one upstream contract pull failed (partial result). */
    partial: boolean;
    /**
     * SIDE-CLASSIFICATION coverage: how many counted prints carried a usable NBBO (from the SAME
     * banded discovery snapshot — NO extra fan-out) so the quote rule could sign them, and the
     * total counted. coverage = sideClassifiedPrints / totalPrints. Low coverage ⇒ the signed
     * fields are a weak sample (the intraday-adjusted model degrades toward the OI base).
     */
    sideClassifiedPrints: number;
  };
};

type RawTrade = {
  price?: number;
  size?: number;
  decimal_size?: string;
  conditions?: number[];
  sip_timestamp?: number; // nanoseconds
  participant_timestamp?: number;
};
type TradesResponse = { results?: RawTrade[]; next_url?: string; status?: string };

type ChainRow = {
  ticker?: string; // OCC, e.g. "O:SPXW260626C07340000"
  details?: { strike_price?: number; contract_type?: string; expiration_date?: string };
  /** Last NBBO from the SAME banded snapshot — used (for free) to side-classify trades. */
  last_quote?: { bid?: number; ask?: number };
};
type ChainSnapResponse = { results?: ChainRow[]; next_url?: string };

/** A discovered contract + its contemporaneous NBBO (bid/ask) from the banded snapshot. */
type DiscoveredContract = {
  occ: string;
  strike: number;
  type: "call" | "put";
  /** NBBO bid/ask from the discovery snapshot; null when the contract had no usable quote. */
  bid: number | null;
  ask: number | null;
};

/** True iff this print's conditions exclude it (multi-leg or canceled/late). */
function isExcludedTrade(conditions: number[] | undefined): boolean {
  if (!conditions || conditions.length === 0) return false; // a clean print may carry no condition
  for (const c of conditions) {
    if (MULTILEG_CONDITIONS.has(c) || CANCELED_LATE_CONDITIONS.has(c)) return true;
  }
  return false;
}

/** Resolve spot for an options root (index vs equity), null when unavailable. */
async function spotFor(optionsRoot: string): Promise<number> {
  const isIndex = optionsRoot.startsWith("I:");
  const snap = isIndex
    ? await fetchIndexSnapshot(optionsRoot).catch(() => null)
    : await fetchStockSnapshot(optionsRoot).catch(() => null);
  return snap?.price && snap.price > 0 ? snap.price : 0;
}

/**
 * Discover up to MAX_CONTRACTS near-the-money OCC contracts (with strike + type) for the given
 * underlying + expiry via ONE banded chain snapshot. Returns OCCs the trades endpoint can take.
 * Bounded: a strike band around spot + a hard slice to MAX_CONTRACTS (closest-to-spot kept).
 */
async function discoverNearTheMoneyContracts(
  optionsRoot: string,
  spot: number,
  expiry: string
): Promise<{ contracts: DiscoveredContract[]; capped: boolean }> {
  const band = Math.max(spot * STRIKE_BAND_PCT, 80);
  const lo = Math.floor(spot - band);
  const hi = Math.ceil(spot + band);
  const params = new URLSearchParams({
    expiration_date: expiry,
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
  });
  const page = await polygonRawJson<ChainSnapResponse>(
    `/v3/snapshot/options/${optionsRoot}?${params}`,
    "option-trades/chain-band"
  );
  const rows = page?.results ?? [];
  const all: DiscoveredContract[] = [];
  for (const r of rows) {
    const occ = typeof r.ticker === "string" ? r.ticker : "";
    const strike = Number(r.details?.strike_price);
    const t = String(r.details?.contract_type ?? "").toLowerCase();
    if (!occ || !Number.isFinite(strike) || strike <= 0) continue;
    if (t !== "call" && t !== "put") continue;
    // Capture the contemporaneous NBBO from the SAME snapshot (no extra fetch) for side-classification.
    const bRaw = Number(r.last_quote?.bid);
    const aRaw = Number(r.last_quote?.ask);
    const bid = Number.isFinite(bRaw) && bRaw > 0 ? bRaw : null;
    const ask = Number.isFinite(aRaw) && aRaw > 0 ? aRaw : null;
    all.push({ occ, strike, type: t, bid, ask });
  }
  // Keep the contracts CLOSEST to spot (most-traded ATM band) within the cap.
  all.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  const capped = all.length > MAX_CONTRACTS;
  return { contracts: all.slice(0, MAX_CONTRACTS), capped };
}

/** Pull recent trades for ONE OCC inside the window. Bounded by MAX_PAGES_PER_CONTRACT. */
async function fetchTradesForContract(
  occ: string,
  windowStartNs: number
): Promise<{ trades: RawTrade[]; ok: boolean }> {
  const params = new URLSearchParams({
    "timestamp.gte": String(windowStartNs),
    order: "desc",
    sort: "timestamp",
    limit: String(TRADES_PAGE_LIMIT),
  });
  let path: string | null = `/v3/trades/${encodeURIComponent(occ)}?${params}`;
  const out: RawTrade[] = [];
  let pages = 0;
  let sawResponse = false;
  while (path && pages < MAX_PAGES_PER_CONTRACT) {
    const page: TradesResponse | null = await polygonRawJson<TradesResponse>(path, "option-trades/trades");
    if (!page) break; // upstream failure for this contract — partial, not fatal
    sawResponse = true;
    out.push(...(page.results ?? []));
    path = page.next_url ?? null;
    pages += 1;
  }
  return { trades: out, ok: sawResponse };
}

function tradeMs(t: RawTrade): number {
  // sip_timestamp is nanoseconds (probe-verified ~1.78e18). Fall back to participant ts.
  const ns = Number(t.sip_timestamp ?? t.participant_timestamp ?? 0);
  return ns > 0 ? Math.floor(ns / 1e6) : 0;
}

/**
 * Reconstruct + aggregate recent option-trade premium for a ticker from Massive's per-OCC trades
 * endpoint. INDEPENDENT of Unusual Whales. Bounded (contract cap + page cap), rate-limited (the
 * Polygon funnel), cached (short TTL). Never throws — returns null only when not configured / no
 * spot; otherwise returns the aggregate (possibly partial, flagged in `meta`).
 *
 * @param ticker     underlying symbol (SPX/SPY/NVDA/… — index roots resolved to I:*).
 * @param windowMin  lookback minutes (default 60).
 * @param expiry     YYYY-MM-DD (default today ET — 0DTE/front).
 */
export async function fetchOptionTrades(
  ticker: string,
  windowMin: number = DEFAULT_WINDOW_MIN,
  expiry: string = todayEtYmd()
): Promise<OptionTradesAggregate | null> {
  if (!polygonConfigured()) return null;
  const { root, optionsRoot } = resolveOptionsRoot(ticker);
  const win = Math.max(1, Math.floor(windowMin));
  const cacheKey = `option-trades:${optionsRoot}:${expiry}:${win}m`;

  return serverCache(cacheKey, RECON_TTL_MS, async () => {
    const now = Date.now();
    const windowEndMs = now;
    const windowStartMs = now - win * 60_000;

    const spot = await spotFor(optionsRoot);
    if (!(spot > 0)) {
      return emptyAggregate(root, optionsRoot, expiry, windowStartMs, windowEndMs);
    }

    const { contracts, capped } = await discoverNearTheMoneyContracts(optionsRoot, spot, expiry);
    if (contracts.length === 0) {
      return emptyAggregate(root, optionsRoot, expiry, windowStartMs, windowEndMs, { contractsCapped: capped });
    }

    const windowStartNs = windowStartMs * 1e6;
    const byStrike = new Map<number, StrikePremium>();
    let totalPremium = 0;
    let callPremium = 0;
    let putPremium = 0;
    let totalPrints = 0;
    let callPrints = 0;
    let putPrints = 0;
    let filteredPrints = 0;
    let contractsWithTrades = 0;
    let partial = false;
    let sideClassifiedPrints = 0;

    // SEQUENTIAL fan-out: each call already awaits a funnel slot (token bucket + concurrency cap),
    // so iterating is naturally paced and bounded by MAX_CONTRACTS — no unbounded Promise.all burst.
    for (const c of contracts) {
      const { trades, ok } = await fetchTradesForContract(c.occ, windowStartNs);
      if (!ok) {
        partial = true;
        continue;
      }
      let counted = 0;
      for (const t of trades) {
        const ms = tradeMs(t);
        // Upstream may return trades slightly outside the window on a page boundary — re-filter.
        if (ms > 0 && (ms < windowStartMs || ms > windowEndMs)) continue;
        if (isExcludedTrade(t.conditions)) {
          filteredPrints += 1;
          continue;
        }
        const price = Number(t.price);
        const size = Number(t.decimal_size ?? t.size);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue;
        const premium = price * size * 100;
        counted += 1;
        totalPremium += premium;
        totalPrints += 1;
        if (c.type === "call") {
          callPremium += premium;
          callPrints += 1;
        } else {
          putPremium += premium;
          putPrints += 1;
        }
        // SIDE classification via the quote rule against the contract's discovery-snapshot NBBO
        // (no per-trade fetch). side ∈ {−1,0,+1}; 0 = at-mid/unclassifiable → not signed, not counted.
        const side = classifyTradeSide(price, c.bid, c.ask);
        const signedPremium = side !== 0 ? side * premium : 0;
        if (side !== 0) sideClassifiedPrints += 1;
        const signedContracts = side !== 0 ? side * size : 0;
        const sp = byStrike.get(c.strike) ?? {
          strike: c.strike,
          callPremium: 0,
          putPremium: 0,
          totalPremium: 0,
          prints: 0,
          netCallPremiumSigned: 0,
          netPutPremiumSigned: 0,
          netCallContractsSigned: 0,
          netPutContractsSigned: 0,
          classifiedPrints: 0,
        };
        if (c.type === "call") {
          sp.callPremium += premium;
          sp.netCallPremiumSigned += signedPremium;
          sp.netCallContractsSigned += signedContracts;
        } else {
          sp.putPremium += premium;
          sp.netPutPremiumSigned += signedPremium;
          sp.netPutContractsSigned += signedContracts;
        }
        sp.totalPremium += premium;
        sp.prints += 1;
        if (side !== 0) sp.classifiedPrints += 1;
        byStrike.set(c.strike, sp);
      }
      if (counted > 0) contractsWithTrades += 1;
    }

    const callPutTotal = callPremium + putPremium;
    const callPct = callPutTotal > 0 ? Math.round((callPremium / callPutTotal) * 100) : 50;
    const byStrikeArr = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

    return {
      ticker: root,
      optionsRoot,
      expiry,
      windowStartMs,
      windowEndMs,
      totalPremium,
      callPremium,
      putPremium,
      totalPrints,
      callPrints,
      putPrints,
      callPct,
      byStrike: byStrikeArr,
      meta: {
        contractsRequested: contracts.length,
        contractsWithTrades,
        contractsCapped: capped,
        filteredPrints,
        partial,
        sideClassifiedPrints,
      },
    } satisfies OptionTradesAggregate;
  });
}

function emptyAggregate(
  ticker: string,
  optionsRoot: string,
  expiry: string,
  windowStartMs: number,
  windowEndMs: number,
  metaOverride: Partial<OptionTradesAggregate["meta"]> = {}
): OptionTradesAggregate {
  return {
    ticker,
    optionsRoot,
    expiry,
    windowStartMs,
    windowEndMs,
    totalPremium: 0,
    callPremium: 0,
    putPremium: 0,
    totalPrints: 0,
    callPrints: 0,
    putPrints: 0,
    callPct: 50,
    byStrike: [],
    meta: {
      contractsRequested: 0,
      contractsWithTrades: 0,
      contractsCapped: false,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: 0,
      ...metaOverride,
    },
  };
}
