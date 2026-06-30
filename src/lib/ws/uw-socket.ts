/**
 * Singleton UW WebSocket manager — multiplex socket per official UW examples.
 * @see https://github.com/unusual-whales/api-examples
 */
import { persistAndPublishFlowAlert, alertId as computeFlowAlertId, MIN_PREMIUM as FLOW_MIN_PREMIUM } from "@/lib/flow-persist";
import { makeFlowDedup } from "@/lib/flow-dedup";
import {
  UW_WS_CHANNELS,
  type UwWsChannel,
  PLAY_HALT_WATCH_SYMBOLS,
} from "@/lib/live-api-integrations";
import {
  UW_SOCKET_STALL_MS,
  freshestMessageAt as freshestFromMap,
  mergeFreshestTimestamps,
} from "./uw-socket-stall";
import { isUwErrorFrame } from "@/lib/ws/uw-frame";
import {
  normalizeDarkPoolWsPayload,
  normalizeGexStrikeExpiryWsPayload,
  normalizeIntervalFlowWsPayload,
  normalizeLitTradesWsPayload,
  normalizeOptionTradesWsPayload,
  normalizeTradingHaltsWsPayload,
  optionTradePrintToFlowRaw,
  parseUwFlowAlert,
  type DarkPoolSnapshot,
  type NetPremTick,
  type TradingHaltEvent,
  type UwGexStrikeExpiryRow,
  type UwLitTradePrint,
  type UwOptionTradePrint,
} from "@/lib/providers/unusual-whales";
import {
  type StoredTradingHalt,
  pruneExpiredHalts,
} from "./trading-halts-expiry";
import {
  getActiveLuldHalts,
  hasActiveLuldHalt,
  isLuldHaltSourceStale,
  luldWsEnabled,
} from "@/lib/ws/stocks-socket";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { inOptionsMarketHours } from "./options-socket";

type Handler = (data: unknown) => void;

type ChannelState = "idle" | "connecting" | "open" | "degraded" | "auth_failed";

const ALL_CHANNELS: UwWsChannel[] = [...UW_WS_CHANNELS];

const CHANNEL_JOIN_NAME: Record<UwWsChannel, string> = Object.fromEntries(
  ALL_CHANNELS.map((ch) => [ch, ch])
) as Record<UwWsChannel, string>;

const AUTH_FAILED_BACKOFF_MS = 5 * 60_000;

/** Escape hatch: keep UW socket alive off-hours when set (operator rollback). */
function uwOffHoursReconnectForced(): boolean {
  const f = (process.env.UW_WS_OFFHOURS_RECONNECT ?? "").trim().toLowerCase();
  return f === "1" || f === "true" || f === "yes" || f === "on";
}

/** May the cluster leader hold / (re)open the UW multiplex socket right now? */
export function uwSocketGateOpen(isLeader: boolean, forced: boolean, now: Date): boolean {
  if (!isLeader) return false;
  return forced || inOptionsMarketHours(now);
}

function shouldMaintainUwSocket(now = new Date()): boolean {
  return uwSocketGateOpen(uwIsLeader, uwOffHoursReconnectForced(), now);
}

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
  const base = name.split(":")[0].replace(/-/g, "_");
  return ALL_CHANNELS.includes(base as UwWsChannel) ? (base as UwWsChannel) : null;
}

function parseWsTickerCsv(raw: string | undefined, fallback: string): string[] {
  const src = (raw ?? fallback)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(src)];
}

/** Wire channel names sent on join — ticker-scoped channels use `name:TICKER`. */
function joinWiresForChannel(channel: UwWsChannel): string[] {
  if (channel === "net_flow") {
    return parseWsTickerCsv(process.env.UW_WS_NET_FLOW_TICKERS, "SPX,SPY,QQQ,IWM").map(
      (t) => `net_flow:${t}`
    );
  }
  if (channel === "option_trades") {
    return parseWsTickerCsv(process.env.UW_WS_OPTION_TRADES_TICKERS, "SPX,SPY").map(
      (t) => `option_trades:${t}`
    );
  }
  if (channel === "lit_trades") {
    return parseWsTickerCsv(process.env.UW_WS_LIT_TRADES_TICKERS, "SPY").map((t) => `lit_trades:${t}`);
  }
  if (channel === "gex_strike_expiry") {
    return parseWsTickerCsv(process.env.UW_WS_GEX_STRIKE_EXPIRY_TICKERS, "SPX").map(
      (t) => `gex_strike_expiry:${t}`
    );
  }
  return [CHANNEL_JOIN_NAME[channel]];
}

