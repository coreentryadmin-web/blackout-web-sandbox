/**
 * Singleton UW WebSocket manager — multiplex socket per official UW examples.
 * @see https://github.com/unusual-whales/api-examples
 */
import { persistAndPublishFlowAlert } from "@/lib/flow-persist";
import {
  UW_WS_CHANNELS,
  type UwWsChannel,
  PLAY_HALT_WATCH_SYMBOLS,
} from "@/lib/live-api-integrations";
import { UW_SOCKET_STALL_MS, freshestMessageAt as freshestFromMap } from "./uw-socket-stall";
import { isUwErrorFrame } from "@/lib/ws/uw-frame";
import {
  normalizeDarkPoolWsPayload,
  normalizeGexWsPayload,
  normalizeIntervalFlowWsPayload,
  normalizeNetFlowWsPayload,
  normalizeTradingHaltsWsPayload,
  parseUwFlowAlert,
  type DarkPoolSnapshot,
  type TradingHaltEvent,
} from "@/lib/providers/unusual-whales";
import {
  type StoredTradingHalt,
  pruneExpiredHalts,
} from "./trading-halts-expiry";

type Handler = (data: unknown) => void;

type ChannelState = "idle" | "connecting" | "open" | "degraded" | "auth_failed";

const ALL_CHANNELS: UwWsChannel[] = [...UW_WS_CHANNELS];

const CHANNEL_JOIN_NAME: Record<UwWsChannel, string> = Object.fromEntries(
  ALL_CHANNELS.map((ch) => [ch, ch])
) as Record<UwWsChannel, string>;

const AUTH_FAILED_BACKOFF_MS = 5 * 60_000;

const UW_API_KEY = (process.env.UW_API_KEY ?? "").trim();
const UW_CLIENT_ID = process.env.UW_CLIENT_API_ID ?? "100001";

function normalizeSocketRoot(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  if (trimmed.endsWith("/api/socket")) {
    return "wss://api.unusualwhales.com/socket";
  }
  return trimmed;
}

function buildSocketUrl(): string {
  const root = normalizeSocketRoot(
    process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/socket"
  );
  return `${root}?token=${encodeURIComponent(UW_API_KEY)}`;
}

function channelFromWireName(name: string): UwWsChannel | null {
  const n = name.replace(/-/g, "_");
  return ALL_CHANNELS.includes(n as UwWsChannel) ? (n as UwWsChannel) : null;
}

class UwSocketManager {
  private ws: WebSocket | null = null;
  private handlers = new Map<UwWsChannel, Set<Handler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private joined = new Set<UwWsChannel>();
  private authenticated = new Map<UwWsChannel, boolean>();
  private channelState = new Map<UwWsChannel, ChannelState>();
  private authFailedUntil = 0;
  private lastCloseReason: string | null = null;
  private authFailedLogged = false;
  private connectStarted = false;

  private channelsWithHandlers(): UwWsChannel[] {
    return ALL_CHANNELS.filter((ch) => (this.handlers.get(ch)?.size ?? 0) > 0);
  }

