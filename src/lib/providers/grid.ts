// BlackOut Grid — server-side data plane (cache-reader rule).
//
// The Grid surfaces market-WIDE datasets the platform already pays for. To honor the cache-reader
// rule (one cluster-wide writer serves N viewers at a fixed cost) every Grid dataset that needs an
// upstream pull is fetched ONCE by the `grid-warm` cron and written to Redis under a `grid:*` key.
// The `/api/grid/*` route handlers ONLY read those snapshots — they never fetch upstream per request.
//
// Warmers live here; the cron calls them; the routes call the readers.

import {
  getUwCacheRedis,
  uwCacheGet,
  uwCacheSet,
} from "@/lib/providers/uw-shared-cache";
import { fetchBenzingaNews, type BenzingaCatalyst } from "@/lib/providers/polygon";
import {
  fetchUwDarkPoolRecent,
  fetchUwEarningsPremarket,
  fetchUwEarningsAfterhours,
  fetchUwCongressTrades,
  fetchUwMacroIndicators,
  fetchUwTickerEarningsHistory,
  fetchUwTickerNextEarnings,
  type UwMacroIndicatorSnapshot,
} from "@/lib/providers/unusual-whales";
import { fetchMarketMovers, fetchSectorPerformance } from "@/lib/providers/polygon";

// ── key + TTL registry ────────────────────────────────────────────────────────

export const GRID_KEYS = {
  analysts: "grid:analysts",
  darkPool: "grid:dark-pool",
  earnings: "grid:earnings",
  congress: "grid:congress:v5",
  economy: "grid:economy:v2",
  sectors: "grid:sectors",
  movers: "grid:movers",
  catalysts: "grid:catalysts",
} as const;

export const GRID_TTL = {
  analysts: 600,   // 10 min — analyst actions trickle in slowly
  darkPool: 120,   // 2 min — dark pool prints are live during RTH
  earnings: 300,   // 5 min — earnings reporters update a few times per day
  congress: 600,   // 10 min — congress trades are slow to file
  economy: 3600,   // 1 hr — macro indicators update rarely
  sectors: 120,    // 2 min — sector performance during RTH
  movers: 90,      // 90s — movers change quickly during RTH
  catalysts: 300,  // 5 min — corporate catalysts trickle in slowly
} as const;

// ── PANEL 4 — Analyst Actions ─────────────────────────────────────────────────

const ANALYST_CHANNELS = "analyst ratings,price target,upgrades,downgrades,analyst color";

export type GridAnalystAction = {
  id: string;
  title: string;
  action: "upgrade" | "downgrade" | "initiate" | "maintain" | "target" | "other";
  tickers: string[];
  published: string;
  url: string;
};

export type GridAnalystsSnapshot = {
  as_of: string;
  actions: GridAnalystAction[];
};

export function classifyAnalystAction(title: string, channels: string[]): GridAnalystAction["action"] {
  const hay = `${title} ${channels.join(" ")}`.toLowerCase();
  if (/\bupgrade|raises? to|raised to\b/.test(hay)) return "upgrade";
  if (/\bdowngrade|cuts? to|lowered? to|lowers? to\b/.test(hay)) return "downgrade";
  if (/\binitiat|initiates? coverage|starts? at|begins? coverage\b/.test(hay)) return "initiate";
  if (/\bmaintains?|reiterat|reaffirm|keeps?\b/.test(hay)) return "maintain";
  if (/\bprice target|pt |raises? pt|cuts? pt|target to\b/.test(hay)) return "target";
  return "other";
}

async function fetchAnalystActions(limit = 200): Promise<GridAnalystsSnapshot> {
  const articles = await fetchBenzingaNews(limit, { channels: ANALYST_CHANNELS });
  const actions: GridAnalystAction[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    action: classifyAnalystAction(a.title, a.channels),
    tickers: a.tickers.slice(0, 6),
    published: a.published,
    url: a.url,
  }));
  return { as_of: new Date().toISOString(), actions };
}

export async function warmGridAnalysts(): Promise<GridAnalystsSnapshot | null> {
  const snapshot = await fetchAnalystActions(200);
  if (!snapshot.actions.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.analysts, GRID_TTL.analysts, snapshot);
  return snapshot;
}

export async function readGridAnalysts(): Promise<GridAnalystsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.analysts,
    GRID_TTL.analysts,
    () => fetchAnalystActions(200),
  );
  return snapshot.actions.length ? snapshot : null;
}