// ── Cross-replica leader election ────────────────────────────────────────────────────────────────
// UW streams to only ONE WebSocket per API key: with N web replicas each opening their own multiplex
// socket, UW silently delivers data to none of the contenders (no boot/close frame — just silence),
// so every replica's stall watchdog tears down and reconnects forever and the whole cluster goes
// dark during RTH (verified live: a single direct connection with the same key streams full data
// instantly). Mirror the proven options-socket pattern: a Redis SETNX lock so only ONE replica holds
// the UW socket. Non-leaders open NOTHING — flow_alerts are read cross-replica from Postgres (the
// leader persists them) and tide/dark-pool/interval-flow fall back to the REST path in spx-desk, so
// no replica serves empty live data. If the leader dies (SIGTERM drops the lock, or the 25s TTL
// lapses), the next reconcile tick on a standby wins the lock and takes over.
const UW_LEADER_KEY = "uw:ws:leader";
const UW_LEADER_TTL_SEC = 25;
/** Cross-replica UW delivery heartbeat — written by the cluster leader, read by standbys. */
const UW_CLUSTER_LAST_MSG_KEY = "uw:ws:last_msg_at";
const UW_CLUSTER_LAST_MSG_TTL_SEC = 180;
let uwIsLeader = false;
let uwLeaderRefreshTimer: ReturnType<typeof setInterval> | null = null;
/** Last UW delivery timestamp observed cluster-wide (local or Redis). */
let clusterFreshestAt: number | null = null;
let clusterFreshnessPollerStarted = false;

type IoredisLockExtra = {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
  expire(k: string, ttl: number): Promise<number>;
  del(k: string): Promise<number>;
};

async function tryAcquireUwLead(): Promise<boolean> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return true; // Redis unavailable — allow the WS (single-replica safe / fail-open)
    const r = redis as unknown as IoredisLockExtra;
    const result = await r.set(UW_LEADER_KEY, "1", "EX", UW_LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    return true; // Redis error — fail open so a Redis blip can't silently kill the feed cluster-wide
  }
}

/** Acquire leadership if we don't already hold it. The refresh timer keeps the lease alive. */
async function ensureUwLeadership(): Promise<boolean> {
  if (uwIsLeader) return true;
  uwIsLeader = await tryAcquireUwLead();
  if (uwIsLeader) {
    console.log("[uw-socket] acquired cluster lead — this replica holds the UW multiplex socket");
  }
  return uwIsLeader;
}

