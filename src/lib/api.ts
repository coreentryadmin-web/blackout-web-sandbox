const INTEL_BASE = "/api/engine";
const MARKET_BASE = "/api/market";

async function marketFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${MARKET_BASE}${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
    ...options,
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

function deskPayloadToSpxState(desk: SpxDeskPayload): SpxState {
  return {
    available: desk.available && desk.price > 0,
    source: desk.source?.includes("engine") ? "blackout_intel" : "merged",
    as_of: desk.polled_at ?? desk.as_of,
    price: desk.price,
    vwap: desk.vwap ?? 0,
    lod: desk.lod ?? 0,
    hod: desk.hod ?? 0,
    vix: desk.vix,
    vix_change_pct: desk.vix_change_pct,
    spx_change_pct: desk.spx_change_pct,
    above_vwap: desk.above_vwap,
    uw_iv_rank: desk.uw_iv_rank,
    gex_net: desk.gex_net,
    gex_king: desk.gex_king,
    max_pain: desk.max_pain,
    gamma_flip: desk.gamma_flip,
    flow_0dte_call_premium: desk.flow_0dte_call_premium,
    flow_0dte_put_premium: desk.flow_0dte_put_premium,
    flow_0dte_net: desk.flow_0dte_net,
    adv: desk.add,
    dec: null,
    trin: desk.trin,
    tick: desk.tick,
    sector_bias: desk.tide_bias,
    sector_leaders: (desk.leader_stocks ?? []).map((s) => ({
      sector: s.name || s.ticker,
      change_pct: s.change_pct,
    })),
    sector_laggards: [],
    tide_bias: desk.tide_bias,
    tide_call: desk.tide_call_premium,
    tide_put: desk.tide_put_premium,
    nope:
      desk.nope != null
        ? {
            nope: desk.nope,
            call_delta: 0,
            put_delta: desk.nope_net_delta ?? 0,
          }
        : null,
    vol_regime: null,
    chart_levels: {
      regime: desk.regime,
      vah: null,
      val: null,
      poc: null,
      fib_382: null,
      fib_50: null,
      fib_618: null,
      ema20: desk.ema20,
      ema50: desk.ema50,
      ema200: desk.ema200,
      onh: desk.hod,
      onl: desk.lod,
      pdh: desk.pdh,
      pdl: desk.pdl,
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

/** Parallel pre-market lotto track — catalyst thesis, independent from desk plays. */
export const fetchSpxLottoToday = () =>
  marketFetch<{
    available: boolean;
    as_of: string;
    lotto: import("@/lib/spx-lotto-engine").LottoPlayPayload;
    history: Array<{
      id: number;
      phase: string;
      direction: string;
      strike: number;
      contract_label: string;
      catalyst_summary: string | null;
      outcome: string | null;
      headline: string | null;
    }>;
  }>("/lotto/today");

/** Merged SPX Sniper desk — pulse + flow + full desk (single server merge). */
export async function fetchSpxMerged() {
  return marketFetch<{
    merged: SpxDeskPayload;
    pulse_available: boolean;
    flow_available: boolean;
  }>("/spx/merged");
}

/** Website-first: merged SPX Sniper desk (same live feed as dashboard). */
export async function fetchSpxState(): Promise<SpxState> {
  try {
    const { merged } = await fetchSpxMerged();
    return deskPayloadToSpxState(merged);
  } catch {
    return emptySpxState();
  }
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

// ── Night Hawk (website-first) ────────────────────────────────────────────────

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

export type { NightHawkEdition, HuntMode, HuntRequest, HuntResponse, PlayExplainRequest, PlayExplainResponse } from "@/lib/nighthawk/types";

export const fetchNightHawkPlays = () =>
  intelFetch<{ plays: NightHawkPlay[] }>("/nighthawk/plays");

export const fetchNightHawkEdition = () =>
  marketFetch<import("@/lib/nighthawk/types").NightHawkEdition>("/nighthawk/edition");

export const postNightHawkHunt = (body: import("@/lib/nighthawk/types").HuntRequest) =>
  marketFetch<import("@/lib/nighthawk/types").HuntResponse>("/nighthawk/hunt", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const postNightHawkPlayExplain = (
  body: import("@/lib/nighthawk/types").PlayExplainRequest
) =>
  marketFetch<import("@/lib/nighthawk/types").PlayExplainResponse>("/nighthawk/play-explain", {
    method: "POST",
    body: JSON.stringify(body),
  });

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
  marketFetch<{ answer: string; session_id: string; source?: string; tools_used?: string[] }>(
    "/largo/query",
    {
      method: "POST",
      body: JSON.stringify({ question, session_id: sessionId }),
    }
  );

export async function queryLargoStream(
  question: string,
  sessionId: string,
  onToken: (text: string) => void
): Promise<{ answer: string; session_id: string; source?: string; tools_used?: string[] }> {
  const res = await fetch(`${MARKET_BASE}/largo/query?stream=1`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ question, session_id: sessionId }),
  });

  if (!res.ok) throw new Error(`Market /largo/query → ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Market /largo/query stream unavailable");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: { answer: string; session_id: string; source?: string; tools_used?: string[] } | null =
    null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      const event = JSON.parse(payload) as {
        type: string;
        text?: string;
        message?: string;
        answer?: string;
        session_id?: string;
        source?: string;
        tools_used?: string[];
      };

      if (event.type === "token" && event.text) onToken(event.text);
      if (event.type === "done" && event.answer && event.session_id) {
        result = {
          answer: event.answer,
          session_id: event.session_id,
          source: event.source,
          tools_used: event.tools_used,
        };
      }
      if (event.type === "error") {
        throw new Error(event.message ?? "Largo stream failed");
      }
    }
  }

  if (!result) throw new Error("Largo stream ended without result");
  return result;
}

export type LargoChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools_used: string[];
  created_at: string;
};

export const fetchLargoSession = (sessionId: string) =>
  marketFetch<{ session_id: string; messages: LargoChatMessage[] }>(
    `/largo/session?session_id=${encodeURIComponent(sessionId)}`
  );

// ── Live flow stream (website SSE — no engine WebSocket required) ─────────────

export type PulseStreamSnapshot = {
  spx?: { price: number; change_pct?: number };
  vix?: { price: number; change_pct?: number };
  vix9d?: { price: number };
  vix3m?: { price: number };
  tick?: { price: number };
  trin?: { price: number };
  add?: { price: number };
  t?: number;
};

type ReconnectingEventSource = {
  close: () => void;
};

function createReconnectingEventSource(
  url: string,
  onData: (raw: string) => void,
  hooks?: { onOpen?: () => void; onClose?: () => void }
): ReconnectingEventSource {
  let es: EventSource | null = null;
  let closed = false;
  let retryMs = 1_000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const connect = () => {
    if (closed || typeof window === "undefined") return;
    es?.close();
    es = new EventSource(url);
    es.onopen = () => {
      retryMs = 1_000;
      hooks?.onOpen?.();
    };
    es.onmessage = (e) => onData(e.data);
    es.onerror = () => {
      hooks?.onClose?.();
      es?.close();
      es = null;
      if (closed) return;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryMs = Math.min(retryMs * 2, 30_000);
        connect();
      }, retryMs);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      clearRetry();
      es?.close();
      es = null;
      hooks?.onClose?.();
    },
  };
}

export function createFlowEventSource(
  onMessage: (alert: FlowAlert) => void,
  hooks?: { onOpen?: () => void; onClose?: () => void }
): ReconnectingEventSource | null {
  if (typeof window === "undefined") return null;
  return createReconnectingEventSource(
    "/api/market/flows/stream",
    (raw) => {
      try {
        const data = JSON.parse(raw) as { type?: string } & Partial<FlowAlert>;
        if (data.type === "flow" && data.ticker) onMessage(data as FlowAlert);
      } catch {
        /* ignore */
      }
    },
    hooks
  );
}

export function createPulseEventSource(
  onMessage: (snap: PulseStreamSnapshot) => void,
  hooks?: { onOpen?: () => void; onClose?: () => void }
): ReconnectingEventSource | null {
  if (typeof window === "undefined") return null;
  return createReconnectingEventSource(
    "/api/market/spx/pulse/stream",
    (raw) => {
      try {
        const data = JSON.parse(raw) as PulseStreamSnapshot;
        if ((data.spx?.price ?? 0) <= 0) return;
        onMessage(data);
      } catch {
        /* ignore */
      }
    },
    hooks
  );
}

// Removed deprecated createFlowSocket() — it was never called and was the only
// client reference to NEXT_PUBLIC_ENGINE_WS_KEY / NEXT_PUBLIC_ENGINE_WS_URL,
// which inlined a static engine WS key into the browser bundle. The live feed
// uses createFlowEventSource → /api/market/flows/stream (server-gated SSE).

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