// ── PANEL 5 — Dark Pool Prints ────────────────────────────────────────────────

export type GridDarkPoolPrint = {
  ticker: string;
  premium: number;
  size: number;
  price: number;
  side: string;
  executed_at: string;
};

export type GridDarkPoolSnapshot = {
  as_of: string;
  prints: GridDarkPoolPrint[];
};

async function fetchDarkPoolPrints(): Promise<GridDarkPoolSnapshot> {
  const rows = (await fetchUwDarkPoolRecent(40)) as Record<string, unknown>[];
  const prints: GridDarkPoolPrint[] = [];
  for (const r of rows) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker) continue;
    // Premium = dollar notional. Match the canonical /api/market/dark-pool
    // normalization (premium ?? notional ?? size_premium) — never fall back to
    // raw `size` (a SHARE COUNT), which would render share quantity as a $ premium.
    const premium = Number(r.premium ?? r.notional ?? r.size_premium ?? 0);
    if (premium <= 0) continue;
    prints.push({
      ticker,
      premium,
      size: Number(r.size ?? r.quantity ?? r.volume ?? 0),
      price: Number(r.price ?? r.ref_price ?? r.execution_price ?? 0),
      side: String(r.side ?? r.direction ?? "unknown").toLowerCase(),
      executed_at: String(r.executed_at ?? r.date ?? ""),
    });
  }
  return { as_of: new Date().toISOString(), prints };
}

export async function warmGridDarkPool(): Promise<GridDarkPoolSnapshot | null> {
  const snapshot = await fetchDarkPoolPrints();
  if (!snapshot.prints.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.darkPool, GRID_TTL.darkPool, snapshot);
  return snapshot;
}

export async function readGridDarkPool(): Promise<GridDarkPoolSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.darkPool,
    GRID_TTL.darkPool,
    () => fetchDarkPoolPrints(),
  );
  return (snapshot as GridDarkPoolSnapshot).prints?.length
    ? (snapshot as GridDarkPoolSnapshot)
    : null;
}

// ── PANEL 6 — Earnings Radar ──────────────────────────────────────────────────

export type GridEarningsItem = {
  ticker: string;
  name: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
  /** Report (earnings) date, ISO yyyy-mm-dd. */
  report_date: string | null;
  /** Options-implied expected move around the print, as a percent (e.g. 11.5). */
  expected_move_pct: number | null;
  when: "premarket" | "afterhours";
};

export type GridEarningsSnapshot = {
  as_of: string;
  items: GridEarningsItem[];
};

function shapeEarningsRows(
  rows: Record<string, unknown>[],
  when: "premarket" | "afterhours"
): GridEarningsItem[] {
  return rows.map((r) => {
    // UW /api/earnings/{premarket,afterhours} field names: street_mean_est, actual_eps,
    // full_name, report_date, expected_move_perc (fraction). Older fallbacks kept for safety.
    const epsEst = r.street_mean_est ?? r.eps_estimate ?? r.estimate ?? r.estimated_eps ?? null;
    const epsAct = r.actual_eps ?? r.eps_actual ?? r.actual ?? r.reported_eps ?? null;
    const est = epsEst != null ? Number(epsEst) : null;
    const act = epsAct != null ? Number(epsAct) : null;
    const surprise =
      est != null && act != null && est !== 0
        ? Number((((act - est) / Math.abs(est)) * 100).toFixed(1))
        : null;
    const emRaw = r.expected_move_perc ?? r.expected_move_pct ?? null;
    // UW returns expected_move_perc as a fraction (e.g. "0.1148"); render as a percent.
    const emPct = emRaw != null && Number.isFinite(Number(emRaw)) ? Number(emRaw) * 100 : null;
    return {
      ticker: String(r.ticker ?? r.symbol ?? "").toUpperCase(),
      name: String(r.full_name ?? r.name ?? r.company ?? ""),
      eps_estimate: est != null && Number.isFinite(est) ? est : null,
      eps_actual: act != null && Number.isFinite(act) ? act : null,
      surprise_pct: surprise != null && Number.isFinite(surprise) ? surprise : null,
      report_date: String(r.report_date ?? r.earnings_date ?? r.date ?? "").slice(0, 10) || null,
      expected_move_pct: emPct != null ? Number(emPct.toFixed(1)) : null,
      when,
    };
  }).filter((x) => x.ticker);
}