function startUwLeaderRefresh(): void {
  if (uwLeaderRefreshTimer) return;
  // Renew every 10s, well within the 25s TTL, so leadership persists while this replica lives.
  uwLeaderRefreshTimer = setInterval(() => {
    if (!uwIsLeader) return;
    getUwCacheRedis()
      .then((redis) => redis && (redis as unknown as IoredisLockExtra).expire(UW_LEADER_KEY, UW_LEADER_TTL_SEC))
      .catch(() => undefined);
  }, 10_000);
  (uwLeaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

function releaseUwLead(): void {
  uwIsLeader = false;
  if (uwLeaderRefreshTimer) {
    clearInterval(uwLeaderRefreshTimer);
    uwLeaderRefreshTimer = null;
  }
  // Best-effort: drop the lock so a newly-booting replica can take over immediately on SIGTERM.
  getUwCacheRedis()
    .then((redis) => redis && (redis as unknown as IoredisLockExtra).del(UW_LEADER_KEY))
    .catch(() => undefined);
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
  private shuttingDown = false;

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
    if (ws) {
      // Detach handlers BEFORE closing: the ws close handshake can DEFER the 'close' event up to ~30s
      // on a half-open peer (exactly when reconnectIfStalled tears down), so a still-attached onclose
      // could fire AFTER a new socket is live and null/clobber it + double-schedule a reconnect. The
      // onclose identity guard below is the second line of defence. (Mirrors shutdown().)
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      } catch {
        /* ignore */
      }
      if (ws.readyState <= 1) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private scheduleReconnect() {
    if (this.shuttingDown) return; // shutting down — do not resurrect the socket
    if (!shouldMaintainUwSocket()) return; // off-hours / non-leader — defer reconnect
    if (!uwIsLeader) return; // only the cluster leader holds the UW socket; standbys stay closed
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
    for (const wire of joinWiresForChannel(channel)) {
      ws.send(
        JSON.stringify({
          channel: wire,
          msg_type: "join",
        })
      );
    }
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
    if (this.shuttingDown) return; // shutting down — do not open a new socket
    if (!uwIsLeader) return; // only the cluster leader holds the UW socket (reconcile tick re-checks)
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
        if (this.ws !== ws) return; // superseded socket — ignore late open
        this.connectStarted = false;
        this.reconnectDelay = 1000;
        console.log("[uw-socket] multiplex connected — joining channels");
        this.joinActiveChannels();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return; // superseded socket — ignore late frames
        this.handleMessage(String(event.data));
      };

      ws.onerror = () => {
        /* onclose carries actionable detail */
      };

      ws.onclose = (event) => {
        // Identity guard: a superseded socket's late close must not null/clobber the live ws or
        // double-schedule a reconnect (teardownSocket also detaches handlers; this covers any close
        // path that bypasses it).
        if (this.ws !== ws) return;
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

  /** Leader-side: open the multiplex socket if it isn't already connecting/open. Idempotent. */
  ensureConnected(): void {
    if (this.shuttingDown) return;
    if (this.ws && this.ws.readyState <= 1) return; // already connecting/open
    this.connect();
  }

  /**
   * Standby-side: release any socket this replica holds without scheduling a reconnect, so it stops
   * contending for the single UW streaming slot. Called from the reconcile tick when this replica is
   * not (or no longer) the cluster leader.
   */
  standDown(): void {
    this.clearReconnect();
    if (this.ws) this.teardownSocket();
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
    if (!inOptionsMarketHours(new Date(now)) && !uwOffHoursReconnectForced()) return false;
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

  /**
   * Graceful shutdown of the multiplex socket. Sets the shutdown flag (so
   * scheduleReconnect / connect bail and cannot rejoin), clears the reconnect
   * timer, and closes the live WS with a normal close (1000) so UW releases this
   * container's slot immediately on SIGTERM. Idempotent and never throws.
   */
  shutdown(): void {
    this.shuttingDown = true;
    this.clearReconnect();
    const ws = this.ws;
    this.ws = null;
    this.connectStarted = false;
    if (ws) {
      // Detach handlers first so onclose can't schedule a reconnect.
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
      } catch {
        /* ignore */
      }
      try {
        if (ws.readyState <= 1) {
          ws.close(1000, "server shutdown");
        }
      } catch {
        /* best-effort — must not block shutdown */
      }
    }
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

export const intervalFlowStore: {
  rows: Record<string, unknown>[];
  updatedAt: number;
} = { rows: [], updatedAt: 0 };

const intervalFlowByTicker = new Map<string, { rows: Record<string, unknown>[]; updatedAt: number }>();

/** Per-ticker interval-flow rows from the UW WS (defaults to SPX aggregate store). */
export function getIntervalFlowForTicker(ticker = "SPX"): { rows: Record<string, unknown>[]; updatedAt: number } {
  const sym = ticker.toUpperCase();
  return intervalFlowByTicker.get(sym) ?? (sym === "SPX" ? intervalFlowStore : { rows: [], updatedAt: 0 });
}

export const tradingHaltsStore: {
  halts: Map<string, StoredTradingHalt>;
  updatedAt: number;
} = { halts: new Map(), updatedAt: 0 };

/**
 * Per-ticker net-flow store — populated by the UW `net_flow` WS channel.
 * The channel delivers messages keyed by ticker (e.g. "SPX") with
 * call_premium / put_premium / net fields. We hold only the latest
 * SPX snapshot since that's the only ticker the desk currently needs.
 */
export const netFlowStore: {
  call_premium: number;
  put_premium: number;
  net: number;
  updatedAt: number;
} = { call_premium: 0, put_premium: 0, net: 0, updatedAt: 0 };

type NetFlowTickerSnapshot = {
  call_premium: number;
  put_premium: number;
  net: number;
  updatedAt: number;
  ticks: NetPremTick[];
};

const NET_FLOW_TICKERS = new Set(["SPX", "SPY", "QQQ", "IWM"]);
const NET_PREM_TICKS_MAX = 40;

const netFlowByTicker = new Map<string, NetFlowTickerSnapshot>();

function recordNetFlowForTicker(
  ticker: string,
  call: number,
  put: number,
  net: number,
  at = Date.now()
) {
  const sym = ticker.toUpperCase();
  const prev = netFlowByTicker.get(sym);
  const tick: NetPremTick = { time: new Date(at).toISOString(), net };
  const ticks = [...(prev?.ticks ?? []), tick].slice(-NET_PREM_TICKS_MAX);
  netFlowByTicker.set(sym, {
    call_premium: call,
    put_premium: put,
    net,
    updatedAt: at,
    ticks,
  });
  if (sym === "SPX") {
    Object.assign(netFlowStore, { call_premium: call, put_premium: put, net, updatedAt: at });
  }
}

/** Net-premium tick history derived from the UW `net_flow` WS channel. */
export function getNetPremTicksForTicker(ticker: string): NetPremTick[] {
  const snap = netFlowByTicker.get(ticker.toUpperCase());
  if (!snap?.ticks.length) return [];
  return snap.ticks;
}

export function getNetFlow(): typeof netFlowStore {
  return netFlowStore;
}

const OPTION_TRADES_RING_MAX = 250;
const LIT_TRADES_RING_MAX = 120;

export const optionTradesStore: {
  rows: UwOptionTradePrint[];
  updatedAt: number;
  total_received: number;
} = { rows: [], updatedAt: 0, total_received: 0 };

export const litTradesStore: {
  rows: UwLitTradePrint[];
  updatedAt: number;
  total_received: number;
} = { rows: [], updatedAt: 0, total_received: 0 };

const GEX_STRIKE_EXPIRY_CELL_MAX = 2500;

type GexStrikeExpiryTickerState = {
  cells: Map<string, UwGexStrikeExpiryRow>;
  updatedAt: number;
  total_received: number;
};

const gexStrikeExpiryByTicker = new Map<string, GexStrikeExpiryTickerState>();

function gexStrikeExpiryCellKey(expiry: string, strike: number): string {
  return `${expiry}|${strike}`;
}

function upsertGexStrikeExpiryRows(rows: UwGexStrikeExpiryRow[]) {
  if (!rows.length) return;
  const now = Date.now();
  for (const row of rows) {
    const sym = row.ticker.toUpperCase();
    let state = gexStrikeExpiryByTicker.get(sym);
    if (!state) {
      state = { cells: new Map(), updatedAt: 0, total_received: 0 };
      gexStrikeExpiryByTicker.set(sym, state);
    }
    state.cells.set(gexStrikeExpiryCellKey(row.expiry, row.strike), row);
    state.updatedAt = now;
    state.total_received += 1;
    if (state.cells.size > GEX_STRIKE_EXPIRY_CELL_MAX) {
      const drop = state.cells.size - GEX_STRIKE_EXPIRY_CELL_MAX;
      const keys = Array.from(state.cells.keys()).slice(0, drop);
      for (const k of keys) state.cells.delete(k);
    }
  }
}

/** Per-strike net GEX ladder aggregated from the UW `gex_strike_expiry` WS feed. */
export function getGexStrikeExpiryLadder(
  ticker: string
): { ladder: Map<number, number>; updatedAt: number; cell_count: number } | null {
  const sym = ticker.toUpperCase();
  const state = gexStrikeExpiryByTicker.get(sym);
  if (!state || state.cells.size === 0) return null;
  const ladder = new Map<number, number>();
  for (const row of state.cells.values()) {
    ladder.set(row.strike, (ladder.get(row.strike) ?? 0) + row.net_gex);
  }
  return { ladder, updatedAt: state.updatedAt, cell_count: state.cells.size };
}

function pushOptionTradeRows(prints: UwOptionTradePrint[]) {
  if (!prints.length) return;
  optionTradesStore.rows = [...prints, ...optionTradesStore.rows].slice(0, OPTION_TRADES_RING_MAX);
  optionTradesStore.updatedAt = Date.now();
  optionTradesStore.total_received += prints.length;
}

function pushLitTradeRows(prints: UwLitTradePrint[]) {
  if (!prints.length) return;
  litTradesStore.rows = [...prints, ...litTradesStore.rows].slice(0, LIT_TRADES_RING_MAX);
  litTradesStore.updatedAt = Date.now();
  litTradesStore.total_received += prints.length;
}

const TRADING_HALT_CHANNEL_MAX_AGE_MS = 120_000;

/**
 * Max age for a stored active halt before it is treated as resolved. A halt is
 * normally cleared by a resume event (active:false), but that event can be
 * dropped or missed across a reconnect — without an expiry the symbol would
 * stay "halted" (and block entries) forever. UW halts on watched symbols are
 * minutes-scale; 30m is a safe ceiling well past any real intraday halt.
 */
const TRADING_HALT_MAX_AGE_MS = 30 * 60_000;

/**
 * True when the UW trading_halts feed can NOT be trusted (so live entries should fail closed).
 *
 * trading_halts is an EVENT-ONLY channel: it delivers a message ONLY when a symbol actually
 * halts, so a perfectly healthy subscription is silent for entire no-halt sessions. Keying
 * staleness off its OWN last message (the old behavior) therefore flagged virtually EVERY normal
 * session "stale" and blocked all desk entries. The channel is genuinely untrustworthy only when
 * (a) there's no API key, (b) its subscription was rejected (auth_failed → we'd never SEE a halt),
 * or (c) the whole socket is dead — proxied by the freshest delivery across ALL channels, since
 * flow_alerts / market_tide stream constantly during RTH. A recent halt OR a live socket
 * with an accepted subscription ⇒ fresh.
 */
function isUwHaltSourceStale(maxAgeMs = TRADING_HALT_CHANNEL_MAX_AGE_MS): boolean {
  if (!UW_API_KEY) return true;
  if (isUwChannelFresh("trading_halts", maxAgeMs)) return false;
  if (uwSocket.getChannelHealth()?.trading_halts?.auth_failed) return true;
  const freshest = effectiveFreshestUwMessageAt();
  return freshest == null || Date.now() - freshest > maxAgeMs;
}

export function isTradingHaltChannelStale(maxAgeMs = TRADING_HALT_CHANNEL_MAX_AGE_MS): boolean {
  const uwStale = isUwHaltSourceStale(maxAgeMs);
  if (!luldWsEnabled()) return uwStale;
  const luldStale = isLuldHaltSourceStale(maxAgeMs);
  // Stale only when BOTH halt sources are unavailable (LULD de-risks UW SPOF).
  return uwStale && luldStale;
}

/** Check if any watched symbol has an active trading halt. */
export function hasActiveTradingHalt(symbols: readonly string[] = PLAY_HALT_WATCH_SYMBOLS): boolean {
  if (hasActiveLuldHalt(symbols)) return true;
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
  const luld = getActiveLuldHalts(symbols);
  pruneExpiredHalts(tradingHaltsStore.halts, Date.now(), TRADING_HALT_MAX_AGE_MS);
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  const uw = Array.from(tradingHaltsStore.halts.values()).filter((h) => watch.has(h.symbol) && h.active);
  return [...luld, ...uw];
}

const flowAlertDedup = makeFlowDedup();
const optionTradeDedup = makeFlowDedup();
let uwSocketInitialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// Reconcile cadence: pings + leadership re-check + stall watchdog. Must be < UW_LEADER_TTL_SEC so a
// standby acquires the lock within one tick of the leader dying.
const UW_RECONCILE_INTERVAL_MS = 15_000;
const lastMessageAt: Partial<Record<UwWsChannel, number>> = {};

/**
 * Freshest delivery across all subscribed channels. initUwSocket subscribes
 * every UW_WS_CHANNELS entry unconditionally, so ALL_CHANNELS == the
 * channels-with-handlers and is the correct active set here.
 */
function freshestUwMessageAt(): number | null {
  return freshestFromMap(lastMessageAt, ALL_CHANNELS);
}

/** Local + cluster (Redis) freshest delivery — standbys lack in-process WS timestamps. */
function effectiveFreshestUwMessageAt(): number | null {
  return mergeFreshestTimestamps(freshestUwMessageAt(), clusterFreshestAt);
}

function touchClusterFreshness(at: number): void {
  clusterFreshestAt = mergeFreshestTimestamps(clusterFreshestAt, at);
  if (!uwIsLeader) return;
  void getUwCacheRedis()
    .then((redis) =>
      redis?.setex(UW_CLUSTER_LAST_MSG_KEY, UW_CLUSTER_LAST_MSG_TTL_SEC, String(at))
    )
    .catch(() => undefined);
}

function recordUwDelivery(channel: UwWsChannel): void {
  const at = Date.now();
  lastMessageAt[channel] = at;
  touchClusterFreshness(at);
}

function startClusterFreshnessPoller(): void {
  if (clusterFreshnessPollerStarted) return;
  clusterFreshnessPollerStarted = true;
  const poll = () => {
    void getUwCacheRedis()
      .then(async (redis) => {
        if (!redis) return;
        const val = await redis.get(UW_CLUSTER_LAST_MSG_KEY);
        if (!val) return;
        const at = Number(val);
        if (Number.isFinite(at)) clusterFreshestAt = at;
      })
      .catch(() => undefined);
  };
  poll();
  const timer = setInterval(poll, 3_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function initUwSocket() {
  if (uwSocketInitialized) return;
  if (!UW_API_KEY) {
    console.warn("[uw-socket] UW_API_KEY not set — WebSocket disabled, falling back to REST polling");
    return;
  }
  uwSocketInitialized = true;
  startClusterFreshnessPoller();

  uwSocket.subscribe("flow_alerts", (payload) => {
    try {
      const block = Array.isArray(payload) ? payload : [payload];
      recordUwDelivery("flow_alerts");
      const now = Date.now();
      for (const raw of block) {
        if (!raw || typeof raw !== "object") continue;
        const rec = raw as Record<string, unknown>;
        const flow = parseUwFlowAlert(rec);
        // Premium pre-filter BEFORE persist: identical threshold/comparison to
        // persistAndPublishFlowAlert (flow.premium < MIN_PREMIUM => dropped there too),
        // so this only skips work persist would also reject. A NaN premium yields
        // false here (same as persist) and falls through to persist, the authority.
        if (flow.premium < FLOW_MIN_PREMIUM) continue;
        // Cheap in-process dedup keyed on the EXACT id used for DB ON-CONFLICT.
        // A hit here would be an ON-CONFLICT duplicate persist already suppresses,
        // so skipping it cannot drop a genuinely-distinct alert.
        if (flowAlertDedup.seen(computeFlowAlertId(rec, flow), now)) continue;
        void persistAndPublishFlowAlert(rec, flow);
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
      recordUwDelivery("market_tide");
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
      recordUwDelivery("off_lit_trades");
      darkPoolStore.data = normalized;
      darkPoolStore.updatedAt = Date.now();
    }
  });

  uwSocket.subscribe("interval_flow", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const rows = normalizeIntervalFlowWsPayload(payload);
    if (rows.length) {
      recordUwDelivery("interval_flow");
      const now = Date.now();
      const byTicker = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const sym = String(row.ticker ?? "SPX").toUpperCase();
        const bucket = byTicker.get(sym) ?? [];
        bucket.push(row);
        byTicker.set(sym, bucket);
      }
      for (const [sym, tickerRows] of byTicker) {
        intervalFlowByTicker.set(sym, { rows: tickerRows, updatedAt: now });
      }
      const spx = byTicker.get("SPX");
      intervalFlowStore.rows = spx ?? rows;
      intervalFlowStore.updatedAt = now;
    }
  });

  uwSocket.subscribe("trading_halts", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const events = normalizeTradingHaltsWsPayload(payload);
    if (!events.length) return;
    const now = Date.now();
    recordUwDelivery("trading_halts");
    for (const ev of events) {
      if (ev.active) {
        tradingHaltsStore.halts.set(ev.symbol, { ...ev, receivedAt: now });
      } else {
        tradingHaltsStore.halts.delete(ev.symbol);
      }
    }
    tradingHaltsStore.updatedAt = now;
  });

  uwSocket.subscribe("net_flow", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const ticker = String(r.ticker ?? r.symbol ?? "SPX").toUpperCase();
      if (!NET_FLOW_TICKERS.has(ticker)) continue;
      recordUwDelivery("net_flow");
      const call = Number(r.call_premium ?? r.calls ?? r.net_call_premium ?? 0);
      const put = Number(r.put_premium ?? r.puts ?? r.net_put_premium ?? 0);
      const net = Number(r.net ?? call - put);
      recordNetFlowForTicker(ticker, call, put, net);
    }
  });

  uwSocket.subscribe("option_trades", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const prints = normalizeOptionTradesWsPayload(payload).filter((p) => p.premium >= FLOW_MIN_PREMIUM);
    if (!prints.length) return;
    recordUwDelivery("option_trades");
    const now = Date.now();
    pushOptionTradeRows(prints);
    for (const print of prints) {
      const raw = optionTradePrintToFlowRaw(print);
      const flow = parseUwFlowAlert(raw);
      const id = computeFlowAlertId(raw, flow);
      if (optionTradeDedup.seen(id, now)) continue;
      void persistAndPublishFlowAlert(raw, flow);
    }
  });

  uwSocket.subscribe("lit_trades", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const prints = normalizeLitTradesWsPayload(payload);
    if (!prints.length) return;
    recordUwDelivery("lit_trades");
    pushLitTradeRows(prints);
  });

  uwSocket.subscribe("gex_strike_expiry", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const rows = normalizeGexStrikeExpiryWsPayload(payload);
    if (!rows.length) return;
    recordUwDelivery("gex_strike_expiry");
    upsertGexStrikeExpiryRows(rows);
  });

  startUwLeaderRefresh();

  // Leadership reconcile: only the cluster leader holds the UW socket. Run once immediately so the
  // leader starts streaming without waiting a full interval, then every UW_RECONCILE_INTERVAL_MS
  // (well within the 25s lock TTL, so a standby fails over within one tick if the leader dies).
  void runUwReconcileTick();
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      void runUwReconcileTick();
    }, UW_RECONCILE_INTERVAL_MS);
  }

  console.log(
    `[uw-socket] initialized — multiplex ${ALL_CHANNELS.join(", ")}`
  );
}