  private markAuthFailed(reason: string) {
    this.authFailedUntil = Date.now() + AUTH_FAILED_BACKOFF_MS;
    this.lastCloseReason = reason;
    for (const ch of ALL_CHANNELS) {
      this.authenticated.set(ch, false);
      this.channelState.set(ch, "auth_failed");
    }
    this.joined.clear();
    this.teardownSocket();
    if (!this.authFailedLogged) {
      this.authFailedLogged = true;
      console.error(`[uw-socket] auth failed (${reason}) — check UW_API_KEY`);
    }
    this.scheduleReconnect();
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private teardownSocket() {
    const ws = this.ws;
    this.ws = null;
    this.connectStarted = false;
    if (ws && ws.readyState <= 1) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect() {
    if (this.channelsWithHandlers().length === 0) return;
    this.clearReconnect();
    const delay =
      Date.now() < this.authFailedUntil
        ? Math.max(0, this.authFailedUntil - Date.now())
        : Math.min(this.reconnectDelay, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.authFailedLogged = false;
      this.connect();
    }, delay || 1000);
  }

  private sendJoin(channel: UwWsChannel) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        channel: CHANNEL_JOIN_NAME[channel],
        msg_type: "join",
      })
    );
  }

  private joinActiveChannels() {
    for (const channel of this.channelsWithHandlers()) {
      if (!this.joined.has(channel)) {
        this.sendJoin(channel);
      }
    }
  }

  private dispatch(channel: UwWsChannel, payload: unknown) {
    if (
      payload &&
      typeof payload === "object" &&
      "status" in (payload as Record<string, unknown>)
    ) {
      const status = String((payload as Record<string, unknown>).status ?? "");
      if (status === "ok") {
        this.joined.add(channel);
        this.authenticated.set(channel, true);
        this.channelState.set(channel, "open");
        this.lastCloseReason = null;
      } else {
        // A status frame that is not an ok-ack (e.g. status:error) is a
        // server-side problem, not proof of a healthy authenticated channel.
        // Do NOT flip authenticated and do NOT forward to data handlers.
        this.channelState.set(channel, "degraded");
      }
      return;
    }

    // An error frame (e.g. ["gex", { error: "..." }]) must never be treated as
    // an authenticated data row. Mark the channel degraded and drop it — auth
    // failures are detected separately from the top-level error frame path.
    if (isUwErrorFrame(payload)) {
      this.channelState.set(channel, "degraded");
      return;
    }

    // Only a genuine data row proves the channel is open + authenticated.
    this.authenticated.set(channel, true);
    this.channelState.set(channel, "open");
    this.lastCloseReason = null;

    this.handlers.get(channel)?.forEach((h) => {
      try {
        h(payload);
      } catch {
        /* ignore handler errors */
      }
    });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (Array.isArray(parsed) && parsed.length >= 2) {
      const wireChannel = String(parsed[0] ?? "");
      const channel = channelFromWireName(wireChannel);
      if (channel) {
        this.dispatch(channel, parsed[1]);
      }
      return;
    }

    if (parsed && typeof parsed === "object") {
      const row = parsed as Record<string, unknown>;
      if (row.error) {
        const err = String(row.error).toLowerCase();
        if (err.includes("unauthorized") || err.includes("forbidden") || err.includes("invalid token")) {
          this.markAuthFailed(String(row.error));
        }
      }
    }
  }

  subscribe(channel: UwWsChannel, handler: Handler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    this.connect();
    if (this.ws?.readyState === 1 && !this.joined.has(channel)) {
      this.sendJoin(channel);
    }
    return () => {
      this.handlers.get(channel)?.delete(handler);
    };
  }

  private connect() {
    if (!UW_API_KEY) {
      this.markAuthFailed("UW_API_KEY not set");
      return;
    }

    if (this.channelsWithHandlers().length === 0) return;

    if (Date.now() < this.authFailedUntil) {
      for (const ch of this.channelsWithHandlers()) {
        this.channelState.set(ch, "auth_failed");
      }
      this.scheduleReconnect();
      return;
    }

    if (this.ws && this.ws.readyState <= 1) return;
    if (this.connectStarted) return;

    this.clearReconnect();
    this.connectStarted = true;
    for (const ch of this.channelsWithHandlers()) {
      this.channelState.set(ch, "connecting");
    }

    try {
      const ws = new WebSocket(buildSocketUrl(), {
        headers: {
          Accept: "application/json",
          "UW-CLIENT-API-ID": UW_CLIENT_ID,
        },
      } as unknown as string[]);
      this.ws = ws;

      ws.onopen = () => {
        this.connectStarted = false;
        this.reconnectDelay = 1000;
        console.log("[uw-socket] multiplex connected — joining channels");
        this.joinActiveChannels();
      };

      ws.onmessage = (event) => {
        this.handleMessage(String(event.data));
      };

      ws.onerror = () => {
        /* onclose carries actionable detail */
      };

      ws.onclose = (event) => {
        this.connectStarted = false;
        const reason = event.reason?.trim() || `code=${event.code}`;
        this.lastCloseReason = reason;
        this.ws = null;
        this.joined.clear();
        for (const ch of ALL_CHANNELS) {
          this.authenticated.set(ch, false);
          if (this.channelState.get(ch) !== "auth_failed") {
            this.channelState.set(ch, "idle");
          }
        }

        const authFailure =
          event.code === 1008 ||
          event.code === 4401 ||
          event.code === 4403 ||
          /401|403|unauthorized|forbidden|authentication/i.test(reason);

        if (authFailure) {
          this.markAuthFailed(reason);
          return;
        }

        console.warn(`[uw-socket] multiplex closed (${reason}) — reconnecting`);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
        this.scheduleReconnect();
      };
    } catch (err) {
      this.connectStarted = false;
      const msg = err instanceof Error ? err.message : "open failed";
      console.warn(`[uw-socket] failed to open: ${msg}`);
      this.scheduleReconnect();
    }
  }

  heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const pingable = ws as WebSocket & { ping?: () => void };
    if (typeof pingable.ping === "function") {
      try {
        pingable.ping();
      } catch {
        /* ignore */
      }
    }
  }

  /** True only while the multiplex socket reports OPEN (readyState 1). */
  isOpen(): boolean {
    return this.ws?.readyState === 1;
  }

  /**
   * Half-open watchdog: when the socket is OPEN but has stopped delivering
   * (no message on any channel-with-handlers within the stall window despite
   * prior delivery), tear it down and reconnect. A socket that has never
   * delivered yet (freshest == null) is left alone so a freshly opened socket
   * is not churned before first data arrives.
   */
  reconnectIfStalled(freshestMessageAt: number | null, stallMs: number, now = Date.now()): boolean {
    if (!this.isOpen()) return false;
    if (this.channelsWithHandlers().length === 0) return false;
    if (freshestMessageAt == null) return false;
    if (now - freshestMessageAt <= stallMs) return false;
    console.warn(
      `[uw-socket] stall watchdog — OPEN but no data for ${Math.round((now - freshestMessageAt) / 1000)}s, reconnecting`
    );
    this.reconnectDelay = 1000;
    this.teardownSocket();
    this.scheduleReconnect();
    return true;
  }

  getStatus(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const channel of ALL_CHANNELS) {
      if (this.channelState.get(channel) === "auth_failed") {
        result[channel] = "AUTH_FAILED";
      } else if (this.authenticated.get(channel)) {
        result[channel] = "OPEN";
      } else if (this.ws?.readyState === 1) {
        result[channel] = "CONNECTING";
      } else {
        result[channel] = "CLOSED";
      }
    }
    return result;
  }

  getChannelHealth(): Record<
    UwWsChannel,
    {
      ws_state: string;
      authenticated: boolean;
      handlers: number;
      auth_failed: boolean;
      auth_retry_at: number | null;
      last_close_reason: string | null;
      last_error: string | null;
    }
  > {
    const multiplexOpen = this.ws?.readyState === 1;
    const out = {} as Record<
      UwWsChannel,
      {
        ws_state: string;
        authenticated: boolean;
        handlers: number;
        auth_failed: boolean;
        auth_retry_at: number | null;
        last_close_reason: string | null;
        last_error: string | null;
      }
    >;

    for (const channel of ALL_CHANNELS) {
      const authFailed = this.channelState.get(channel) === "auth_failed";
      const authed = Boolean(this.authenticated.get(channel));
      const retryAt = this.authFailedUntil > Date.now() ? this.authFailedUntil : null;
      out[channel] = {
        ws_state: authFailed
          ? "AUTH_FAILED"
          : authed
            ? "OPEN"
            : multiplexOpen
              ? "CONNECTING"
              : "CLOSED",
        authenticated: authed,
        handlers: this.handlers.get(channel)?.size ?? 0,
        auth_failed: authFailed,
        auth_retry_at: retryAt,
        last_close_reason: this.lastCloseReason,
        last_error: authFailed ? this.lastCloseReason : null,
      };
    }
    return out;
  }
}

