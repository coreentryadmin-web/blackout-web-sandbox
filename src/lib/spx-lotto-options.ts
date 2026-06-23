import { polygonConfigured } from "@/lib/providers/config";
import { trackedFetch } from "@/lib/api-tracked-fetch";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { playLottoChainMaxSpreadPct, playLottoTargetPts } from "@/lib/spx-play-config";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import type { OptionTicket } from "@/lib/spx-play-options";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

type ChainContract = {
  details?: {
    strike_price?: number;
    contract_type?: string;
    ticker?: string;
  };
  greeks?: { delta?: number };
  open_interest?: number;
  day?: { volume?: number };
  last_quote?: { bid?: number; ask?: number };
};

let lottoTicketCache: {
  at: number;
  spot: number;
  dir: SpxPlayDirection;
  date: string;       // todayEtYmd() — invalidates on session rollover
  vixBucket: string;  // "lo" | "mid" | "hi" — invalidates when VIX regime changes
  ticket: OptionTicket;
} | null = null;

/**
 * VIX-adjusted premium cap. When volatility is elevated, fair-value OTM premiums
 * are higher: $0.85 is reasonable in a low-VIX environment but would block all
 * viable contracts when VIX > 20 and options are priced for wider moves.
 */
function lottoMaxPremium(vix?: number | null): number {
  const envOverride = process.env.SPX_LOTTO_MAX_PREMIUM;
  if (envOverride) return Number(envOverride);
  if (vix != null && vix > 20) return 2.0;
  if (vix != null && vix > 16) return 1.5;
  return 0.85;
}

function vixBucket(vix?: number | null): string {
  if (vix == null) return "unknown";
  if (vix > 20) return "hi";
  if (vix > 16) return "mid";
  return "lo";
}

async function fetchChainUrl(url: string): Promise<{ results?: ChainContract[]; next_url?: string } | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http") ? `${url}${sep}apiKey=${KEY}` : `${BASE}${url}${sep}apiKey=${KEY}`;
  const label = url.startsWith("http") ? "/v3/snapshot/options/SPXW" : url.split("?")[0];
  try {
    const res = await trackedFetch("polygon", label, full, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { results?: ChainContract[]; next_url?: string };
  } catch {
    return null;
  }
}

async function fetchOdteContracts(spot: number, expiry: string): Promise<ChainContract[]> {
  const band = Math.max(spot * 0.02, playLottoTargetPts() + 15);
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
  let page = await fetchChainUrl(`/v3/snapshot/options/SPXW?${params}`);
  let guard = 0;
  while (page && guard < 6) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await fetchChainUrl(page.next_url);
    guard += 1;
  }
  return out;
}

function fallbackLottoStrike(spot: number, direction: SpxPlayDirection): number {
  // Use playLottoTargetPts() (~25 pts) OTM, not suggestPlayStrike("D") which returns ATM+5 then +10 = ATM+15,
  // violating the lotto's own ±25pt OTM criterion.
  const base = Math.round(spot / 5) * 5;
  return base + (direction === "long" ? playLottoTargetPts() : -playLottoTargetPts());
}

/**
 * Far-OTM lotto ticket — wider spread cap than main plays (default 50%).
 * Main play filter (18–20%) rejects typical $0.30–$0.50 OTM quotes.
 * VIX adjusts the max premium cap so elevated-vol sessions can still find
 * viable contracts (VIX <16 → $0.85 | VIX 16-20 → $1.50 | VIX >20 → $2.00).
 */
