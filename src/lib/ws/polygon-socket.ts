/**
 * Polygon/Massive WebSocket client for real-time index aggregates.
 */
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";
import { getEarlyCloseMinutes } from "@/lib/spx-play-session-guards";
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
let indicesShuttingDown = false;

function polygonErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const evt = err as { message?: string; error?: unknown };
  if (typeof evt?.message === "string") return evt.message;
  if (evt?.error instanceof Error) return evt.error.message;
  return String(err);
}

function scheduleIndicesReconnect(reason: string) {
  if (indicesShuttingDown) return; // shutting down — do not resurrect the socket
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

// ── Half-open stall watchdog (audit 03-BACKEND §3.2) ────────────────────────────────────────
// A WebSocket can sit in readyState OPEN while the upstream silently stops delivering aggregates
// (TCP half-open, idle proxy, Massive gateway hiccup). With only an onclose reconnect, indexStore
// then freezes at its last value and serves stale SPX/VIX prices to every desk surface (incl. the
// pulse SSE) until the socket actually closes — which may never happen. Parity with uw-socket /
// options-socket's reconnectIfStalled.
// Audit gap #11: a silent TCP half-open can sit OPEN while the upstream stops delivering
// frames; with the old 90s window the desk showed a FROZEN SPX price as live for ~90-120s.
// The watchdog only ever runs during RTH (inIndicesMarketHours gates it), so a tight 25s
// stall window is safe — off-hours silence is already excluded and never churns the socket.
// Env-tunable so ops can widen it without a deploy if a venue ever runs naturally sparse.
const INDICES_STALL_MS = (() => {
  const raw = process.env.POLYGON_INDICES_STALL_SEC?.trim();
  const sec = raw ? Number(raw) : 25;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 25_000;
})();
let lastIndicesMessageAt = 0;
let indicesWatchdog: ReturnType<typeof setInterval> | null = null;

/**
 * RTH gate (DST-aware via etMinutes), weekdays only. The index feed is naturally SILENT off-hours
 * (no aggregates when the market is closed), so we only treat silence as a stall during regular
 * hours — reconnecting on off-hours quiet would just churn the socket all night (the same
 * false-positive class as the UW-halts feed). The upper bound honors NYSE early-close half-days
 * (13:00 ET) via getEarlyCloseMinutes — the same annually-maintained table the SPX session guards
 * use — so the watchdog doesn't churn the socket every ~90s from 13:00–16:00 on those days. (Full
 * market holidays are not modeled — a holiday reconnect loop is rarer and harmless: the market is
 * closed and no one is trading.)
 */
function inIndicesMarketHours(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = etMinutes(now);
  const close = getEarlyCloseMinutes(now) ?? etClock(16, 0); // 13:00 ET on half-days, else 16:00
  return mins >= etClock(9, 30) && mins <= close;
}

function startIndicesWatchdog() {
  if (indicesWatchdog) return;
  indicesWatchdog = setInterval(() => {
    if (indicesShuttingDown) return;
    if (!inIndicesMarketHours()) return; // off-hours silence is expected, not a stall
    if (
      indicesWs?.readyState === WebSocket.OPEN &&
      lastIndicesMessageAt > 0 &&
      Date.now() - lastIndicesMessageAt > INDICES_STALL_MS
    ) {
      console.warn(
        `[polygon-socket] indices feed STALLED — no frame in ${Math.round(
          (Date.now() - lastIndicesMessageAt) / 1000
        )}s, forcing reconnect`
      );
      lastIndicesMessageAt = 0; // avoid re-firing before the reconnect lands
      try {
        indicesWs.close(); // onclose → scheduleIndicesReconnect handles the actual reconnect
      } catch {
        /* ignore — onclose will still fire */
      }
    }
  }, 30_000);
  (indicesWatchdog as unknown as { unref?: () => void }).unref?.();
}

function connectIndices() {
  if (indicesShuttingDown) return; // shutting down — do not open a new socket
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
      lastIndicesMessageAt = Date.now(); // liveness for the stall watchdog — ANY frame counts
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
                // A = 1-second aggregate bars (OHLC) per index; V = TICK-LEVEL value (the index
                // value between bars — doc-verified ev:"V", T:ticker, val:value). V keeps the desk
                // price sub-second fresh and fills the gap on reconnect before the next A bar lands.
                params:
                  "A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M,A.I:TICK,A.I:TRIN,A.I:ADD," +
                  "V.I:SPX,V.I:VIX,V.I:VIX9D,V.I:VIX3M,V.I:TICK,V.I:TRIN,V.I:ADD",
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
          } else if (ev === "V") {
            // Indices Value channel — TICK-LEVEL value between the 1-second A bars (doc-verified
            // schema: { ev:"V", T:ticker, val:value, t:ts } — note the ticker field is `T`, not
            // `sym` like the aggregate channels). Refreshes the desk price + change_pct off the
            // EXISTING session anchor (the A channel OWNS session_open / session_date / new-day
            // reset; V never seeds them). Updates ONLY the local indexStore (the SSE pulse source);
            // it deliberately does NOT write the Redis snapshot per tick — the A handler writes the
            // ~1s cross-replica snapshot, so V can't hammer Redis at tick rate.
            const sym = typeof msg.T === "string" ? (msg.T as string) : "";
            const val = Number(msg.val);
            if (sym && indexStore[sym] && Number.isFinite(val) && val > 0) {
              const prev = indexStore[sym];
              indexStore[sym] = {
                ...prev,
                price: val,
                change_pct:
                  prev.session_open > 0
                    ? ((val - prev.session_open) / prev.session_open) * 100
                    : prev.change_pct,
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
  startIndicesWatchdog();
  console.log("[polygon-socket] initialized");
}

/**
 * Graceful shutdown for the indices socket. Sets the shutdown flag (so the
 * reconnect scheduler + connect path bail and cannot resurrect the socket),
 * clears the pending reconnect timer, and closes the live WS with a normal
 * close (1000) so the upstream releases this container's indices slot
 * immediately on SIGTERM. Idempotent and never throws.
 */
export function shutdownPolygonSocket(): void {
  indicesShuttingDown = true;
  if (indicesReconnectTimer) {
    clearTimeout(indicesReconnectTimer);
    indicesReconnectTimer = null;
  }
  if (indicesWatchdog) {
    clearInterval(indicesWatchdog);
    indicesWatchdog = null;
  }
  const ws = indicesWs;
  indicesWs = null;
  if (ws) {
    // Drop the close handler first so onclose can't schedule a reconnect.
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
    } catch {
      /* ignore */
    }
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "server shutdown");
      }
    } catch {
      /* best-effort — must not block shutdown */
    }
  }
}

