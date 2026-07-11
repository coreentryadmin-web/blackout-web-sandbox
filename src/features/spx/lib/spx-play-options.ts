import { polygonConfigured } from "@/lib/providers/config";
import { polygonTrackedFetch } from "@/lib/providers/polygon-rate-limiter";
import { polygonRestApiKey, polygonRestBase } from "@/lib/providers/polygon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { gradeRank } from "@/features/spx/lib/spx-play-config";
import { effectiveChainMaxSpreadPct } from "@/features/spx/lib/spx-play-chain";
import { round5 } from "@/lib/round5";

const BASE = polygonRestBase();
const KEY = polygonRestApiKey();

// Underlying ROOT used to query the options snapshot. The SPX-complex options chain
// — including the SPXW weekly 0DTE contracts whose OCC ticker is "O:SPXW...EXP..." —
// must be queried under the INDEX ticker "I:SPX". Verified live against the provider:
//   - "SPXW"  → 0 results (blocked every play open historically; empty ledger).
//   - "SPX"   → returns contracts but with NO greeks (delta = undefined), so the
//               delta-band filter in the chain matcher rejects EVERY contract →
//               "No liquid chain match — index plan only" → tickets show premium "—".
//   - "I:SPX" → returns the same contracts WITH greeks + quotes + OI/volume, so the
//               matcher resolves a real liquid 0DTE strike and a live premium range.
// per-contract details.ticker still resolves to the correct O:SPXW... symbol.
// Overridable in case the provider's indexing changes.
const CHAIN_UNDERLYING = (process.env.SPX_CHAIN_UNDERLYING ?? "I:SPX").trim();

type ChainContract = {
  details?: {
    strike_price?: number;
    contract_type?: string;
    expiration_date?: string;
    ticker?: string;
  };
  greeks?: { delta?: number; gamma?: number };
  open_interest?: number;
  day?: { volume?: number };
  last_quote?: { bid?: number; ask?: number; midpoint?: number };
  implied_volatility?: number;
};

export type OptionTicket = {
  underlying: string;
  strike: number;
  option_type: "call" | "put";
  contract_label: string;
  ticker: string | null;
  expiration_date?: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread_pct: number | null;
  delta: number | null;
  gamma?: number | null;
  theta?: number | null;
  implied_volatility?: number | null;
  volume?: number | null;
  open_interest: number | null;
  premium_range: string;
  blocked: boolean;
  block_reason: string | null;
  /** Cost-adjusted fill model — set when a play opens (playbook evidence layer). */
  execution_sim?: import("@/features/spx/lib/playbook-option-sim").PlaybookOptionExecutionSim | null;
};

let ticketCache: { at: number; spot: number; dir: string; grade: string; ticket: OptionTicket } | null = null;

async function fetchChainUrl(url: string): Promise<{ results?: ChainContract[]; next_url?: string } | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http") ? `${url}${sep}apiKey=${KEY}` : `${BASE}${url}${sep}apiKey=${KEY}`;
  const label = url.startsWith("http") ? `/v3/snapshot/options/${CHAIN_UNDERLYING}` : url.split("?")[0];
  try {
    const res = await polygonTrackedFetch(label, full, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { results?: ChainContract[]; next_url?: string };
  } catch {
    return null;
  }
}

async function fetchOdteContracts(spot: number, expiry: string): Promise<ChainContract[]> {
  const band = Math.max(spot * 0.012, 60);
  const lo = Math.floor(spot - band);
  const hi = Math.ceil(spot + band);
  const params = new URLSearchParams({
    expiration_date: expiry,
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
    apiKey: KEY,
  });

  const out: ChainContract[] = [];
  let page = await fetchChainUrl(`/v3/snapshot/options/${CHAIN_UNDERLYING}?${params}`);
  let guard = 0;
  while (page && guard < 6) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await fetchChainUrl(page.next_url);
    guard += 1;
  }
  return out;
}

function deltaBand(grade: string): { min: number; max: number; target: number } {
  if (gradeRank(grade) >= 4) return { min: 0.45, max: 0.55, target: 0.5 };
  if (gradeRank(grade) >= 3) return { min: 0.35, max: 0.45, target: 0.4 };
  return { min: 0.25, max: 0.35, target: 0.3 };
}

