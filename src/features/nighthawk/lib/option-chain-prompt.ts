import type { TickerDossier } from "./dossier";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import {
  fetchPolygonAtmOptionsChain,
  fetchPolygonOiByExpiry,
} from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot } from "@/lib/providers/polygon";
import { getStockLiveCandle } from "@/lib/ws/stock-candle-store";
import { fetchUwOptionChains } from "@/lib/providers/unusual-whales";
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import type { PlaybookPlay } from "./types";

// Widened from ±5% to ±12% — the ±5% band blocked OTM options that are cheaper (under
// the $35/share premium cap) and common in real swing-trade options plays. For a $150 stock
// this expands the window from $142.50-$157.50 to $132-$168, capturing many more liquid strikes.
const ATM_BAND_PCT = 0.12;
// Increased from 3 to 5 — weeklies 2-3 weeks out often have better OI/liquidity than the
// nearest expiry, especially for smaller-cap names where front-week OI is thin.
const FRONT_EXPIRIES = 5;

export type ChainStrikeRow = {
  expiry: string;
  strike: number;
  call_bid: number | null;
  call_ask: number | null;
  call_delta: number | null;
  call_oi: number;
  call_iv: number | null;
  put_bid: number | null;
  put_ask: number | null;
  put_delta: number | null;
  put_oi: number;
  put_iv: number | null;
};

function buildOcc(ticker: string, expiryYmd: string, side: "call" | "put", strike: number): string | null {
  const root = ticker.trim().toUpperCase() === "SPX" ? "SPXW" : ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(root)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiryYmd.slice(0, 10));
  if (!m) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const strikeInt = Math.round(strike * 1000);
  if (strikeInt <= 0 || strikeInt > 99_999_999) return null;
  return `O:${root}${m[1].slice(2)}${m[2]}${m[3]}${side === "call" ? "C" : "P"}${String(strikeInt).padStart(8, "0")}`;
}

function rowFromOptionSnapshot(snap: OptionSnapshot): ChainStrikeRow | null {
  if (!snap.expiry || snap.strike == null || snap.optionType == null) return null;
  const base: ChainStrikeRow = {
    expiry: snap.expiry,
    strike: snap.strike,
    call_bid: null,
    call_ask: null,
    call_delta: null,
    call_oi: 0,
    call_iv: null,
    put_bid: null,
    put_ask: null,
    put_delta: null,
    put_oi: 0,
    put_iv: null,
  };
  if (snap.optionType === "call") {
    base.call_bid = snap.bid;
    base.call_ask = snap.ask;
    base.call_delta = snap.delta;
    base.call_oi = Math.max(0, Math.round(snap.openInterest ?? 0));
    base.call_iv = snap.iv;
  } else {
    base.put_bid = snap.bid;
    base.put_ask = snap.ask;
    base.put_delta = snap.delta;
    base.put_oi = Math.max(0, Math.round(snap.openInterest ?? 0));
    base.put_iv = snap.iv;
  }
  return base;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtExpiryLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return label.replace(/\s+/g, "");
}

function fmtPx(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(2);
}

function fmtDelta(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
}

function fmtOi(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function withinAtmBand(strike: number, spot: number): boolean {
  if (spot <= 0 || strike <= 0) return false;
  return Math.abs(strike - spot) / spot <= ATM_BAND_PCT;
}

function pivotPolygonContracts(
  contracts: Awaited<ReturnType<typeof fetchPolygonAtmOptionsChain>>,
  spot: number
): ChainStrikeRow[] {
  const byKey = new Map<string, ChainStrikeRow>();

  for (const c of contracts) {
    const strike = num(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!expiry || !withinAtmBand(strike, spot)) continue;

    const key = `${expiry}|${strike}`;
    const row =
      byKey.get(key) ??
      ({
        expiry,
        strike,
        call_bid: null,
        call_ask: null,
        call_delta: null,
        call_oi: 0,
        call_iv: null,
        put_bid: null,
        put_ask: null,
        put_delta: null,
        put_oi: 0,
        put_iv: null,
      } satisfies ChainStrikeRow);

    const quote = (c as { last_quote?: { bid?: number; ask?: number } }).last_quote;
    let bid = num(quote?.bid);
    let ask = num(quote?.ask);
    // After-hours fallback: when bid/ask are 0 (market closed, no live quotes),
    // use last_trade.price or day.close so the contract premium can still be estimated.
    if (ask <= 0) {
      const lastTrade = num((c as { last_trade?: { price?: number } }).last_trade?.price);
      const dayClose = num((c as { day?: { close?: number } }).day?.close);
      const fallback = lastTrade > 0 ? lastTrade : dayClose;
      if (fallback > 0) {
        ask = fallback;
        if (bid <= 0) bid = fallback * 0.95;
      }
    }
    const delta = num((c as { greeks?: { delta?: number } }).greeks?.delta) ?? null;
    const oi = num(c.open_interest);
    const iv = num((c as { implied_volatility?: number }).implied_volatility) ?? null;

    if (type === "call") {
      row.call_bid = bid;
      row.call_ask = ask;
      row.call_delta = delta;
      row.call_oi = oi;
      row.call_iv = iv;
    } else if (type === "put") {
      row.put_bid = bid;
      row.put_ask = ask;
      row.put_delta = delta;
      row.put_oi = oi;
      row.put_iv = iv;
    }
    byKey.set(key, row);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
    return a.strike - b.strike;
  });
}

