/**
 * Polygon/Massive WebSocket client for real-time index aggregates.
 */
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
export type PolygonAgg = {
  ev: "A" | "AM";
  sym: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  s: number;
  e: number;
};

const POLYGON_WS_INDICES = process.env.POLYGON_WS_INDICES ?? "wss://socket.massive.com/indices";
const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";

export const indexStore: Record<string, { price: number; change_pct: number; session_open: number; session_date: string; updatedAt: number }> = {
  "I:SPX": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:VIX": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:VIX9D": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:VIX3M": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:TICK": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:TRIN": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
  "I:ADD": { price: 0, change_pct: 0, session_open: 0, session_date: "", updatedAt: 0 },
};

function barDateET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

let indicesWs: WebSocket | null = null;
let indicesReconnectDelay = 1000;
let indicesAuthenticated = false;
let polygonSocketInitialized = false;
let indicesReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let indicesConsecutiveFailures = 0;

function polygonErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const evt = err as { message?: string; error?: unknown };
  if (typeof evt?.message === "string") return evt.message;
  if (evt?.error instanceof Error) return evt.error.message;
  return String(err);
}

function scheduleIndicesReconnect(reason: string) {
  if (indicesReconnectTimer) return;
  indicesConsecutiveFailures += 1;
  const base = Math.min(indicesReconnectDelay, 60_000);
  const jitter = Math.floor(Math.random() * 400);
  const delay = indicesConsecutiveFailures >= 8 ? 60_000 : base + jitter;
  console.warn(
    `[polygon-socket] indices reconnect in ${delay}ms (${reason}, failures=${indicesConsecutiveFailures})`
  );
  indicesReconnectTimer = setTimeout(() => {
    indicesReconnectTimer = null;
    connectIndices();
  }, delay);
  indicesReconnectDelay = Math.min(indicesReconnectDelay * 2, 60_000);
}

function connectIndices() {
  if (!POLYGON_API_KEY) {
    console.warn("[polygon-socket] POLYGON_API_KEY not set — WebSocket disabled");
    return;
  }
  if (
    indicesWs &&
    (indicesWs.readyState === WebSocket.OPEN || indicesWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    indicesWs = new WebSocket(POLYGON_WS_INDICES);

    indicesWs.onopen = () => {
      console.log("[polygon-socket] indices connected");
      indicesAuthenticated = false;
    };

    indicesWs.onmessage = (event) => {
      try {
        const msgs = JSON.parse(String(event.data)) as Array<Record<string, unknown>>;
        for (const msg of msgs) {
          const ev = msg.ev as string;

          if (ev === "connected" || (ev === "status" && msg.status === "connected")) {
            indicesWs?.send(JSON.stringify({ action: "auth", params: POLYGON_API_KEY }));
          } else if (ev === "auth_success" || (ev === "status" && msg.status === "auth_success")) {
            indicesAuthenticated = true;
            indicesReconnectDelay = 1000;
            indicesConsecutiveFailures = 0;
            console.log("[polygon-socket] indices authenticated — subscribing");
            indicesWs?.send(
              JSON.stringify({
                action: "subscribe",
                params: "A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M,A.I:TICK,A.I:TRIN,A.I:ADD",
              })
            );
          } else if (
            ev === "auth_failed" ||
            (ev === "status" && (msg.status === "auth_failed" || msg.status === "unauthorized"))
          ) {
            console.error("[polygon-socket] indices auth failed — check POLYGON_API_KEY");
          } else if (ev === "A" || ev === "AM") {
            const agg = msg as unknown as PolygonAgg;
            if (indexStore[agg.sym]) {
              // Keep the first open of the session as the baseline for day change_pct.
              // agg.o is the bar open; on the very first bar it approximates the session open.
              // On reconnect, preserve the existing session_open so the anchor is not reset to
              // the reconnect time. Reset only when a new trading day is detected (ET date change).
              const todayET = barDateET();
              const prev = indexStore[agg.sym];
              const isNewDay = prev.session_date && prev.session_date !== todayET;
              const sessionOpen = (!isNewDay && prev.session_open > 0) ? prev.session_open : agg.o;
              indexStore[agg.sym] = {
                price: agg.c,
                change_pct: sessionOpen > 0 ? ((agg.c - sessionOpen) / sessionOpen) * 100 : 0,
                session_open: sessionOpen,
                session_date: todayET,
                updatedAt: Date.now(),
              };
              void (async () => {
                try {
                  const redis = await getUwCacheRedis();
                  if (redis) {
                    await redis.setex("spx:pulse:snapshot", 30, JSON.stringify(indexStore));
                  }
                } catch { /* non-fatal — SSE falls back to local indexStore */ }
              })();
            }
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };

    indicesWs.onerror = (err) => {
      const msg = polygonErrorMessage(err);
      // Upstream 502/504 from Massive gateway — transient; reconnect handles it.
      console.warn(`[polygon-socket] indices error: ${msg}`);
    };

    indicesWs.onclose = (event) => {
      indicesWs = null;
      indicesAuthenticated = false;
      console.warn("[polygon-socket] indices disconnected — bar gap will occur until reconnection completes");
      scheduleIndicesReconnect(`code=${event.code}`);
    };
  } catch (err) {
    indicesWs = null;
    console.error("[polygon-socket] failed to connect indices:", polygonErrorMessage(err));
    scheduleIndicesReconnect("connect-threw");
  }
}

export function initPolygonSocket() {
  if (polygonSocketInitialized) return;
  polygonSocketInitialized = true;
  connectIndices();
  console.log("[polygon-socket] initialized");
}

export function getIndexStoreStatus() {
  return {
    authenticated: indicesAuthenticated,
    wsState: indicesWs ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][indicesWs.readyState] : "NOT_CREATED",
    consecutiveFailures: indicesConsecutiveFailures,
    reconnectDelayMs: indicesReconnectDelay,
    symbols: Object.keys(indexStore).map((sym) => ({
      sym,
      price: indexStore[sym].price,
      ageMs: Date.now() - indexStore[sym].updatedAt,
    })),
  };
}