/**
 * One leadership-gated reconcile tick. The leader opens/maintains the multiplex socket, pings it,
 * and runs the stall watchdog. A standby stands down (releases any socket) and serves flow from
 * Postgres + the REST fallback until it wins the lock.
 */
async function runUwReconcileTick(): Promise<void> {
  const leader = await ensureUwLeadership();
  if (!leader) {
    uwSocket.standDown();
    return;
  }
  if (!shouldMaintainUwSocket()) {
    uwSocket.standDown();
    return;
  }
  uwSocket.ensureConnected();
  uwSocket.heartbeat();
  uwSocket.reconnectIfStalled(freshestUwMessageAt(), UW_SOCKET_STALL_MS);
}

/**
 * Graceful shutdown for the UW multiplex socket. Clears the heartbeat/stall
 * watchdog interval and closes the live multiplex connection (the manager sets
 * its own shutdown flag so it won't rejoin). Best-effort, idempotent, never
 * throws. Called on SIGTERM so the old container releases its UW slot at once.
 */
export function shutdownUwSocket(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  // Drop the cluster lead so a newly-booting replica can take over the UW socket immediately.
  releaseUwLead();
  uwSocket.shutdown();
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
      interval_flow_updated_at: intervalFlowStore.updatedAt || null,
      trading_halts_updated_at: tradingHaltsStore.updatedAt || null,
      net_flow_updated_at: netFlowStore.updatedAt || null,
      option_trades_updated_at: optionTradesStore.updatedAt || null,
      option_trades_buffered: optionTradesStore.rows.length,
      option_trades_total_received: optionTradesStore.total_received,
      lit_trades_updated_at: litTradesStore.updatedAt || null,
      lit_trades_buffered: litTradesStore.rows.length,
      lit_trades_total_received: litTradesStore.total_received,
      gex_strike_expiry_updated_at: gexStrikeExpiryByTicker.get("SPX")?.updatedAt || null,
      gex_strike_expiry_cells: gexStrikeExpiryByTicker.get("SPX")?.cells.size ?? 0,
      gex_strike_expiry_strikes: getGexStrikeExpiryLadder("SPX")?.ladder.size ?? 0,
      active_halts: Array.from(tradingHaltsStore.halts.values())
        .filter((h) => h.active)
        .map((h) => h.symbol),
    },
  };
}