function fallbackStrike(spot: number, type: "call" | "put", steps: number): number {
  const atm = round5(spot);
  if (type === "call") return atm + steps * 5;
  return atm - steps * 5;
}

export async function buildOptionTicket(
  spot: number,
  direction: "long" | "short",
  grade: string
): Promise<OptionTicket> {
  const option_type = direction === "long" ? "call" : "put";
  const empty: OptionTicket = {
    underlying: "SPXW",
    strike: fallbackStrike(spot, option_type, gradeRank(grade) >= 3 ? 0 : 1),
    option_type,
    contract_label: "",
    ticker: null,
    bid: null,
    ask: null,
    mid: null,
    spread_pct: null,
    delta: null,
    open_interest: null,
    premium_range: "—",
    blocked: true,
    block_reason: "Chain unavailable",
  };

  if (!polygonConfigured() || spot <= 0) return empty;

  const now = Date.now();
  if (
    ticketCache &&
    now - ticketCache.at < 45_000 &&
    Math.abs(ticketCache.spot - spot) < 5 &&
    ticketCache.dir === direction &&
    ticketCache.grade === grade
  ) {
    return ticketCache.ticket;
  }

  const expiry = todayEtYmd();
  const contracts = await fetchOdteContracts(spot, expiry);
  const band = deltaBand(grade);
  const maxSpread = effectiveChainMaxSpreadPct();
  const minOi = Number(process.env.SPX_CHAIN_MIN_OI ?? 25);
  const radius = Number(process.env.SPX_CHAIN_STRIKE_RADIUS ?? 40);

  type Scored = { c: ChainContract; score: number };
  const scored: Scored[] = [];
  // All contracts that clear the LIQUIDITY/structure filters (radius, OTM, quoted, spread, OI/vol)
  // regardless of the delta band — used for the closest-to-target fallback below.
  const eligible: { c: ChainContract; delta: number }[] = [];

  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || type !== option_type) continue;
    if (Math.abs(strike - spot) > radius) continue;
    if (option_type === "call" && strike < round5(spot)) continue;
    if (option_type === "put" && strike > round5(spot)) continue;

    const bid = Number(c.last_quote?.bid ?? 0);
    const ask = Number(c.last_quote?.ask ?? 0);
    const mid = ask > 0 && bid > 0 ? (bid + ask) / 2 : ask || bid;
    if (mid <= 0) continue;

    const spreadPct = ask > 0 && bid > 0 ? ((ask - bid) / mid) * 100 : 999;
    if (spreadPct > maxSpread) continue;

    const oi = Number(c.open_interest ?? 0);
    const vol = Number(c.day?.volume ?? 0);
    if (oi < minOi && vol < minOi) continue;

    const delta = Math.abs(Number(c.greeks?.delta ?? 0));
    if (delta <= 0) continue; // need real greeks to assess (provided by the I:SPX snapshot root)
    eligible.push({ c, delta });

    if (delta < band.min || delta > band.max) continue;

    const deltaScore = 1 - Math.abs(delta - band.target) / band.target;
    const liqScore = Math.min(oi, 500) / 500;
    const score = deltaScore * 3 + liqScore - spreadPct / 20;
    scored.push({ c, score });
  }

  scored.sort((a, b) => b.score - a.score);
  // Prefer an in-band contract. But at 0DTE near expiry, gamma makes delta jump sharply across the
  // 5-pt SPX strike grid, so the ideal band can fall BETWEEN two strikes (no in-band match) even
  // though liquid contracts exist on either side. Rather than degrade to an index-only ticket (no
  // premium), fall back to the liquid OTM contract whose delta is CLOSEST to the band target — a
  // real, tradeable strike near the intended delta.
  const best =
    scored[0]?.c ??
    (eligible.length
      ? eligible.reduce((a, b) =>
          Math.abs(a.delta - band.target) <= Math.abs(b.delta - band.target) ? a : b
        ).c
      : undefined);

  if (!best) {
    const strike = fallbackStrike(spot, option_type, gradeRank(grade) >= 3 ? 0 : 1);
    const ticket: OptionTicket = {
      ...empty,
      strike,
      contract_label: `${strike}${option_type === "call" ? "C" : "P"}`,
      blocked: true,
      block_reason: "No liquid chain match — index plan only",
    };
    return ticket;
  }

  const strike = Number(best.details?.strike_price);
  const bid = Number(best.last_quote?.bid ?? 0) || null;
  const ask = Number(best.last_quote?.ask ?? 0) || null;
  const mid = bid && ask ? (bid + ask) / 2 : ask ?? bid;
  const spreadPct = bid && ask && mid ? ((ask - bid) / mid) * 100 : null;
  const lo = bid ?? (mid != null ? mid * 0.97 : null);
  const hi = ask ?? (mid != null ? mid * 1.03 : null);
  const premium_range =
    lo != null && hi != null ? `${lo.toFixed(2)}–${hi.toFixed(2)}` : "—";

  const ticket: OptionTicket = {
    underlying: "SPXW",
    strike,
    option_type,
    contract_label: `${strike}${option_type === "call" ? "C" : "P"}`,
    ticker: best.details?.ticker ?? null,
    expiration_date: best.details?.expiration_date ?? expiry,
    bid,
    ask,
    mid,
    spread_pct: spreadPct,
    delta: Number(best.greeks?.delta ?? 0) || null,
    gamma: Number(best.greeks?.gamma ?? 0) || null,
    implied_volatility: Number(best.implied_volatility ?? 0) || null,
    volume: Number(best.day?.volume ?? 0) || null,
    open_interest: Number(best.open_interest ?? 0) || null,
    premium_range,
    blocked: false,
    block_reason: null,
  };

  ticketCache = { at: now, spot, dir: direction, grade, ticket };
  return ticket;
}

