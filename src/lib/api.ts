import type { ClaimVerification } from "@/lib/bie/verifier";

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

export type { SpxState } from "@/lib/spx-desk-state";
export { emptySpxState, deskPayloadToSpxState } from "@/lib/spx-desk-state";
import type { SpxState } from "@/lib/spx-desk-state";
import { deskPayloadToSpxState, emptySpxState } from "@/lib/spx-desk-state";

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

export type SpxCommentaryResponse = {
  commentary: SpxCommentaryResult;
  window_slot: number;
  next_refresh_ms: number;
};

/** Claude live desk commentary — requires auth */
export async function requestSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null
): Promise<SpxCommentaryResponse> {
  // previous is no longer sent — server reads last-window state from Redis
  const res = await fetch("/api/market/spx/commentary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desk }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Commentary → ${res.status}`);
  }
  return res.json() as Promise<SpxCommentaryResponse>;
}

/** Full SPX-Sniper desk — Polygon + UW dealer/flow (slower lane, ~10s). */
export const fetchSpxDesk = () => marketFetch<SpxDeskPayload>("/spx/desk");

/** One-shot dashboard bundle — desk + flow + pulse + merged (+ SPX matrix server-side). */
export type SpxBootstrapPayload = {
  desk: SpxDeskPayload;
  flow: import("@/lib/providers/spx-desk").SpxDeskFlow | null;
  pulse: import("@/lib/providers/spx-desk").SpxDeskPulse | null;
  merged: SpxDeskPayload;
  gexHeatmap: import("@/lib/providers/polygon-options-gex").GexHeatmap | null;
};

export const fetchSpxBootstrap = () => marketFetch<SpxBootstrapPayload>("/spx/bootstrap");

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

/** Power hour track (2:45–3:15 PM ET) — read-only cron-maintained record. */
export const fetchSpxPowerHour = () =>
  marketFetch<{
    available: boolean;
    as_of: string;
    power_hour: import("@/lib/spx-power-hour-engine").PowerHourPlayPayload;
  }>("/spx/power-hour");

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
  /** Empty string '' for timestampless UW prints — the /flows REST read returns '' (not a fabricated
   *  inserted_at) so the client excludes them from LIVE/sort, matching the SSE path + parser (gap-#6). */
  alerted_at: string;
  /** Real UW alert time (created_at); null when UW gave no timestamp. Used for
   *  velocity/freshness so a just-ingested stale print can't masquerade as "now". */
  event_at?: string | null;
  /** Canonical UW alert id (same id used for the Postgres ON-CONFLICT) — rides the SSE row so the
   *  client dedups on it instead of a reconstructed composite (gap #13). Optional: DB-served REST
   *  rows may omit it, and the client falls back to the seconds-precision composite key. */
  alert_id?: string;
  alert_rule?: string;
  ask_pct?: number;
  dte?: number;
  // Feature 5: options chain context at time of print
  underlying_price?: number;
  open_interest?: number;
  implied_volatility?: number;
  otm_pct?: number;
  /** GEX wall cross-reference computed server-side. One of: 'at_gamma_flip' | 'at_call_wall' |
   *  'at_put_wall' | 'near_call_wall' | 'near_put_wall'. Absent when GEX data is cold or the
   *  strike is not near any key level. Never fabricated — null/absent = no signal. */
  gex_proximity?: string;
}

export interface DarkPoolRow {
  ticker: string;
  premium: number;
  side: string;
  executed_at: string;
  share_size?: number;
}

export interface DarkPoolTickerPrint {
  strike: number;
  premium: number;
  side: string;
  executed_at: string;
}