/**
 * Threshold (ms) past which a live index tick is treated as a FROZEN feed rather than a
 * quiet tape, so the desk surfaces a "feed stalled" indicator and stops presenting the
 * price as live (audit gap #11). The index Value (V) channel ticks sub-second on an active
 * feed, so ~5s of total silence on I:SPX is already abnormal during RTH. Env-tunable.
 */
export const INDEX_FEED_STALL_MS = (() => {
  const raw = process.env.POLYGON_INDEX_FEED_STALL_SEC?.trim();
  const sec = raw ? Number(raw) : 5;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
})();

/**
 * Liveness of a single index symbol in the in-process store (default I:SPX). Returns the
 * tick age in ms and whether the feed is STALLED (age beyond INDEX_FEED_STALL_MS). `stalled`
 * is null when there has never been a tick (age unknown — the desk treats it as not-live via
 * its own price>0 / availability checks, never as a frozen-but-live price).
 */
export function getIndexFeedFreshness(
  sym = "I:SPX",
  now = Date.now()
): { ageMs: number | null; stalled: boolean | null; updatedAt: number } {
  const entry = indexStore[sym];
  const updatedAt = entry?.updatedAt ?? 0;
  if (!updatedAt) return { ageMs: null, stalled: null, updatedAt: 0 };
  const ageMs = Math.max(0, now - updatedAt);
  return { ageMs, stalled: ageMs > INDEX_FEED_STALL_MS, updatedAt };
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