export type OdteContractQuote = {
  strike: number;
  option_type: "call" | "put";
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread_pct: number | null;
  /** Mid for chip `@ 5.2`, or bid–ask band when spread is wide */
  premium_display: string;
  delta: number | null;
  as_of: number;
};

const quoteCache = new Map<string, { at: number; quote: OdteContractQuote }>();
const QUOTE_TTL_MS = Number(process.env.SPX_CHAIN_QUOTE_TTL_MS ?? 5_000);

async function fetchContractsAtStrike(
  strike: number,
  expiry: string
): Promise<ChainContract[]> {
  const params = new URLSearchParams({
    expiration_date: expiry,
    "strike_price.gte": String(strike),
    "strike_price.lte": String(strike),
    limit: "50",
    apiKey: KEY,
  });
  const page = await fetchChainUrl(`/v3/snapshot/options/${CHAIN_UNDERLYING}?${params}`);
  return page?.results ?? [];
}

/** Live 0DTE mark for a held SPXW strike — used on Open desk chips + play terminal. */
export async function quoteSpxOdteContract(
  strike: number,
  option_type: "call" | "put",
  expiry = todayEtYmd()
): Promise<OdteContractQuote | null> {
  if (!polygonConfigured() || !Number.isFinite(strike) || strike <= 0) return null;

  const key = `${expiry}:${option_type}:${Math.round(strike)}`;
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;

  const contracts = await fetchContractsAtStrike(Math.round(strike), expiry);
  const match = contracts.find((c) => {
    const s = Number(c.details?.strike_price);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    return Number.isFinite(s) && Math.round(s) === Math.round(strike) && type === option_type;
  });
  if (!match) return null;

  const bid = Number(match.last_quote?.bid ?? 0) || null;
  const ask = Number(match.last_quote?.ask ?? 0) || null;
  const mid =
    bid != null && ask != null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : ask ?? bid;
  if (mid == null || mid <= 0) return null;

  const spread_pct =
    bid != null && ask != null && mid > 0 ? ((ask - bid) / mid) * 100 : null;
  const premium_display =
    bid != null && ask != null && bid > 0 && ask > 0
      ? mid.toFixed(2)
      : `${(bid ?? mid).toFixed(2)}–${(ask ?? mid).toFixed(2)}`;

  const quote: OdteContractQuote = {
    strike: Math.round(strike),
    option_type,
    bid,
    ask,
    mid,
    spread_pct,
    premium_display,
    delta: Number(match.greeks?.delta ?? 0) || null,
    as_of: Date.now(),
  };
  quoteCache.set(key, { at: quote.as_of, quote });
  return quote;
}
