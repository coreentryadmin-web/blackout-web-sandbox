import type { TickerDossier } from "./dossier";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import {
  fetchPolygonAtmOptionsChain,
  fetchPolygonOiByExpiry,
} from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot } from "@/lib/providers/polygon";
import { fetchUwOptionChains } from "@/lib/providers/unusual-whales";

const ATM_BAND_PCT = 0.05;
const FRONT_EXPIRIES = 2;

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
    const bid = num(quote?.bid) || null;
    const ask = num(quote?.ask) || null;
    const delta = num((c as { greeks?: { delta?: number } }).greeks?.delta) || null;
    const oi = num(c.open_interest);
    const iv = num((c as { implied_volatility?: number }).implied_volatility) || null;

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
    const bid = num(r.bid ?? r.call_bid ?? r.put_bid) || null;
    const ask = num(r.ask ?? r.call_ask ?? r.put_ask) || null;
    const delta = num(r.delta ?? r.call_delta ?? r.put_delta) || null;
    const oi = num(r.open_interest ?? r.oi);
    const iv = num(r.iv ?? r.implied_volatility) || null;

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
  if (!rows.length) {
    return `${ticker} chain (price $${price.toFixed(2)}): no ATM ±5% contracts for front expiries.`;
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

  return [`${ticker} chain (price $${price.toFixed(2)}):`, header, ...lines].join("\n");
}

async function resolveSpot(ticker: string, dossier?: TickerDossier): Promise<number> {
  const fromDossier = dossier?.tech?.price;
  if (fromDossier != null && fromDossier > 0) return fromDossier;
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

export function validatePlayAgainstChain(
  optionsPlay: string,
  rows: ChainStrikeRow[],
  minOi = 500
): boolean {
  const parsed = parseOptionsContract(optionsPlay);
  if (!parsed) return false;
  if (!parsed.expiryYmd) return false;

  const match = rows.find((row) => {
    if (Math.abs(row.strike - parsed.strike) > 0.05) return false;
    if (!parsed.expiryYmd) return false;
    if (row.expiry !== parsed.expiryYmd) return false;
    if (parsed.side === "call") return row.call_oi >= minOi;
    if (parsed.side === "put") return row.put_oi >= minOi;
    return row.call_oi >= minOi || row.put_oi >= minOi;
  });

  return Boolean(match);
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
