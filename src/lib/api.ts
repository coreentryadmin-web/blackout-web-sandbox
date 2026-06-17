const INTEL_BASE = "/api/engine";
const MARKET_BASE = "/api/market";

async function marketFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${MARKET_BASE}${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Pragma: "no-cache", "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`Market ${path} → ${res.status}`);
  return res.json();
}

async function intelFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${INTEL_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Intel ${path} → ${res.status}`);
  return res.json();
}

// ── SPX ───────────────────────────────────────────────────────────────────────

export interface SpxState {
  available: boolean;
  source?: "polygon" | "blackout_intel" | "merged";
  as_of: string;
  price: number;
  vwap: number;
  lod: number;
  hod: number;
  vix: number | null;
  vix_change_pct: number;
  spx_change_pct: number;
  above_vwap: boolean;
  uw_iv_rank: number | null;
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  adv: number | null;
  dec: number | null;
  trin: number | null;
  tick: number | null;
  sector_bias: string | null;
  sector_leaders: Array<{ sector: string; change_pct: number }>;
  sector_laggards: Array<{ sector: string; change_pct: number }>;
  tide_bias: string | null;
  tide_call: number | null;
  tide_put: number | null;
  nope: { nope: number; call_delta: number; put_delta: number } | null;
  vol_regime: { realized_vol: number; skew: number } | null;
  chart_levels: {
    regime: string | null;
    vah: number | null;
    val: number | null;
    poc: number | null;
    fib_382: number | null;
    fib_50: number | null;
    fib_618: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    onh: number | null;
    onl: number | null;
    pdh: number | null;
    pdl: number | null;
  };
}

function emptySpxState(): SpxState {
  return {
    available: false,
    as_of: new Date().toISOString(),
    price: 0,
    vwap: 0,
    lod: 0,
    hod: 0,
    vix: null,
    vix_change_pct: 0,
    spx_change_pct: 0,
    above_vwap: false,
    uw_iv_rank: null,
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    adv: null,
    dec: null,
    trin: null,
    tick: null,
    sector_bias: null,
    sector_leaders: [],
    sector_laggards: [],
    tide_bias: null,
    tide_call: null,
    tide_put: null,
    nope: null,
    vol_regime: null,
    chart_levels: {
      regime: null,
      vah: null,
      val: null,
      poc: null,
      fib_382: null,
      fib_50: null,
      fib_618: null,
      ema20: null,
      ema50: null,
      ema200: null,
      onh: null,
      onl: null,
      pdh: null,
      pdl: null,
    },
  };
}

/** Fast Polygon-only quote — polled every 5s on dashboard */
export async function fetchSpxIndices() {
  return marketFetch<{
    source?: string;
    as_of?: string;
    spx?: { price: number; change_pct: number };
    vix?: { price: number; change_pct: number };
  }>("/indices");
}

export type SpxDeskLevel = {
  label: string;
  value: number | null;
  kind: "support" | "resistance" | "neutral";
  distance_pct: number | null;
};

export type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

export type SpxCommentaryResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

/** Claude live desk commentary — requires auth */
export async function requestSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null
): Promise<SpxCommentaryResult> {
  const res = await fetch("/api/market/spx/commentary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desk, previous }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Commentary → ${res.status}`);
  }
  const data = (await res.json()) as { commentary: SpxCommentaryResult };
  return data.commentary;
}

/** Full SPX-Sniper desk — Polygon + UW dealer/flow (slower lane, ~10s). */
export const fetchSpxDesk = () => marketFetch<SpxDeskPayload>("/spx/desk");

/** Fast Polygon pulse — price, session, internals, mega-caps (~2s). */
export const fetchSpxDeskPulse = () => marketFetch<import("@/lib/providers/spx-desk").SpxDeskPulse>("/spx/pulse");

/** UW flow lane — live tape, GEX walls, dark pool (~4s). */
export const fetchSpxDeskFlow = () => marketFetch<import("@/lib/providers/spx-desk").SpxDeskFlow>("/spx/flow");

/** Server play engine — BUY / HOLD / TRIM / SELL with gates + Claude arbiter. */
export const fetchSpxPlay = () => marketFetch<import("@/lib/spx-play-engine").SpxPlayPayload>("/spx/play");