function pivotUwRows(rows: Record<string, unknown>[], spot: number, expiries: string[]): ChainStrikeRow[] {
  const expirySet = new Set(expiries);
  const byKey = new Map<string, ChainStrikeRow>();

  for (const r of rows) {
    const strike = num(r.strike ?? r.strike_price);
    const expiry = String(r.expiry ?? r.expiration ?? r.expiration_date ?? "").slice(0, 10);
    if (!expiry || !expirySet.has(expiry) || !withinAtmBand(strike, spot)) continue;

    const key = `${expiry}|${strike}`;
    const row =
      byKey.get(key) ??
      ({
        expiry,
        strike,
        call_bid: null,
        call_ask: null,
        call_delta: null,
        call_oi: 0,
        call_iv: null,
        put_bid: null,
        put_ask: null,
        put_delta: null,
        put_oi: 0,
        put_iv: null,
      } satisfies ChainStrikeRow);

    const opt = String(r.type ?? r.option_type ?? "").toLowerCase();
    const bid = num(r.bid ?? r.call_bid ?? r.put_bid) ?? null;
    const ask = num(r.ask ?? r.call_ask ?? r.put_ask) ?? null;
    const delta = num(r.delta ?? r.call_delta ?? r.put_delta) ?? null;
    const oi = num(r.open_interest ?? r.oi);
    const iv = num(r.iv ?? r.implied_volatility) ?? null;

    if (opt.startsWith("c")) {
      row.call_bid = bid;
      row.call_ask = ask;
      row.call_delta = delta;
      row.call_oi = oi;
      row.call_iv = iv;
    } else if (opt.startsWith("p")) {
      row.put_bid = bid;
      row.put_ask = ask;
      row.put_delta = delta;
      row.put_oi = oi;
      row.put_iv = iv;
    }
    byKey.set(key, row);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
    return a.strike - b.strike;
  });
}

export function formatChainTableText(ticker: string, price: number, rows: ChainStrikeRow[]): string {
  // As-of stamp (audit MEDIUM: no timestamps anywhere in the prompt — the edition
  // builds after-hours, so every quote is a last print, and the model had no way to
  // know how fresh its numbers were).
  const asOf = new Date().toISOString().slice(0, 16) + "Z";
  if (!rows.length) {
    return `${ticker} chain (price $${price.toFixed(2)}, as of ${asOf}, after-hours last prints): no ATM ±${Math.round(ATM_BAND_PCT * 100)}% contracts for front expiries.`;
  }

  const header =
    "EXPIRY     STRIKE  C_BID  C_ASK  C_DELTA  C_OI    P_BID  P_ASK  P_DELTA  P_OI";
  const lines = rows.map((r) => {
    const exp = fmtExpiryLabel(r.expiry).padEnd(10);
    const strike = String(r.strike).padEnd(7);
    const cBid = fmtPx(r.call_bid).padStart(5);
    const cAsk = fmtPx(r.call_ask).padStart(5);
    const cDelta = fmtDelta(r.call_delta).padStart(7);
    const cOi = fmtOi(r.call_oi).padStart(7);
    const pBid = fmtPx(r.put_bid).padStart(5);
    const pAsk = fmtPx(r.put_ask).padStart(5);
    const pDelta = fmtDelta(r.put_delta).padStart(7);
    const pOi = fmtOi(r.put_oi).padStart(7);
    return `${exp}${strike}${cBid}  ${cAsk}  ${cDelta}  ${cOi}  ${pBid}  ${pAsk}  ${pDelta}  ${pOi}`;
  });

  return [`${ticker} chain (price $${price.toFixed(2)}, as of ${asOf}, after-hours last prints):`, header, ...lines].join("\n");
}

