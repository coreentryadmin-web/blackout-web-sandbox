/**
 * Massive stocks WebSocket — real-time stock aggregates + LULD halt/band feed.
 *
 * ALWAYS connects for stock price aggregates (A.{TICKER}) — this is how Vector
 * gets sub-second spot updates for every non-index ticker. LULD subscriptions
 * (LULD.{TICKER}) are additionally enabled via STOCKS_WS_ENABLED.
 */
import { MASSIVE_WS_STOCKS } from "@/lib/polygon-docs-nav";
import { normalizeLuldWsMessages } from "@/lib/providers/polygon-luld";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { inOptionsMarketHours } from "@/lib/ws/options-socket";
import { applyLuldHaltEvents, luldHaltsStore, touchLuldMessageAt } from "@/lib/ws/luld-halts-store";
import {
  alertWsLeaderFailClosedOnce,
  clearWsLeaderFailClosedAlert,
  wsLeaderShouldFailOpenWithoutRedis,
} from "@/lib/ws/leader-lock-shared";
import { newLockToken, releaseFencedLock, renewFencedLock, type FencedRedis } from "@/lib/ws/leader-lock-fencing";
import { recordStockTick } from "@/lib/ws/stock-candle-store";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { isVectorIndexTicker } from "@/features/vector/lib/vector-ticker";

const STOCKS_WS_URL = process.env.STOCKS_WS_URL ?? MASSIVE_WS_STOCKS;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";

export function luldWsEnabled(): boolean {
  const flag = (process.env.STOCKS_WS_ENABLED ?? process.env.LULD_WS_ENABLED ?? "").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  return on && Boolean(POLYGON_API_KEY);
}

