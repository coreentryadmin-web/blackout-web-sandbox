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
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import {
  fetchUwDarkPoolRecent,
  fetchUwEarningsPremarket,
  fetchUwEarningsAfterhours,
  fetchUwCongressTrades,
  fetchUwMacroIndicators,
  type UwMacroIndicatorSnapshot,
} from "@/lib/providers/unusual-whales";
import { fetchMarketMovers, fetchSectorPerformance } from "@/lib/providers/polygon";

// ── key + TTL registry ────────────────────────────────────────────────────────

export const GRID_KEYS = {
  analysts: "grid:analysts",
  darkPool: "grid:dark-pool",
  earnings: "grid:earnings",
  congress: "grid:congress",
  economy: "grid:economy",
  sectors: "grid:sectors",
  movers: "grid:movers",
} as const;

export const GRID_TTL = {
  analysts: 600,   // 10 min — analyst actions trickle in slowly
  darkPool: 120,   // 2 min — dark pool prints are live during RTH
  earnings: 300,   // 5 min — earnings reporters update a few times per day
  congress: 600,   // 10 min — congress trades are slow to file
  economy: 3600,   // 1 hr — macro indicators update rarely
  sectors: 120,    // 2 min — sector performance during RTH
  movers: 90,      // 90s — movers change quickly during RTH
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

function classifyAnalystAction(title: string, channels: string[]): GridAnalystAction["action"] {
  const hay = `${title} ${channels.join(" ")}`.toLowerCase();
  if (/\bupgrade|raises? to|raised to\b/.test(hay)) return "upgrade";
  if (/\bdowngrade|cuts? to|lowered? to|lowers? to\b/.test(hay)) return "downgrade";
  if (/\binitiat|initiates? coverage|starts? at|begins? coverage\b/.test(hay)) return "initiate";
  if (/\bmaintains?|reiterat|reaffirm|keeps?\b/.test(hay)) return "maintain";
  if (/\bprice target|pt |raises? pt|cuts? pt|target to\b/.test(hay)) return "target";
  return "other";
}

async function fetchAnalystActions(limit = 30): Promise<GridAnalystsSnapshot> {
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
  const snapshot = await fetchAnalystActions(30);
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
    () => fetchAnalystActions(30),
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
    const premium = Number(r.premium ?? r.size ?? r.notional ?? 0);
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
    const epsEst = r.eps_estimate ?? r.estimate ?? r.estimated_eps ?? null;
    const epsAct = r.eps_actual ?? r.actual ?? r.reported_eps ?? null;
    const est = epsEst != null ? Number(epsEst) : null;
    const act = epsAct != null ? Number(epsAct) : null;
    const surprise =
      est != null && act != null && est !== 0
        ? Number((((act - est) / Math.abs(est)) * 100).toFixed(1))
        : null;
    return {
      ticker: String(r.ticker ?? r.symbol ?? "").toUpperCase(),
      name: String(r.name ?? r.company ?? ""),
      eps_estimate: est != null && Number.isFinite(est) ? est : null,
      eps_actual: act != null && Number.isFinite(act) ? act : null,
      surprise_pct: surprise != null && Number.isFinite(surprise) ? surprise : null,
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
  const data = await fetchUwCongressTrades(undefined, 25);
  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : typeof data === "object" && data != null
    ? [data as Record<string, unknown>]
    : [];

  const trades: GridCongresstrade[] = rows
    .map((r) => ({
      politician: String(r.politician ?? r.name ?? r.senator ?? r.representative ?? ""),
      ticker: String(r.ticker ?? r.symbol ?? "").toUpperCase(),
      type: String(r.transaction_type ?? r.type ?? r.trade_type ?? ""),
      amount: String(r.amount ?? r.value ?? ""),
      filed_at: String(r.filed_at ?? r.date ?? r.disclosure_date ?? ""),
      party: String(r.party ?? ""),
    }))
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
  return s.trades?.length ? s : null;
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

async function fetchMovers(): Promise<GridMoversSnapshot> {
  const all = await fetchMarketMovers(12);
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