export async function buildLottoOptionTicket(
  spot: number,
  direction: SpxPlayDirection,
  vix?: number | null
): Promise<OptionTicket> {
  const option_type = direction === "long" ? "call" : "put";
  const fallbackStrike = fallbackLottoStrike(spot, direction);
  const empty: OptionTicket = {
    underlying: "SPXW",
    strike: fallbackStrike,
    option_type,
    contract_label: `${fallbackStrike}${option_type === "call" ? "C" : "P"}`,
    ticker: null,
    bid: null,
    ask: null,
    mid: null,
    spread_pct: null,
    delta: null,
    open_interest: null,
    premium_range: "—",
    blocked: true,
    block_reason: "Chain unavailable — estimated premium only",
  };

  if (!polygonConfigured() || spot <= 0) return empty;

  const now = Date.now();
  const today = todayEtYmd();
  const currentVixBucket = vixBucket(vix);
  if (
    lottoTicketCache &&
    lottoTicketCache.date === today &&
    lottoTicketCache.vixBucket === currentVixBucket &&
    now - lottoTicketCache.at < 60_000 &&
    Math.abs(lottoTicketCache.spot - spot) < 8 &&
    lottoTicketCache.dir === direction
  ) {
    return lottoTicketCache.ticket;
  }

  const maxSpread = playLottoChainMaxSpreadPct();
  const minOtmPts = playLottoTargetPts();
  const minPremium = Number(process.env.SPX_LOTTO_MIN_PREMIUM ?? 0.2);
  const maxPremium = lottoMaxPremium(vix);
  const minOi = Number(process.env.SPX_LOTTO_CHAIN_MIN_OI ?? 5);

  const contracts = await fetchOdteContracts(spot, todayEtYmd());
  type Scored = { c: ChainContract; score: number };
  const scored: Scored[] = [];

  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || type !== option_type) continue;

    const otmPts = direction === "long" ? strike - spot : spot - strike;
    if (otmPts < minOtmPts - 5) continue;

    const bid = Number(c.last_quote?.bid ?? 0);
    const ask = Number(c.last_quote?.ask ?? 0);
    const mid = ask > 0 && bid > 0 ? (bid + ask) / 2 : ask || bid;
    if (mid < minPremium || mid > maxPremium) continue;

    const spreadPct = ask > 0 && bid > 0 ? ((ask - bid) / mid) * 100 : 999;
    if (spreadPct > maxSpread) continue;

    const oi = Number(c.open_interest ?? 0);
    const vol = Number(c.day?.volume ?? 0);
    if (oi < minOi && vol < minOi) continue;

    const delta = Math.abs(Number(c.greeks?.delta ?? 0));
    const otmScore = Math.min(otmPts / (minOtmPts + 10), 1.5);
    const premScore = 1 - Math.abs(mid - 0.45) / 0.45;
    const spreadScore = 1 - spreadPct / maxSpread;
    const score = otmScore * 2 + premScore + spreadScore - delta * 0.5;
    scored.push({ c, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.c;

  if (!best) {
    return {
      ...empty,
      block_reason: `No lotto strike ≤${maxSpread}% spread in $${minPremium.toFixed(2)}–$${maxPremium.toFixed(2)} band`,
    };
  }

  const strike = Number(best.details?.strike_price);
  const bid = Number(best.last_quote?.bid ?? 0) || null;
  const ask = Number(best.last_quote?.ask ?? 0) || null;
  const mid = bid && ask ? (bid + ask) / 2 : ask ?? bid;
  const spreadPct = bid && ask && mid ? ((ask - bid) / mid) * 100 : null;
  const lo = bid ?? (mid != null ? mid * 0.92 : null);
  const hi = ask ?? (mid != null ? mid * 1.08 : null);
  const premium_range =
    lo != null && hi != null ? `$${lo.toFixed(2)}–$${hi.toFixed(2)}` : "—";

  const ticket: OptionTicket = {
    underlying: "SPXW",
    strike,
    option_type,
    contract_label: `${strike}${option_type === "call" ? "C" : "P"}`,
    ticker: best.details?.ticker ?? null,
    bid,
    ask,
    mid,
    spread_pct: spreadPct,
    delta: Number(best.greeks?.delta ?? 0) || null,
    open_interest: Number(best.open_interest ?? 0) || null,
    premium_range,
    blocked: false,
    block_reason: null,
  };

  lottoTicketCache = { at: now, spot, dir: direction, date: today, vixBucket: currentVixBucket, ticket };
  return ticket;
}