/** Website-first: Polygon indices + optional BlackOut intel overlay (GEX, levels, regime). */
export async function fetchSpxState(): Promise<SpxState> {
  const [indicesRes, intelRes] = await Promise.allSettled([
    marketFetch<{
      spx?: { price: number; change_pct: number };
      vix?: { price: number; change_pct: number };
      as_of?: string;
    }>("/indices"),
    intelFetch<SpxState>("/spx/state"),
  ]);

  const base = emptySpxState();

  if (indicesRes.status === "fulfilled" && indicesRes.value.spx) {
    const { spx, vix, as_of } = indicesRes.value;
    base.available = true;
    base.source = "polygon";
    base.as_of = as_of ?? new Date().toISOString();
    base.price = spx?.price ?? 0;
    base.spx_change_pct = spx?.change_pct ?? 0;
    base.vix = vix?.price ?? null;
    base.vix_change_pct = vix?.change_pct ?? 0;
  }

  if (intelRes.status === "fulfilled" && intelRes.value?.available) {
    return { ...intelRes.value, source: "blackout_intel" };
  }

  if (intelRes.status === "fulfilled" && indicesRes.status === "fulfilled" && base.available) {
    const intel = intelRes.value;
    return {
      ...base,
      ...intel,
      available: true,
      source: "merged",
      price: base.price || intel.price,
      spx_change_pct: base.spx_change_pct || intel.spx_change_pct,
      vix: base.vix ?? intel.vix,
      vix_change_pct: base.vix_change_pct || intel.vix_change_pct,
    };
  }

  return base;
}

export interface PlatformHealth {
  market: { ok: boolean; polygon?: boolean; unusual_whales?: boolean };
  intel: { ok: boolean; engine?: string };
}

export async function fetchPlatformHealth(): Promise<PlatformHealth> {
  const [market, intel] = await Promise.allSettled([
    fetch("/api/market/health", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/engine/health", { cache: "no-store" }).then((r) => r.json()),
  ]);

  return {
    market: market.status === "fulfilled" ? market.value : { ok: false },
    intel: intel.status === "fulfilled" ? intel.value : { ok: false, engine: "offline" },
  };
}

// ── Flows ─────────────────────────────────────────────────────────────────────

export interface FlowAlert {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
}

/** Flow tape — engine Postgres ingest first, UW direct fallback. */
export async function fetchFlows(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.ticker) qs.set("ticker", params.ticker);
  if (params?.min_premium) qs.set("min_premium", String(params.min_premium));
  const query = qs.toString();

  return marketFetch<{ flows: FlowAlert[]; count: number; source?: string }>(
    `/flows${query ? `?${query}` : ""}`
  );
}

// ── Night Hawk (BlackOut intel only) ──────────────────────────────────────────

export interface NightHawkPlay {
  ticker: string;
  direction: string;
  score: number;
  streak_days: number;
  iv_rank: number;
  entry_premium: number;
  dte_range: string;
  posted_at: string;
  summary: string;
}

export const fetchNightHawkPlays = () =>
  intelFetch<{ plays: NightHawkPlay[] }>("/nighthawk/plays");

// ── Heatmap ───────────────────────────────────────────────────────────────────

export interface HeatmapData {
  sectors: Array<{ name: string; change_pct: number; volume?: number }>;
  movers: Array<{ ticker: string; change_pct: number; price: number; volume?: number }>;
  as_of: string;
}

/** Website-first: Polygon sector ETFs + movers. */
export async function fetchHeatmap(): Promise<HeatmapData> {
  try {
    return await marketFetch<HeatmapData>("/heatmap");
  } catch {
    return intelFetch<HeatmapData>("/heatmap");
  }
}

// ── News ──────────────────────────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  title: string;
  teaser: string;
  published: string;
  tickers: string[];
  url: string;
}

export const fetchMarketNews = () =>
  marketFetch<{ articles: NewsArticle[] }>("/news");

// ── Largo (BlackOut intel only) ───────────────────────────────────────────────

export const queryLargo = (question: string, sessionId: string) =>
  intelFetch<{ answer: string; session_id: string }>("/largo/query", {
    method: "POST",
    body: JSON.stringify({ question, session_id: sessionId }),
  });

// ── Live flow stream (website SSE — no engine WebSocket required) ─────────────

export function createFlowEventSource(
  onMessage: (alert: FlowAlert) => void
): EventSource | null {
  if (typeof window === "undefined") return null;
  const es = new EventSource("/api/market/flows/stream");
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as { type?: string } & Partial<FlowAlert>;
      if (data.type === "flow" && data.ticker) onMessage(data as FlowAlert);
    } catch {
      /* ignore */
    }
  };
  return es;
}

/** @deprecated Use createFlowEventSource — engine WS optional legacy fallback */
export function createFlowSocket(onMessage: (alert: FlowAlert) => void): WebSocket | null {
  const engineBase = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "";
  if (!engineBase || typeof window === "undefined") return null;

  const wsBase = engineBase.replace(/^https/, "wss").replace(/^http/, "ws");
  const key = process.env.NEXT_PUBLIC_ENGINE_WS_KEY ?? "";
  const ws = new WebSocket(`${wsBase}/ws/flows${key ? `?key=${key}` : ""}`);
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type !== "heartbeat") onMessage(data as FlowAlert);
    } catch {
      /* ignore */
    }
  };
  return ws;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtPremium(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtPrice(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function pctClass(n: number | null): string {
  if (n == null) return "num-neutral";
  return n >= 0 ? "num-bull" : "num-bear";
}