async function fetchEarnings(): Promise<GridEarningsSnapshot> {
  const [pm, ah] = await Promise.all([
    fetchUwEarningsPremarket(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "premarket")
    ).catch(() => [] as GridEarningsItem[]),
    fetchUwEarningsAfterhours(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "afterhours")
    ).catch(() => [] as GridEarningsItem[]),
  ]);
  return { as_of: new Date().toISOString(), items: [...pm, ...ah] };
}

export async function warmGridEarnings(): Promise<GridEarningsSnapshot | null> {
  const snapshot = await fetchEarnings();
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.earnings, GRID_TTL.earnings, snapshot);
  return snapshot.items.length ? snapshot : null;
}

export async function readGridEarnings(): Promise<GridEarningsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.earnings,
    GRID_TTL.earnings,
    () => fetchEarnings(),
  );
  return snapshot as GridEarningsSnapshot;
}

// ── Per-ticker Earnings Snapshot ─────────────────────────────────────────────

export type GridEarningsHistoryItem = {
  quarter: string;        // e.g. "Q1 2026"
  date: string;           // ISO date
  eps_actual: number | null;
  eps_estimate: number | null;
  surprise_pct: number | null;
  revenue: number | null;  // in dollars, null if unavailable
  when: "premarket" | "afterhours" | null;
};

export type GridEarningsTickerSnapshot = {
  ticker: string;
  history: GridEarningsHistoryItem[];
  next_date: string | null;     // ISO date string
  next_when: "premarket" | "afterhours" | null;
  as_of: string;
};

function dateToQuarter(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const m = d.getMonth(); // 0-indexed
  const y = d.getFullYear();
  const q = m < 2 ? 4 : m < 5 ? 1 : m < 8 ? 2 : m < 11 ? 3 : 4;
  const qy = m < 2 ? y - 1 : y;
  return `Q${q} ${qy}`;
}

export async function fetchTickerEarnings(ticker: string): Promise<GridEarningsTickerSnapshot> {
  const sym = ticker.toUpperCase();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await fetchUwTickerEarningsHistory(sym);
  } catch { /* ignore */ }

  const history: GridEarningsHistoryItem[] = rows.map((r) => {
    // UW /api/earnings/{ticker} returns actual_eps + street_mean_est + report_date + report_time
    const epsAct = r.actual_eps ?? r.eps_actual ?? r.actual ?? r.reported_eps ?? null;
    const epsEst = r.street_mean_est ?? r.eps_estimate ?? r.estimate ?? r.estimated_eps ?? null;
    const act = epsAct != null ? Number(epsAct) : null;
    const est = epsEst != null ? Number(epsEst) : null;
    const surprise = act != null && est != null && est !== 0 ? ((act - est) / Math.abs(est)) * 100 : null;
    const dateStr = String(r.report_date ?? r.earnings_date ?? r.date ?? r.period_end_date ?? "").slice(0, 10);
    const rev = r.revenue ?? r.total_revenue ?? r.net_revenue ?? null;
    const rawQuarter = String(r.fiscal_quarter ?? r.quarter ?? r.period ?? "");
    // UW provides ending_fiscal_quarter (period end date) — use for quarter label, not report_date
    const periodDateStr = String(r.ending_fiscal_quarter ?? r.fiscal_quarter_end ?? "").slice(0, 10);
    const quarter = rawQuarter || (periodDateStr ? dateToQuarter(periodDateStr) : dateToQuarter(dateStr));
    const whenRaw = String(r.report_time ?? r.when ?? r.time ?? "").toLowerCase();
    // UW uses "postmarket" for after-hours
    const when: "premarket" | "afterhours" | null = whenRaw.includes("pre") ? "premarket" : whenRaw.includes("after") || whenRaw.includes("ah") || whenRaw.includes("post") ? "afterhours" : null;
    return {
      quarter,
      date: dateStr,
      eps_actual: act,
      eps_estimate: est,
      surprise_pct: surprise != null ? Math.round(surprise * 10) / 10 : null,
      revenue: rev != null ? Number(rev) : null,
      when,
    };
  }).filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date));

  let next_date: string | null = null;
  let next_when: "premarket" | "afterhours" | null = null;
  try {
    const nextRow = await fetchUwTickerNextEarnings(sym);
    if (nextRow) {
      next_date = String(nextRow.report_date ?? nextRow.earnings_date ?? nextRow.date ?? "").slice(0, 10) || null;
      const wh = String(nextRow.report_time ?? nextRow.when ?? nextRow.time ?? "").toLowerCase();
      next_when = wh.includes("pre") ? "premarket" : wh.includes("after") || wh.includes("ah") ? "afterhours" : null;
    }
  } catch { /* ignore */ }

  // Fallback: if fetchUwTickerNextEarnings returned nothing, check history for a future date
  const today = new Date().toISOString().slice(0, 10);
  if (!next_date) {
    const futureRow = history.find(h => h.date > today);
    next_date = futureRow?.date ?? null;
  }

  return { ticker: sym, history, next_date, next_when, as_of: new Date().toISOString() };
}