export interface DarkPoolTickerSnapshot {
  total_premium: number;
  call_premium: number;
  put_premium: number;
  bias: string;
  pcr: number | null;
  detail: string;
  prints: DarkPoolTickerPrint[];
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

/** Upcoming earnings dates — ticker → YYYY-MM-DD. Returns {} on error (graceful degradation). */
export async function fetchEarningsCalendar(): Promise<Record<string, string>> {
  try {
    const d = await marketFetch<{ earnings: Record<string, string> }>("/earnings-calendar");
    return d.earnings ?? {};
  } catch {
    return {};
  }
}

/** Dark pool prints — market-wide institutional off-lit trades. */
export async function fetchDarkPoolPrints(params?: { limit?: number; min_premium?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.min_premium) qs.set("min_premium", String(params.min_premium));
  const query = qs.toString();

  return marketFetch<{ prints: DarkPoolRow[]; count: number }>(
    `/dark-pool${query ? `?${query}` : ""}`
  );
}

/** Per-ticker dark pool snapshot — call/put split, PCR, institutional prints by strike. */
export async function fetchDarkPoolTicker(symbol: string) {
  return marketFetch<{ snapshot: DarkPoolTickerSnapshot | null; symbol: string }>(
    `/dark-pool/ticker?symbol=${encodeURIComponent(symbol)}`
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

export const fetchNightHawkPlayStatus = (date?: string) =>
  fetch(
    `/api/nighthawk/play-status${date ? `?date=${encodeURIComponent(date)}` : ""}`,
    { cache: "no-store", credentials: "same-origin" }
  )
    .then((res) => (res.ok ? res.json() : { available: false }))
    .catch(() => ({ available: false })) as Promise<
    import("@/lib/nighthawk/types").NightHawkPlayStatusResponse
  >;

export const fetchNightHawkRecord = (days = 30) =>
  marketFetch<import("@/lib/nighthawk/types").NightHawkRecordResponse>(
    `/nighthawk/record?days=${days}`
  ).catch(() => ({
    available: false,
    window_days: days,
    total_resolved: 0,
    pending_count: 0,
    win_rate_pct: 0,
    profitable_rate_pct: 0,
    avg_return_pct: 0,
    by_conviction: [],
  }));

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

/** Client-side ceiling — route maxDuration is 120s; leave headroom for slow mobile proxies. */
const LARGO_STREAM_TIMEOUT_MS = 130_000;

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
  onToken: (text: string) => void,
  /** Fires for each live tool Largo pulls (tool_start), enabling a real-time data-trace UI. */
  onTool?: (name: string) => void
): Promise<{
  answer: string;
  session_id: string;
  source?: string;
  tools_used?: string[];
  followups?: string[];
  verification?: ClaimVerification;
}> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), LARGO_STREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${MARKET_BASE}/largo/query?stream=1`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: abort.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ question, session_id: sessionId }),
    });
  } catch (err) {
    clearTimeout(timeout);
    if (abort.signal.aborted) throw new Error("Largo stream timeout");
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timeout);
    throw new Error(`Market /largo/query → ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("Largo stream unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result:
    | {
        answer: string;
        session_id: string;
        source?: string;
        tools_used?: string[];
        followups?: string[];
        verification?: ClaimVerification;
      }
    | null = null;

  try {
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
          name?: string;
          message?: string;
          answer?: string;
          session_id?: string;
          source?: string;
          tools_used?: string[];
          followups?: string[];
          verification?: ClaimVerification;
        };

        if (event.type === "ping") continue;
        if (event.type === "ping") continue;
        if (event.type === "token" && event.text) onToken(event.text);
        if (event.type === "tool_start" && event.name) onTool?.(event.name);
        if (event.type === "done" && event.answer && event.session_id) {
          result = {
            answer: event.answer,
            session_id: event.session_id,
            source: event.source,
            tools_used: event.tools_used,
            followups: event.followups,
            verification: event.verification,
          };
        }
        if (event.type === "error") {
          throw new Error(event.message ?? "Largo stream failed");
        }
      }
    }
  } catch (err) {
    if (abort.signal.aborted) throw new Error("Largo stream timeout");
    throw err;
  } finally {
    clearTimeout(timeout);
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
  /** UW market tide — pushed from the server-side tideStore when fresh. */
  tide?: { call_premium: number; put_premium: number; net: number; bias: string };
  /** UW dark-pool snapshot — pushed from the server-side darkPoolStore when fresh. */
  darkPool?: Record<string, unknown>;
  /** UW interval-flow snapshot — pushed from the server-side intervalFlowStore when fresh. */
  intervalFlow?: { rows: Record<string, unknown>[]; updatedAt: number };
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

  let hasOpened = false;

  const connect = () => {
    if (closed || typeof window === "undefined") return;
    es?.close();
    hasOpened = false;
    es = new EventSource(url);
    es.onopen = () => {
      hasOpened = true;
      retryMs = 1_000;
      hooks?.onOpen?.();
    };
    es.onmessage = (e) => onData(e.data);
    es.onerror = () => {
      // Only signal close to callers if the connection was actually open — avoids
      // triggering loadFlows() on initial connect failures before the stream was used.
      if (hasOpened) hooks?.onClose?.();
      hasOpened = false;
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
  hooks?: { onOpen?: () => void; onClose?: () => void },
  ticker?: string
): ReconnectingEventSource | null {
  if (typeof window === "undefined") return null;
  const url = ticker
    ? `/api/market/flows/stream?ticker=${encodeURIComponent(ticker)}`
    : "/api/market/flows/stream";
  return createReconnectingEventSource(
    url,
    (raw) => {
      try {
        const data = JSON.parse(raw) as { type?: string } & Partial<FlowAlert>;
        // Validate all required fields before casting — avoids downstream crashes
        // on malformed payloads from the SSE bridge.
        if (
          data.type === "flow" &&
          data.ticker &&
          data.option_type &&
          data.premium != null &&
          data.strike != null &&
          data.expiry &&
          data.alerted_at
        ) {
          onMessage(data as FlowAlert);
        }
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

// ── Vector live SPX candle stream ──────────────────────────────────────────────

export type VectorStreamCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume proxy for this SPX minute bar. */
  volume?: number;
};
export type VectorWallLevel = { strike: number; pct: number };
/** Ranked strongest-first per side, capped server-side (gex-wall-levels.ts's DEFAULT_WALL_NODES_PER_SIDE). */
export type VectorWalls = { callWalls: VectorWallLevel[]; putWalls: VectorWallLevel[] };
export type VectorDarkPoolLevel = { strike: number; premium: number; pct: number };

export type VectorStreamSnapshot = {
  candle: VectorStreamCandle | null;
  walls?: VectorWalls | null;
  vexWalls?: VectorWalls | null;
  gammaFlip?: number | null;
  vexFlip?: number | null;
  darkPoolLevels?: VectorDarkPoolLevel[];
  /** Candle tick time (epoch ms). */
  t?: number;
  /** GEX wall ladder as-of (epoch ms). */
  gexAsOf?: number;
  /** VEX wall ladder as-of (epoch ms). */
  vexAsOf?: number;
  sessionYmd?: string;
  wallHistory?: import("@/features/vector").WallHistorySample[];
};

export function createVectorEventSource(
  onMessage: (snap: VectorStreamSnapshot) => void,
  hooks?: { onOpen?: () => void; onClose?: () => void }
): ReconnectingEventSource | null {
  if (typeof window === "undefined") return null;
  return createReconnectingEventSource(
    "/api/market/vector/stream",
    (raw) => {
      try {
        const data = JSON.parse(raw) as VectorStreamSnapshot;
        const hasCandle = Boolean(data.candle);
        const hasWalls =
          Boolean(data.walls?.callWalls?.length) || Boolean(data.walls?.putWalls?.length);
        const hasVexWalls =
          Boolean(data.vexWalls?.callWalls?.length) || Boolean(data.vexWalls?.putWalls?.length);
        const hasWallHistory = Boolean(data.wallHistory?.length);
        const hasOverlays =
          data.gammaFlip != null ||
          data.vexFlip != null ||
          Boolean(data.darkPoolLevels?.length);
        if (!hasCandle && !hasWalls && !hasVexWalls && !hasWallHistory && !hasOverlays) return;
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

export { fmtPremium } from "@/lib/fmt-money";

export function fmtPrice(n: number | null, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function pctClass(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "num-neutral";
  return n >= 0 ? "num-bull" : "num-bear";
}