function parseLuldTickerCsv(): string[] {
  const raw = (process.env.LULD_WS_TICKERS ?? "SPY").split(",");
  return [...new Set(raw.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

/** Stock (non-index) tickers from the Vector universe that need WS aggregate subs. */
function stockAggregateTickers(): string[] {
  return vectorUniverseTickers().filter((t) => !isVectorIndexTicker(t));
}

const STOCKS_LEADER_KEY = "stocks:ws:leader";
const STOCKS_LEADER_TTL_SEC = 25;
let stocksIsLeader = false;
let stocksLeaderRefreshTimer: ReturnType<typeof setInterval> | null = null;

type IoredisLockExtra = FencedRedis & {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
};

// Random per-process identity for this lock — see leader-lock-fencing.ts for why a plain SETNX
// with unconditional EXPIRE/DEL renewal can split-brain across two replicas.
const STOCKS_LOCK_TOKEN = newLockToken();

async function tryAcquireStocksLead(): Promise<boolean> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) {
      if (!wsLeaderShouldFailOpenWithoutRedis()) {
        alertWsLeaderFailClosedOnce("stocks-socket");
        return false; // multi-replica, Redis down — fail closed to avoid N-way WS contention
      }
      return true; // single replica — safe to fail open, no contention possible
    }
    clearWsLeaderFailClosedAlert("stocks-socket");
    const r = redis as unknown as IoredisLockExtra;
    const result = await r.set(STOCKS_LEADER_KEY, STOCKS_LOCK_TOKEN, "EX", STOCKS_LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    if (!wsLeaderShouldFailOpenWithoutRedis()) {
      alertWsLeaderFailClosedOnce("stocks-socket");
      return false;
    }
    return true; // single replica — safe to fail open even on a Redis error
  }
}

function startStocksLeaderRefresh(): void {
  if (stocksLeaderRefreshTimer) return;
  stocksLeaderRefreshTimer = setInterval(() => {
    if (!stocksIsLeader) return;
    getUwCacheRedis()
      .then(async (redis) => {
        if (!redis) return;
        const stillMine = await renewFencedLock(redis as unknown as IoredisLockExtra, STOCKS_LEADER_KEY, STOCKS_LOCK_TOKEN, STOCKS_LEADER_TTL_SEC);
        if (!stillMine) {
          // Another replica already won this lock (we stalled past the TTL) — stand down instead
          // of re-arming a lease we no longer hold. The 15s reconcile tick closes our socket next.
          console.warn("[stocks-socket] lost cluster lead to another replica (stalled past TTL) — standing down");
          stocksIsLeader = false;
        }
      })
      .catch(() => undefined);
  }, 10_000);
  (stocksLeaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

function releaseStocksLead(): void {
  stocksIsLeader = false;
  if (stocksLeaderRefreshTimer) {
    clearInterval(stocksLeaderRefreshTimer);
    stocksLeaderRefreshTimer = null;
  }
  getUwCacheRedis()
    .then((redis) => redis && releaseFencedLock(redis as unknown as IoredisLockExtra, STOCKS_LEADER_KEY, STOCKS_LOCK_TOKEN))
    .catch(() => undefined);
}

function offHoursReconnectForced(): boolean {
  const f = (process.env.STOCKS_WS_OFFHOURS_RECONNECT ?? "").trim().toLowerCase();
  return f === "1" || f === "true" || f === "yes" || f === "on";
}

function shouldMaintainSocket(now = new Date()): boolean {
  if (!stocksIsLeader) return false;
  return offHoursReconnectForced() || inOptionsMarketHours(now);
}

let stocksWs: WebSocket | null = null;
let stocksReconnectDelay = 1000;
let stocksAuthenticated = false;
let stocksInitialized = false;
let stocksReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stocksShuttingDown = false;
let stocksWatchdog: ReturnType<typeof setInterval> | null = null;

const STOCKS_STALL_MS = (() => {
  const raw = process.env.STOCKS_WS_STALL_SEC?.trim();
  const sec = raw ? Number(raw) : 60;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 60_000;
})();

function scheduleStocksReconnect(reason: string) {
  if (stocksShuttingDown || stocksReconnectTimer) return;
  // Jitter (matches polygon-socket.ts/options-socket.ts) so a shared upstream blip that drops
  // every replica's socket at once doesn't have them all retry in lockstep.
  const jitter = Math.floor(Math.random() * 400);
  const delay = Math.min(stocksReconnectDelay, 60_000) + jitter;
  console.warn(`[stocks-socket] reconnect in ${delay}ms (${reason})`);
  stocksReconnectTimer = setTimeout(() => {
    stocksReconnectTimer = null;
    void connectStocks();
  }, delay);
  stocksReconnectDelay = Math.min(stocksReconnectDelay * 2, 60_000);
}

let lastStocksMessageAt = 0;

function startStocksWatchdog() {
  if (stocksWatchdog) return;
  stocksWatchdog = setInterval(() => {
    if (stocksShuttingDown || !shouldMaintainSocket()) return;
    // Stall detection: use the most recent of ANY message (agg or LULD)
    const at = Math.max(lastStocksMessageAt, luldHaltsStore.last_message_at);
    if (stocksWs?.readyState === WebSocket.OPEN && at > 0 && Date.now() - at > STOCKS_STALL_MS) {
      console.warn("[stocks-socket] feed stalled — forcing reconnect");
      lastStocksMessageAt = 0;
      touchLuldMessageAt(0);
      try {
        stocksWs.close();
      } catch {
        /* ignore */
      }
    }
  }, 30_000);
  (stocksWatchdog as unknown as { unref?: () => void }).unref?.();
}

async function connectStocks() {
  if (stocksShuttingDown) return;
  if (!POLYGON_API_KEY) return;
  if (stocksWs && (stocksWs.readyState === WebSocket.OPEN || stocksWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!stocksIsLeader) {
    const won = await tryAcquireStocksLead();
    if (!won) return;
    stocksIsLeader = true;
    startStocksLeaderRefresh();
    console.log("[stocks-socket] acquired cluster lead");
  }
  if (!shouldMaintainSocket()) return;

  try {
    stocksWs = new WebSocket(STOCKS_WS_URL);
    stocksWs.onopen = () => {
      console.log("[stocks-socket] connected");
      stocksAuthenticated = false;
    };
    stocksWs.onmessage = (event) => {
      try {
        const msgs = JSON.parse(String(event.data)) as Array<Record<string, unknown>>;
        for (const msg of msgs) {
          const ev = String(msg.ev ?? "");
          if (ev === "connected" || (ev === "status" && msg.status === "connected")) {
            stocksWs?.send(JSON.stringify({ action: "auth", params: POLYGON_API_KEY }));
          } else if (ev === "auth_success" || (ev === "status" && msg.status === "auth_success")) {
            stocksAuthenticated = true;
            stocksReconnectDelay = 1000;
            // Always subscribe to stock aggregates for real-time spot prices
            const aggTickers = stockAggregateTickers();
            const aggParams = aggTickers.map((t) => `A.${t}`).join(",");
            // Optionally subscribe to LULD if enabled
            const luldParams = luldWsEnabled()
              ? parseLuldTickerCsv().map((t) => `LULD.${t}`).join(",")
              : "";
            const params = [aggParams, luldParams].filter(Boolean).join(",");
            console.log(`[stocks-socket] authenticated — subscribing ${aggTickers.length} agg + ${luldParams ? "LULD" : "no LULD"}`);
            stocksWs?.send(JSON.stringify({ action: "subscribe", params }));
          } else if (ev === "auth_failed") {
            console.error("[stocks-socket] auth failed");
          } else if (ev === "A" || ev === "AM") {
            lastStocksMessageAt = Date.now();
            const sym = String(msg.sym ?? "");
            const close = Number(msg.c);
            const vol = msg.v != null ? Number(msg.v) : undefined;
            if (sym && Number.isFinite(close) && close > 0) {
              recordStockTick(sym, close, vol);
            }
          } else if (ev === "LULD") {
            touchLuldMessageAt();
            const events = normalizeLuldWsMessages([msg]);
            applyLuldHaltEvents(events);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };
    stocksWs.onclose = () => {
      stocksWs = null;
      stocksAuthenticated = false;
      if (!stocksShuttingDown && shouldMaintainSocket()) {
        scheduleStocksReconnect("closed");
      }
    };
    stocksWs.onerror = () => {
      scheduleStocksReconnect("error");
    };
  } catch (err) {
    console.warn("[stocks-socket] connect failed:", err instanceof Error ? err.message : String(err));
    scheduleStocksReconnect("connect-throw");
  }
}

function reconcileStocksSocket() {
  if (!shouldMaintainSocket()) {
    if (stocksWs) {
      try {
        stocksWs.close();
      } catch {
        /* ignore */
      }
      stocksWs = null;
    }
    return;
  }
  void connectStocks();
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function initStocksSocket(): void {
  if (!POLYGON_API_KEY) return;
  if (stocksInitialized) return;
  stocksInitialized = true;
  startStocksWatchdog();
  void connectStocks();
  if (!reconcileTimer) {
    reconcileTimer = setInterval(reconcileStocksSocket, 15_000);
    (reconcileTimer as unknown as { unref?: () => void }).unref?.();
  }
  const aggCount = stockAggregateTickers().length;
  console.log(`[stocks-socket] initialized — ${aggCount} agg tickers${luldWsEnabled() ? " + LULD" : ""}`);
}

export function shutdownStocksSocket(): void {
  stocksShuttingDown = true;
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  if (stocksWatchdog) {
    clearInterval(stocksWatchdog);
    stocksWatchdog = null;
  }
  releaseStocksLead();
  if (stocksReconnectTimer) {
    clearTimeout(stocksReconnectTimer);
    stocksReconnectTimer = null;
  }
  if (stocksWs) {
    try {
      stocksWs.close();
    } catch {
      /* ignore */
    }
    stocksWs = null;
  }
}

export function getStocksSocketStatus() {
  return {
    enabled: true,
    luld_enabled: luldWsEnabled(),
    initialized: stocksInitialized,
    is_leader: stocksIsLeader,
    ws_state:
      stocksWs == null
        ? "idle"
        : stocksWs.readyState === WebSocket.OPEN
          ? "open"
          : stocksWs.readyState === WebSocket.CONNECTING
            ? "connecting"
            : "closed",
    authenticated: stocksAuthenticated,
    agg_tickers: stockAggregateTickers(),
    luld_tickers: luldWsEnabled() ? parseLuldTickerCsv() : [],
    last_agg_message_at: lastStocksMessageAt || null,
    luld_updated_at: luldHaltsStore.updatedAt || null,
    luld_last_message_at: luldHaltsStore.last_message_at || null,
    active_luld_halts: [...luldHaltsStore.halts.keys()],
  };
}

/** False when the LULD socket is authenticated+open (quiet sessions are OK). */
export function isLuldHaltSourceStale(maxAgeMs: number): boolean {
  if (!luldWsEnabled()) return true;
  if (stocksAuthenticated && stocksWs?.readyState === WebSocket.OPEN) return false;
  const at = luldHaltsStore.last_message_at;
  return at <= 0 || Date.now() - at > maxAgeMs;
}

export { hasActiveLuldHalt, getActiveLuldHalts } from "@/lib/ws/luld-halts-store";