export const uwSocket = new UwSocketManager();

export const tideStore: {
  call_premium: number;
  put_premium: number;
  net: number;
  bias: string;
  updatedAt: number;
} = { call_premium: 0, put_premium: 0, net: 0, bias: "neutral", updatedAt: 0 };

export const darkPoolStore: {
  data: DarkPoolSnapshot | null;
  updatedAt: number;
} = { data: null, updatedAt: 0 };

export const gexStore: {
  rows: Record<string, unknown>[];
  updatedAt: number;
} = { rows: [], updatedAt: 0 };

export const netFlowStore: {
  call_premium: number;
  put_premium: number;
  net: number;
  ticker: string;
  updatedAt: number;
} = { call_premium: 0, put_premium: 0, net: 0, ticker: "SPX", updatedAt: 0 };

export const intervalFlowStore: {
  rows: Record<string, unknown>[];
  updatedAt: number;
} = { rows: [], updatedAt: 0 };

export const tradingHaltsStore: {
  halts: Map<string, StoredTradingHalt>;
  updatedAt: number;
} = { halts: new Map(), updatedAt: 0 };

const TRADING_HALT_CHANNEL_MAX_AGE_MS = 120_000;

/**
 * Max age for a stored active halt before it is treated as resolved. A halt is
 * normally cleared by a resume event (active:false), but that event can be
 * dropped or missed across a reconnect — without an expiry the symbol would
 * stay "halted" (and block entries) forever. UW halts on watched symbols are
 * minutes-scale; 30m is a safe ceiling well past any real intraday halt.
 */