// ── PANEL 7 — Congress Trades ─────────────────────────────────────────────────

export type GridCongresstrade = {
  politician: string;
  ticker: string;
  type: string;
  amount: string;
  filed_at: string;
  party: string;
};

export type GridCongressSnapshot = {
  as_of: string;
  trades: GridCongresstrade[];
};

async function fetchCongressTrades(): Promise<GridCongressSnapshot> {
  const data = await fetchUwCongressTrades(undefined, 100);
  const obj = data as Record<string, unknown> | null;
  // UW returns {"data": [{...},...]} — unwrap the data array
  const rows: Record<string, unknown>[] = Array.isArray(obj)
    ? (obj as Record<string, unknown>[])
    : Array.isArray(obj?.data)
    ? (obj!.data as Record<string, unknown>[])
    : obj && typeof obj === "object"
    ? [obj]
    : [];

  const trades: GridCongresstrade[] = rows
    .map((r) => {
      const ticker = String(r.ticker ?? r.symbol ?? r.stock ?? "").toUpperCase();
      const senator = String(r.senator ?? r.representative ?? r.politician ?? r.name ?? r.full_name ?? "");
      const txDate = String(r.transaction_date ?? r.date ?? r.filed_at ?? r.disclosure_date ?? "").slice(0, 10);
      const txType = String(r.txn_type ?? r.transaction ?? r.type ?? r.trade_type ?? r.transaction_type ?? "").toLowerCase();
      const amount = String(r.amounts ?? r.amount ?? r.range ?? r.amount_range ?? r.value ?? "");
      return {
        politician: senator,
        ticker,
        type: txType,
        amount,
        filed_at: txDate,
        party: String(r.party_affiliation ?? r.affiliation ?? r.party ?? r.member_type ?? ""),
      };
    })
    .filter((t) => t.politician && t.ticker);

  return { as_of: new Date().toISOString(), trades };
}

export async function warmGridCongress(): Promise<GridCongressSnapshot | null> {
  const snapshot = await fetchCongressTrades();
  if (!snapshot.trades.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.congress, GRID_TTL.congress, snapshot);
  return snapshot;
}

export async function readGridCongress(): Promise<GridCongressSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.congress,
    GRID_TTL.congress,
    () => fetchCongressTrades(),
  );
  const s = snapshot as GridCongressSnapshot;
  // Return the snapshot even if trades is empty so callers see the as_of timestamp
  return s ?? null;
}

// ── PANEL 8 — Economic Calendar ───────────────────────────────────────────────

const MACRO_IDS = ["CPI", "UNEMPLOYMENT", "GDP", "FED-FUNDS", "RETAIL-SALES", "PAYROLLS", "TREASURY-YIELD"];

export type GridEconomySnapshot = {
  as_of: string;
  indicators: UwMacroIndicatorSnapshot[];
};

async function fetchEconomy(): Promise<GridEconomySnapshot> {
  const indicators = await fetchUwMacroIndicators(MACRO_IDS);
  return { as_of: new Date().toISOString(), indicators };
}

export async function warmGridEconomy(): Promise<GridEconomySnapshot | null> {
  const snapshot = await fetchEconomy();
  if (!snapshot.indicators.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.economy, GRID_TTL.economy, snapshot);
  return snapshot;
}

export async function readGridEconomy(): Promise<GridEconomySnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.economy,
    GRID_TTL.economy,
    () => fetchEconomy(),
  );
  const s = snapshot as GridEconomySnapshot;
  return s.indicators?.length ? s : null;
}