async function resolveSpot(ticker: string, dossier?: TickerDossier): Promise<number> {
  const fromDossier = dossier?.tech?.price;
  if (fromDossier != null && fromDossier > 0) return fromDossier;
  const c = getStockLiveCandle(ticker);
  if (c.current && c.current.close > 0) return c.current.close;
  const snap = await fetchStockSnapshot(ticker).catch(() => null);
  return snap?.price ?? 0;
}

async function frontExpiries(ticker: string): Promise<string[]> {
  const fromPolygon = await fetchPolygonOiByExpiry(ticker, FRONT_EXPIRIES + 4);
  if (fromPolygon.length) {
    return fromPolygon.slice(0, FRONT_EXPIRIES).map((r) => r.expiry);
  }

  if (!uwConfigured()) return [];
  const uwRows = await fetchUwOptionChains(ticker, 500).catch(() => []);
  const unique = Array.from(
    new Set(
      uwRows
        .map((r) => String(r.expiry ?? r.expiration ?? r.expiration_date ?? "").slice(0, 10))
        .filter(Boolean)
    )
  ).sort();
  return unique.slice(0, FRONT_EXPIRIES);
}

async function resolveTickerChainRows(
  ticker: string,
  dossier?: TickerDossier
): Promise<{ spot: number; rows: ChainStrikeRow[] } | null> {
  const sym = ticker.toUpperCase();
  const spot = await resolveSpot(sym, dossier);
  if (spot <= 0) return null;

  const expiries = await frontExpiries(sym);
  if (!expiries.length) return null;

  let rows: ChainStrikeRow[] = [];

  if (polygonConfigured()) {
    const contractBatches = await Promise.all(
      expiries.map((exp) => fetchPolygonAtmOptionsChain(sym, spot, exp, ATM_BAND_PCT).catch(() => []))
    );
    rows = pivotPolygonContracts(contractBatches.flat(), spot).filter((r) => expiries.includes(r.expiry));
  }

  if (!rows.length && uwConfigured()) {
    const uwRows = await fetchUwOptionChains(sym, 500).catch(() => []);
    rows = pivotUwRows(uwRows as Record<string, unknown>[], spot, expiries);
  }

  if (!rows.length) return null;
  return { spot, rows };
}

export type ParsedOptionsContract = {
  strike: number;
  side: "call" | "put" | null;
  expiryYmd: string | null;
};