const TRADING_HALT_MAX_AGE_MS = 30 * 60_000;

/** True when the UW trading_halts channel has not delivered data recently. */
export function isTradingHaltChannelStale(maxAgeMs = TRADING_HALT_CHANNEL_MAX_AGE_MS): boolean {
  if (!UW_API_KEY) return true;
  return !isUwChannelFresh("trading_halts", maxAgeMs);
}

/** Check if any watched symbol has an active trading halt. */
export function hasActiveTradingHalt(symbols: readonly string[] = PLAY_HALT_WATCH_SYMBOLS): boolean {
  pruneExpiredHalts(tradingHaltsStore.halts, Date.now(), TRADING_HALT_MAX_AGE_MS);
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  for (const sym of Array.from(tradingHaltsStore.halts.keys())) {
    const halt = tradingHaltsStore.halts.get(sym);
    if (halt && watch.has(sym) && halt.active) return true;
  }
  return false;
}

/** Fail closed when halt feed is stale during live sessions (empty map ≠ safe). */
export function shouldBlockForTradingHalt(
  symbols: readonly string[] = PLAY_HALT_WATCH_SYMBOLS,
  opts?: { failClosedOnStale?: boolean }
): { block: boolean; reason: string | null } {
  if (hasActiveTradingHalt(symbols)) {
    const labels = getActiveTradingHalts(symbols)
      .map((h) => h.symbol)
      .join(", ");
    return { block: true, reason: `Trading halt active — ${labels} halted, no entries` };
  }
  if (opts?.failClosedOnStale !== false && isTradingHaltChannelStale()) {
    return {
      block: true,
      reason: "Trading halt feed stale — entries blocked until UW halts channel recovers",
    };
  }
  return { block: false, reason: null };
}

/** List active halts for watched symbols. */
export function getActiveTradingHalts(symbols: readonly string[] = PLAY_HALT_WATCH_SYMBOLS): TradingHaltEvent[] {
  pruneExpiredHalts(tradingHaltsStore.halts, Date.now(), TRADING_HALT_MAX_AGE_MS);
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  return Array.from(tradingHaltsStore.halts.values()).filter((h) => watch.has(h.symbol) && h.active);
}

let uwSocketInitialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const lastMessageAt: Partial<Record<UwWsChannel, number>> = {};

/**
 * Freshest delivery across all subscribed channels. initUwSocket subscribes
 * every UW_WS_CHANNELS entry unconditionally, so ALL_CHANNELS == the
 * channels-with-handlers and is the correct active set here.
 */
function freshestUwMessageAt(): number | null {
  return freshestFromMap(lastMessageAt, ALL_CHANNELS);
}

