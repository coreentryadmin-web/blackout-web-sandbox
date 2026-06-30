/**
 * Massive stocks WebSocket — LULD halt/band feed (second halt source vs UW trading_halts).
 *
 * Env-gated via STOCKS_WS_ENABLED (mirror OPTIONS_WS_ENABLED). Subscribes to
 * LULD.{TICKER} on wss://socket.massive.com/stocks. SPY LULD halts proxy to
 * SPX/SPXW play gates via LULD_INDEX_PROXIES.
 */
import { MASSIVE_WS_STOCKS } from "@/lib/polygon-docs-nav";
import { normalizeLuldWsMessages } from "@/lib/providers/polygon-luld";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { inOptionsMarketHours } from "@/lib/ws/options-socket";
import { applyLuldHaltEvents, luldHaltsStore, touchLuldMessageAt } from "@/lib/ws/luld-halts-store";

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

const STOCKS_LEADER_KEY = "stocks:ws:leader";
const STOCKS_LEADER_TTL_SEC = 25;
let stocksIsLeader = false;
let stocksLeaderRefreshTimer: ReturnType<typeof setInterval> | null = null;

type IoredisLockExtra = {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
  expire(k: string, ttl: number): Promise<number>;
  del(k: string): Promise<number>;
};

async function tryAcquireStocksLead(): Promise<boolean> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return true;
    const r = redis as unknown as IoredisLockExtra;
    const result = await r.set(STOCKS_LEADER_KEY, "1", "EX", STOCKS_LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    return true;
  }
}

function startStocksLeaderRefresh(): void {
  if (stocksLeaderRefreshTimer) return;
  stocksLeaderRefreshTimer = setInterval(() => {
    if (!stocksIsLeader) return;
    getUwCacheRedis()
      .then((redis) => redis && (redis as unknown as IoredisLockExtra).expire(STOCKS_LEADER_KEY, STOCKS_LEADER_TTL_SEC))
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
    .then((redis) => redis && (redis as unknown as IoredisLockExtra).del(STOCKS_LEADER_KEY))
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
  const delay = Math.min(stocksReconnectDelay, 60_000);
  console.warn(`[stocks-socket] reconnect in ${delay}ms (${reason})`);
  stocksReconnectTimer = setTimeout(() => {
    stocksReconnectTimer = null;
    void connectStocks();
  }, delay);
  stocksReconnectDelay = Math.min(stocksReconnectDelay * 2, 60_000);
}

function startStocksWatchdog() {
  if (stocksWatchdog) return;
  stocksWatchdog = setInterval(() => {
    if (stocksShuttingDown || !shouldMaintainSocket()) return;
    const at = luldHaltsStore.last_message_at;
    if (stocksWs?.readyState === WebSocket.OPEN && at > 0 && Date.now() - at > STOCKS_STALL_MS) {
      console.warn("[stocks-socket] LULD feed stalled — forcing reconnect");
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
  if (stocksShuttingDown || !luldWsEnabled()) return;
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
            const tickers = parseLuldTickerCsv();
            const params = tickers.map((t) => `LULD.${t}`).join(",");
            console.log(`[stocks-socket] authenticated — subscribing ${params}`);
            stocksWs?.send(JSON.stringify({ action: "subscribe", params }));
          } else if (ev === "auth_failed") {
            console.error("[stocks-socket] auth failed");
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
  if (!luldWsEnabled()) return;
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
  if (!luldWsEnabled()) return;
  if (stocksInitialized) return;
  stocksInitialized = true;
  startStocksWatchdog();
  void connectStocks();
  if (!reconcileTimer) {
    reconcileTimer = setInterval(reconcileStocksSocket, 15_000);
    (reconcileTimer as unknown as { unref?: () => void }).unref?.();
  }
  console.log("[stocks-socket] initialized — LULD feed");
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
    enabled: luldWsEnabled(),
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
    tickers: parseLuldTickerCsv(),
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
