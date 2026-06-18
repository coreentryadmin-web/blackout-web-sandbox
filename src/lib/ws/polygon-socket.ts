/**
 * Polygon/Massive WebSocket client for real-time index aggregates.
 */
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

export const indexStore: Record<string, { price: number; change_pct: number; session_open: number; updatedAt: number }> = {
  "I:SPX": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:VIX": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:VIX9D": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:VIX3M": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:TICK": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:TRIN": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
  "I:ADD": { price: 0, change_pct: 0, session_open: 0, updatedAt: 0 },
};

let indicesWs: WebSocket | null = null;
let indicesReconnectDelay = 1000;
let indicesAuthenticated = false;
let polygonSocketInitialized = false;

function connectIndices() {
  if (!POLYGON_API_KEY) {
    console.warn("[polygon-socket] POLYGON_API_KEY not set — WebSocket disabled");
    return;
  }

  try {
    indicesWs = new WebSocket(POLYGON_WS_INDICES);

    indicesWs.onopen = () => {
      console.log("[polygon-socket] indices connected");
      indicesReconnectDelay = 1000;
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
              const prevOpen = indexStore[agg.sym].session_open;
              const sessionOpen = prevOpen > 0 ? prevOpen : agg.o;
              indexStore[agg.sym] = {
                price: agg.c,
                change_pct: sessionOpen > 0 ? ((agg.c - sessionOpen) / sessionOpen) * 100 : 0,
                session_open: sessionOpen,
                updatedAt: Date.now(),
              };
            }
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };

    indicesWs.onerror = (err) => {
      console.error("[polygon-socket] indices error:", err);
    };

    indicesWs.onclose = (event) => {
      console.warn(
        `[polygon-socket] indices closed (code=${event.code}) — reconnecting in ${indicesReconnectDelay}ms`
      );
      indicesAuthenticated = false;
      setTimeout(() => connectIndices(), indicesReconnectDelay);
      indicesReconnectDelay = Math.min(indicesReconnectDelay * 2, 30_000);
    };
  } catch (err) {
    console.error("[polygon-socket] failed to connect indices:", err);
    setTimeout(() => connectIndices(), indicesReconnectDelay);
    indicesReconnectDelay = Math.min(indicesReconnectDelay * 2, 30_000);
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
    symbols: Object.keys(indexStore).map((sym) => ({
      sym,
      price: indexStore[sym].price,
      ageMs: Date.now() - indexStore[sym].updatedAt,
    })),
  };
}