export function initUwSocket() {
  if (uwSocketInitialized) return;
  if (!UW_API_KEY) {
    console.warn("[uw-socket] UW_API_KEY not set — WebSocket disabled, falling back to REST polling");
    return;
  }
  uwSocketInitialized = true;

  uwSocket.subscribe("flow_alerts", (payload) => {
    try {
      const block = Array.isArray(payload) ? payload : [payload];
      lastMessageAt.flow_alerts = Date.now();
      for (const raw of block) {
        if (!raw || typeof raw !== "object") continue;
        const flow = parseUwFlowAlert(raw as Record<string, unknown>);
        void persistAndPublishFlowAlert(raw as Record<string, unknown>, flow);
      }
    } catch {
      /* ignore */
    }
  });

  uwSocket.subscribe("market_tide", (payload) => {
    try {
      const row = Array.isArray(payload) ? payload[payload.length - 1] : payload;
      if (!row || typeof row !== "object") return;
      if ("status" in (row as Record<string, unknown>)) return;
      lastMessageAt.market_tide = Date.now();
      const r = row as Record<string, unknown>;
      const call = Number(r.net_call_premium ?? r.call_premium ?? 0);
      const put = Number(r.net_put_premium ?? r.put_premium ?? 0);
      Object.assign(tideStore, {
        call_premium: call,
        put_premium: put,
        net: call - put,
        bias: call > put ? "bullish" : put > call ? "bearish" : "neutral",
        updatedAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  });

  uwSocket.subscribe("off_lit_trades", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const normalized = normalizeDarkPoolWsPayload(payload);
    if (normalized) {
      lastMessageAt.off_lit_trades = Date.now();
      darkPoolStore.data = normalized;
      darkPoolStore.updatedAt = Date.now();
    }
  });

  uwSocket.subscribe("gex", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const rows = normalizeGexWsPayload(payload);
    if (rows.length) {
      lastMessageAt.gex = Date.now();
      gexStore.rows = rows;
      gexStore.updatedAt = Date.now();
    }
  });

  uwSocket.subscribe("net_flow", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const flow = normalizeNetFlowWsPayload(payload, "SPX");
    if (flow) {
      lastMessageAt.net_flow = Date.now();
      Object.assign(netFlowStore, { ...flow, updatedAt: Date.now() });
    }
  });

  uwSocket.subscribe("interval_flow", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const rows = normalizeIntervalFlowWsPayload(payload);
    if (rows.length) {
      lastMessageAt.interval_flow = Date.now();
      intervalFlowStore.rows = rows;
      intervalFlowStore.updatedAt = Date.now();
    }
  });

  uwSocket.subscribe("trading_halts", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const events = normalizeTradingHaltsWsPayload(payload);
    if (!events.length) return;
    const now = Date.now();
    lastMessageAt.trading_halts = now;
    for (const ev of events) {
      if (ev.active) {
        tradingHaltsStore.halts.set(ev.symbol, { ...ev, receivedAt: now });
      } else {
        tradingHaltsStore.halts.delete(ev.symbol);
      }
    }
    tradingHaltsStore.updatedAt = now;
  });

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      uwSocket.heartbeat();
      uwSocket.reconnectIfStalled(freshestUwMessageAt(), UW_SOCKET_STALL_MS);
    }, 30_000);
  }

  console.log(
    `[uw-socket] initialized — multiplex ${ALL_CHANNELS.join(", ")}`
  );
}

/**
 * True only if the channel has delivered a message within `maxAgeMs`. A channel
 * can report "OPEN" (authenticated) while silently delivering nothing — callers
 * that depend on live data (e.g. flow ingest fallback) must check freshness, not
 * just connection status.
 */
export function isUwChannelFresh(channel: UwWsChannel, maxAgeMs = 120_000): boolean {
  const at = lastMessageAt[channel];
  return at != null && Date.now() - at <= maxAgeMs;
}

export function getUwSocketHealth() {
  const now = Date.now();
  const channels = uwSocket.getChannelHealth();
  const authFailedChannels = (Object.entries(channels) as [UwWsChannel, (typeof channels)[UwWsChannel]][])
    .filter(([, row]) => row.auth_failed)
    .map(([ch]) => ch);

  const last_message_at: Record<string, number | null> = {};
  const last_message_age_ms: Record<string, number | null> = {};
  for (const ch of ALL_CHANNELS) {
    const at = lastMessageAt[ch] ?? null;
    last_message_at[ch] = at;
    last_message_age_ms[ch] = at ? now - at : null;
  }

  return {
    configured: Boolean(UW_API_KEY),
    initialized: uwSocketInitialized,
    auth_failed: authFailedChannels.length > 0,
    auth_failed_channels: authFailedChannels,
    channels,
    last_message_at,
    last_message_age_ms,
    stores: {
      tide_updated_at: tideStore.updatedAt || null,
      dark_pool_updated_at: darkPoolStore.updatedAt || null,
      gex_updated_at: gexStore.updatedAt || null,
      net_flow_updated_at: netFlowStore.updatedAt || null,
      interval_flow_updated_at: intervalFlowStore.updatedAt || null,
      trading_halts_updated_at: tradingHaltsStore.updatedAt || null,
      active_halts: Array.from(tradingHaltsStore.halts.values())
        .filter((h) => h.active)
        .map((h) => h.symbol),
    },
  };
}