// ── PANEL 9 — Sector Heat ─────────────────────────────────────────────────────

export type GridSectorRow = {
  name: string;
  ticker: string;
  change_pct: number;
};

export type GridSectorsSnapshot = {
  as_of: string;
  sectors: GridSectorRow[];
};

async function fetchSectors(): Promise<GridSectorsSnapshot> {
  const rows = await fetchSectorPerformance();
  const sectors: GridSectorRow[] = rows.map((r) => ({
    name: r.name,
    ticker: r.ticker,
    change_pct: r.change_pct,
  }));
  return { as_of: new Date().toISOString(), sectors };
}

export async function warmGridSectors(): Promise<GridSectorsSnapshot | null> {
  const snapshot = await fetchSectors();
  if (!snapshot.sectors.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.sectors, GRID_TTL.sectors, snapshot);
  return snapshot;
}

export async function readGridSectors(): Promise<GridSectorsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.sectors,
    GRID_TTL.sectors,
    () => fetchSectors(),
  );
  const s = snapshot as GridSectorsSnapshot;
  return s.sectors?.length ? s : null;
}

// ── PANEL 10 — Top Movers ─────────────────────────────────────────────────────

export type GridMover = {
  ticker: string;
  change_pct: number;
  price: number;
};

export type GridMoversSnapshot = {
  as_of: string;
  gainers: GridMover[];
  losers: GridMover[];
};

// Sanity filter for the raw Polygon mover rows before they're sorted/selected as
// top movers. A >100% single-session move (or a sub-$1 "price") on a name surfaced
// as a headline mover is virtually always a data artifact (thinly-traded/delisted-
// adjacent ticker with a near-zero prior price), not a genuine market move — e.g.
// "DISK +22,245.62%". Reject those before they ever reach the Grid panel.
export function isPlausibleMover(m: { price: number; change_pct: number; volume?: number }): boolean {
  if (m.price <= 1) return false;
  if (Math.abs(m.change_pct) > 100) return false;
  if (m.volume != null && m.volume < 100_000) return false;
  return true;
}

async function fetchMovers(): Promise<GridMoversSnapshot> {
  const all = await fetchMarketMovers(12).then((rows) => rows.filter(isPlausibleMover));
  const gainers = all.filter((m) => m.change_pct > 0).map((m) => ({
    ticker: m.ticker,
    change_pct: m.change_pct,
    price: m.price,
  }));
  const losers = all.filter((m) => m.change_pct < 0).map((m) => ({
    ticker: m.ticker,
    change_pct: m.change_pct,
    price: m.price,
  }));
  return { as_of: new Date().toISOString(), gainers, losers };
}

export async function warmGridMovers(): Promise<GridMoversSnapshot | null> {
  const snapshot = await fetchMovers();
  if (!snapshot.gainers.length && !snapshot.losers.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.movers, GRID_TTL.movers, snapshot);
  return snapshot;
}

export async function readGridMovers(): Promise<GridMoversSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.movers,
    GRID_TTL.movers,
    () => fetchMovers(),
  );
  const s = snapshot as GridMoversSnapshot;
  return s.gainers != null ? s : null;
}

// ── PANEL 11 — Catalysts ──────────────────────────────────────────────────────

/** A single market-wide corporate catalyst event for the Grid panel. */
export type GridCatalystItem = {
  /** Source channel (e.g. "fda", "guidance", "m&a"). */
  channel: string;
  /** Coarse catalyst type — same taxonomy as BenzingaCatalyst["type"]. */
  type: BenzingaCatalyst["type"];
  /** Article title / brief description. */
  title: string;
  /** ISO timestamp of publication. */
  published: string;
  /** Primary ticker from the Benzinga article tickers array (first symbol), if present. */
  ticker?: string;
  /** All tickers mentioned in the article. */
  tickers?: string[];
};

export type GridCatalystsSnapshot = {
  as_of: string;
  items: GridCatalystItem[];
};

const GRID_CATALYST_CHANNELS =
  "m&a,guidance,short sellers,insider trades,fda,buybacks,offerings,ipos";