export function parseOptionsContract(optionsPlay: string): ParsedOptionsContract | null {
  const text = optionsPlay.trim();
  if (!text || text === "—") return null;

  const sideMatch = text.match(/\b(CALL|PUT|C|P)\b/i);
  const sideRaw = sideMatch?.[1]?.toUpperCase() ?? "";
  const side: "call" | "put" | null =
    sideRaw.startsWith("C") ? "call" : sideRaw.startsWith("P") ? "put" : null;

  const strikeMatch =
    text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:C|P|call|put)\b/i) ??
    text.match(/\b(?:call|put|calls|puts)\s*@?\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/(?:strike|@)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/\b(\d+(?:\.\d+)?)\s*(?:C|P)\b/i);
  const strike = strikeMatch?.[1] ? Number(strikeMatch[1]) : NaN;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  let expiryYmd = isoMatch?.[1] ?? null;
  if (!expiryYmd) {
    const labelMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})\b/i);
    if (labelMatch) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const year = today.getFullYear();
      let parsed = new Date(`${labelMatch[1]} ${labelMatch[2]}, ${year} 12:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        // Roll to next year only when the date is strictly before today (expired).
        // Do NOT subtract a buffer — that causes January expiries to be rejected
        // as "past" when running on Dec 27-31 and rolled to the wrong year.
        if (parsed < today) {
          parsed = new Date(`${labelMatch[1]} ${labelMatch[2]}, ${year + 1} 12:00:00`);
        }
        expiryYmd = parsed.toISOString().slice(0, 10);
      }
    }
  }

  return { strike, side, expiryYmd };
}

/**
 * Strike-validation outcome. `ok` is whether the play may proceed to publish. We deliberately
 * distinguish "verified against the chain" from "could not be disproven by the chain" so the
 * caller can SOFT-gate: only a positive contradiction (the contract IS in the chain but fails the
 * OI floor) should drop a play. A non-match is NOT a contradiction — the prefetched chain only
 * covers ATM ±5% on the front TWO expiries, so any legitimately longer-dated (swing/leap) or
 * slightly-OTM contract Claude picks will simply be absent. Hard-rejecting on absence was the #77
 * over-filter that zeroed every edition: 17 candidates → 0 plays because none of Claude's chosen
 * expiries/strikes happened to land inside that narrow front-expiry ATM window.
 */
/** Default OI floor for the SOFT chain-contradiction check below (task #141: named so the
 *  durable illiquid-strike rejection audit row can cite the exact threshold that fired,
 *  instead of a bare `500` literal duplicated at each call site). Value unchanged. */
export const STRIKE_MIN_OI = 500;

export type StrikeValidation = {
  /** May the play proceed? True unless the chain positively contradicts it (present but illiquid). */
  ok: boolean;
  /** True only when we matched the strike+expiry in the chain and confirmed the OI floor. */
  verified: boolean;
  /** True only when the strike+expiry IS in the chain but OI is below the floor — a real contradiction. */
  contradicted: boolean;
  /** task #141: best (max) OI across the matched strike+expiry rows for the play's side, so a
   *  rejection-audit row can record the actual liquidity number that failed the floor — not
   *  just the boolean. Null when the strike+expiry wasn't found in the chain at all (nothing to
   *  measure); this does NOT change `ok`/`verified`/`contradicted`, which are unchanged. */
  matchedOi: number | null;
};

/**
 * SOFT strike validation (#77). Returns `ok:false` ONLY when the chain positively contradicts the
 * play — i.e. the exact strike+expiry exists in the prefetched ATM window but its OI is below the
 * liquidity floor. When the contract is simply not present in the (narrow, front-two-expiry, ATM±5%)
 * window — including unparseable/longer-dated swing/leap expiries — we return `ok:true, verified:false`:
 * the chain can't confirm it, but it also can't disprove it, so we do not drop the play.
 */
export function evaluatePlayAgainstChain(
  optionsPlay: string,
  rows: ChainStrikeRow[],
  minOi = STRIKE_MIN_OI
): StrikeValidation {
  const parsed = parseOptionsContract(optionsPlay);
  // No parseable strike at all → we can't verify, but we also can't contradict. Let it through;
  // premium-cap + critic remain the other guards. (Hard-dropping here was part of the over-filter.)
  if (!parsed) return { ok: true, verified: false, contradicted: false, matchedOi: null };

  const oiForSide = (row: ChainStrikeRow): number => {
    if (parsed.side === "call") return row.call_oi;
    if (parsed.side === "put") return row.put_oi;
    return Math.max(row.call_oi, row.put_oi);
  };

  // Find a chain row at this strike. If we have an expiry, require it to match; otherwise match on
  // strike alone (Claude wrote "weekly"/"0DTE" with no ISO date — common, and not a reason to drop).
  const strikeRows = rows.filter((row) => {
    if (Math.abs(row.strike - parsed.strike) > 0.05) return false;
    if (parsed.expiryYmd && row.expiry !== parsed.expiryYmd) return false;
    return true;
  });

  // Strike+expiry not present in the front-two-expiry ATM window → unverifiable, NOT contradicted.
  // This is the common case for swing/leap plays; pass it through rather than zeroing the edition.
  if (!strikeRows.length) return { ok: true, verified: false, contradicted: false, matchedOi: null };

  // Present in the chain: now the OI floor is meaningful. Verified if any matching row clears it.
  const bestOi = Math.max(...strikeRows.map(oiForSide));
  const verified = bestOi >= minOi;
  return { ok: verified, verified, contradicted: !verified, matchedOi: bestOi };
}

/**
 * Back-compat boolean wrapper. NOTE: this returns `true` only for a VERIFIED contract (present in the
 * chain and clearing the OI floor). It is NOT suitable as a hard pass/fail gate for publishing —
 * callers in the edition funnel must use {@link evaluatePlayAgainstChain} and gate on `ok` (which is
 * also true for unverifiable-but-not-contradicted plays). Retained for any external/legacy caller.
 */
export function validatePlayAgainstChain(
  optionsPlay: string,
  rows: ChainStrikeRow[],
  minOi = 500
): boolean {
  return evaluatePlayAgainstChain(optionsPlay, rows, minOi).verified;
}

export async function fetchTickerChainTable(
  ticker: string,
  dossier?: TickerDossier
): Promise<string | null> {
  const resolved = await resolveTickerChainRows(ticker, dossier);
  if (!resolved) return null;
  return formatChainTableText(ticker.toUpperCase(), resolved.spot, resolved.rows);
}

/** Pre-fetch ATM ±5% chain rows for ranked stocks. */
export async function fetchEditionChainRows(params: {
  stockTickers: string[];
  dossiers: TickerDossier[];
}): Promise<Record<string, ChainStrikeRow[]>> {
  const resolved = await fetchEditionChains(params);
  return Object.fromEntries(Object.entries(resolved).map(([ticker, data]) => [ticker, data.rows]));
}

export type EditionChainData = { spot: number; rows: ChainStrikeRow[] };

function hasMatchingRow(rows: ChainStrikeRow[], parsed: ParsedOptionsContract): boolean {
  return rows.some((row) => {
    if (Math.abs(row.strike - parsed.strike) > 0.05) return false;
    if (parsed.expiryYmd && row.expiry !== parsed.expiryYmd) return false;
    if (parsed.side === "call") {
      return row.call_bid != null || row.call_ask != null || row.call_oi > 0 || row.call_iv != null;
    }
    if (parsed.side === "put") {
      return row.put_bid != null || row.put_ask != null || row.put_oi > 0 || row.put_iv != null;
    }
    return true;
  });
}

/**
 * Add exact per-contract snapshots for the contracts Claude selected.
 *
 * The prompt table intentionally stays narrow (ATM +/-5%, front expiries) to control prompt size.
 * After synthesis, however, user-visible option premiums must be grounded against the exact contract
 * that will be shown. This batches those exact OCC lookups so longer-dated/OTM plays are validated
 * without broadening every ticker's chain fetch.
 */
export async function augmentChainsWithExactContracts(params: {
  plays: PlaybookPlay[];
  chains: Record<string, EditionChainData>;
}): Promise<Record<string, EditionChainData>> {
  const requests: Array<{ ticker: string; occ: string }> = [];
  const seen = new Set<string>();

  for (const play of params.plays) {
    const ticker = play.ticker.toUpperCase();
    const parsed = parseOptionsContract(play.options_play);
    if (!parsed?.expiryYmd || !parsed.side) continue;
    if (hasMatchingRow(params.chains[ticker]?.rows ?? [], parsed)) continue;
    const occ = buildOcc(ticker, parsed.expiryYmd, parsed.side, parsed.strike);
    if (!occ || seen.has(occ)) continue;
    seen.add(occ);
    requests.push({ ticker, occ });
  }

  if (!requests.length) return params.chains;

  const snapshots = await fetchOptionsUnifiedSnapshot(requests.map((r) => r.occ));
  if (!snapshots.size) return params.chains;

  const next: Record<string, EditionChainData> = Object.fromEntries(
    Object.entries(params.chains).map(([ticker, data]) => [ticker, { spot: data.spot, rows: [...data.rows] }])
  );

  for (const req of requests) {
    const snap = snapshots.get(req.occ);
    if (!snap) continue;
    const row = rowFromOptionSnapshot(snap);
    if (!row) continue;
    const existing = next[req.ticker];
    const spot = existing?.spot && existing.spot > 0 ? existing.spot : snap.underlyingPrice ?? 0;
    const rows = existing?.rows ?? [];
    if (hasMatchingRow(rows, { strike: row.strike, expiryYmd: row.expiry, side: snap.optionType })) continue;
    next[req.ticker] = { spot, rows: [...rows, row] };
  }

  return next;
}

/** Pre-fetch ATM ±5% chains (spot + rows) for ranked stocks — single fetch per ticker. */
export async function fetchEditionChains(params: {
  stockTickers: string[];
  dossiers: TickerDossier[];
}): Promise<Record<string, EditionChainData>> {
  const dossierMap = Object.fromEntries(params.dossiers.map((d) => [d.ticker, d]));
  const tickers = Array.from(new Set(params.stockTickers.map((t) => t.toUpperCase())));

  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      const resolved = await resolveTickerChainRows(ticker, dossierMap[ticker]);
      return resolved ? ([ticker, resolved] as const) : null;
    })
  );

  return Object.fromEntries(entries.filter((e): e is [string, EditionChainData] => e != null));
}

export function formatEditionChainTables(chains: Record<string, EditionChainData>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(chains).map(([ticker, { spot, rows }]) => [
      ticker,
      formatChainTableText(ticker, spot, rows),
    ])
  );
}

/**
 * @deprecated Use fetchEditionChains + formatEditionChainTables instead.
 * Calling this function causes 2× chain fetches and is a bug.
 * This function now throws at runtime to prevent accidental use.
 */
export async function fetchEditionChainTables(_params: {
  stockTickers: string[];
  dossiers: TickerDossier[];
}): Promise<Record<string, string>> {
  throw new Error(
    "[nighthawk] fetchEditionChainTables is deprecated and must not be called. " +
      "Use fetchEditionChains() + formatEditionChainTables() to avoid duplicate chain fetches."
  );
}