function catalystTypeFromChannel(channels: string[]): BenzingaCatalyst["type"] {
  const set = channels.map((c) => c.toLowerCase());
  const has = (needle: string) => set.some((c) => c.includes(needle));
  if (has("fda")) return "binary";
  if (has("guidance")) return "guidance";
  if (has("m&a")) return "m&a";
  if (has("insider")) return "insider";
  if (has("buyback")) return "buyback";
  if (has("offering")) return "offering";
  if (has("short")) return "short";
  if (has("ipo")) return "ipo";
  return "other";
}

async function fetchCatalysts(): Promise<GridCatalystsSnapshot> {
  try {
    const articles = await fetchBenzingaNews(20, { channels: GRID_CATALYST_CHANNELS });
    const items: GridCatalystItem[] = articles
      .map((a) => ({
        channel: a.channels[0] ?? "",
        type: catalystTypeFromChannel(a.channels),
        title: (a.title || a.teaser || "").slice(0, 200),
        published: a.published,
        ticker: a.tickers?.[0] ?? undefined,
        tickers: a.tickers?.length ? a.tickers : undefined,
      }))
      .filter((c) => c.title)
      .sort((a, b) => (b.published > a.published ? 1 : b.published < a.published ? -1 : 0))
      .slice(0, 20);
    return { as_of: new Date().toISOString(), items };
  } catch {
    return { as_of: new Date().toISOString(), items: [] };
  }
}

export async function warmGridCatalysts(): Promise<GridCatalystsSnapshot | null> {
  const snapshot = await fetchCatalysts();
  if (!snapshot.items.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.catalysts, GRID_TTL.catalysts, snapshot);
  return snapshot;
}

export async function readGridCatalysts(): Promise<GridCatalystsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.catalysts,
    GRID_TTL.catalysts,
    () => fetchCatalysts(),
  );
  const s = snapshot as GridCatalystsSnapshot;
  return s.items?.length ? s : null;
}

// ── Bootstrap (single round-trip for all cache-reader panels) ─────────────────

type GridPanelEnvelope<T extends object> =
  | { available: false }
  | ({ available: true } & T);

function gridPanelEnvelope<T extends object>(snapshot: T | null): GridPanelEnvelope<T> {
  if (!snapshot) return { available: false };
  return { available: true, ...snapshot };
}

export type GridBootstrapPanels = {
  analysts: GridPanelEnvelope<GridAnalystsSnapshot>;
  darkPool: GridPanelEnvelope<GridDarkPoolSnapshot>;
  earnings: GridPanelEnvelope<GridEarningsSnapshot>;
  congress: GridPanelEnvelope<GridCongressSnapshot>;
  economy: GridPanelEnvelope<GridEconomySnapshot>;
  sectors: GridPanelEnvelope<GridSectorsSnapshot>;
  movers: GridPanelEnvelope<GridMoversSnapshot>;
  catalysts: GridPanelEnvelope<GridCatalystsSnapshot>;
};

/** Market-route seeds (Pulse / GEX / whale flow) — not Redis grid:* snapshots. */
export type GridBootstrapMarketPayload = {
  pulse: import("@/lib/spx-desk-state").SpxState;
  gexSpx: Record<string, unknown> | { available: false };
  flows: { flows: Record<string, unknown>[]; count: number };
};

export type GridBootstrapPayload = {
  as_of: string;
  panels: GridBootstrapPanels;
  market?: GridBootstrapMarketPayload;
};

/** Read every Redis-backed Grid panel in one parallel pass (no per-panel HTTP fan-out). */
export async function readGridBootstrapPanels(): Promise<GridBootstrapPayload> {
  const [
    analysts,
    darkPool,
    earnings,
    congress,
    economy,
    sectors,
    movers,
    catalysts,
  ] = await Promise.all([
    readGridAnalysts(),
    readGridDarkPool(),
    readGridEarnings(),
    readGridCongress(),
    readGridEconomy(),
    readGridSectors(),
    readGridMovers(),
    readGridCatalysts(),
  ]);

  return {
    as_of: new Date().toISOString(),
    panels: {
      analysts: gridPanelEnvelope(analysts),
      darkPool: gridPanelEnvelope(darkPool),
      earnings: gridPanelEnvelope(earnings?.items?.length ? earnings : null),
      congress: gridPanelEnvelope(congress),
      economy: gridPanelEnvelope(economy),
      sectors: gridPanelEnvelope(sectors),
      movers: gridPanelEnvelope(movers),
      catalysts: gridPanelEnvelope(catalysts),
    },
  };
}
