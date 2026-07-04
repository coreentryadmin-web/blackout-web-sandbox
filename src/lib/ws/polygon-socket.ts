/**
 * Polygon/Massive WebSocket client for real-time index aggregates.
 */
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";
import { isEtCashRth } from "@/lib/et-market-hours";
import {
  alertWsLeaderFailClosedOnce,
  clearWsLeaderFailClosedAlert,
  wsLeaderShouldFailOpenWithoutRedis,
} from "./leader-lock-shared";
import { newLockToken, releaseFencedLock, renewFencedLock, type FencedRedis } from "./leader-lock-fencing";
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

/**
 * `open_source` is the PROVENANCE of `session_open` (FIX-A):
 *  - "rest": anchored to the authoritative REST prevClose-derived true-session open (correct day
 *     change% on a mid-session cold start, e.g. a Railway deploy at 1pm).
 *  - "ws-bar": anchored to the first WS A-bar open we observed. Correct ONLY when the socket was
 *     up at/near 09:30; on a cold start mid-session it's the price AT BOOT, so change% is wrong.
 *  - "": never anchored yet.
 * spx-desk.mergeWsIndexSnapshots keeps the REST change_pct authoritative while a same-day anchor is
 * still "ws-bar" (un-reconciled), so a boot-time bar open never clobbers the true day change.
 */
type IndexStoreEntry = {
  price: number;
  change_pct: number;
  session_open: number;
  session_date: string;
  open_source: "rest" | "ws-bar" | "";
  updatedAt: number;
};

export const indexStore: Record<string, IndexStoreEntry> = {
  "I:SPX": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:VIX": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:VIX9D": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:VIX3M": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:TICK": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:TRIN": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
  "I:ADD": { price: 0, change_pct: 0, session_open: 0, session_date: "", open_source: "", updatedAt: 0 },
};

/** ET wall-clock minutes since midnight (DST-correct). Used to detect a mid-session cold start. */
function etMinutesNow(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * FIX-A: Seed `session_open` from the authoritative REST index snapshot so day change% is correct
 * the instant the socket connects — including a mid-session cold start where the first WS bar open
 * would otherwise (wrongly) anchor the day to the price AT BOOT.
 *
 * The REST snapshot returns the live price + the true session change_pct (vs the official prevClose
 * / 09:30 open), so the true session open is `price / (1 + change_pct/100)`. We seed ONLY when there
 * is no same-day REST anchor yet, and we mark open_source="rest" so the A-bar handler will NOT
 * overwrite it with a bar open. Fully best-effort: any failure leaves the WS path exactly as before.
 */
async function seedSessionOpenFromRest(): Promise<void> {
  try {
    const { fetchIndexSnapshots } = await import("@/lib/providers/polygon");
    const syms = Object.keys(indexStore);
    const snaps = await fetchIndexSnapshots(syms);
    const todayET = barDateET();
    for (const sym of syms) {
      const snap = snaps[sym];
      if (!snap || !(snap.price > 0)) continue;
      const prev = indexStore[sym];
      // Don't clobber a REST anchor already set today (a fresh, correct baseline).
      if (prev.open_source === "rest" && prev.session_date === todayET && prev.session_open > 0) {
        continue;
      }
      const changePct = Number.isFinite(snap.change_pct) ? snap.change_pct : 0;
      // true session open = price discounted by the day's % change (vs official prevClose / open).
      const sessionOpen = changePct !== 0 ? snap.price / (1 + changePct / 100) : snap.price;
      if (!(sessionOpen > 0)) continue;
      indexStore[sym] = {
        ...prev,
        // keep any live WS price we already have; otherwise seed the REST price so the desk isn't 0.
        price: prev.price > 0 && prev.session_date === todayET ? prev.price : snap.price,
        change_pct: changePct,
        session_open: sessionOpen,
        session_date: todayET,
        open_source: "rest",
        updatedAt: prev.updatedAt > 0 ? prev.updatedAt : Date.now(),
      };
    }
  } catch {
    /* best-effort — WS bar-open anchoring still applies, exactly as before this seed */
  }
}

function barDateET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ── Cross-replica leader election ──────────────────────────────────────────────────────────────
// Massive allows at most 1 live WebSocket per API key. When the cluster scales to N replicas each
// would otherwise open its own connection; the 2nd–Nth get rejected with code 1008 and churn
// reconnect loops. We use a Redis SETNX lock (polygon:indices:leader, 25s TTL) so only ONE
// replica opens the WS. Non-leaders skip connectIndices() and read `spx:pulse:snapshot` from
// Redis instead — the pulse SSE already has that Redis fallback (stream/route.ts lines 34-47).
// If the leader dies (SIGTERM → code 1000 → slot released), the lock expires in 25s and the
// next replica that calls connectIndices() wins the lock and opens the WS.
const INDICES_LEADER_KEY = "polygon:indices:leader";
const INDICES_LEADER_TTL_SEC = 25;
let indicesIsLeader = false;
let indicesLeaderRefreshTimer: ReturnType<typeof setInterval> | null = null;

// Minimal ioredis methods we need beyond the narrow RedisClient type in uw-shared-cache.
type IoredisExtra = FencedRedis & { set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null> };

// Random per-process identity for this lock — see leader-lock-fencing.ts for why a plain SETNX
// with unconditional EXPIRE/DEL renewal can split-brain across two replicas.
const INDICES_LOCK_TOKEN = newLockToken();

async function tryAcquireIndicesLead(): Promise<boolean> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) {
      if (!wsLeaderShouldFailOpenWithoutRedis()) {
        alertWsLeaderFailClosedOnce("polygon-socket");
        return false; // multi-replica, Redis down — fail closed to avoid N-way WS contention
      }
      return true; // single replica — safe to fail open, no contention possible
    }
    clearWsLeaderFailClosedAlert("polygon-socket");
    const r = redis as unknown as IoredisExtra;
    const result = await r.set(INDICES_LEADER_KEY, INDICES_LOCK_TOKEN, "EX", INDICES_LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    if (!wsLeaderShouldFailOpenWithoutRedis()) {
      alertWsLeaderFailClosedOnce("polygon-socket");
      return false;
    }
    return true; // single replica — safe to fail open even on a Redis error
  }
}

function startIndicesLeaderRefresh(): void {
  if (indicesLeaderRefreshTimer) return;
  // Refresh every 10s — well within the 25s TTL — to keep leadership alive as long as
  // this replica is the WS holder. Cleared in shutdownPolygonSocket.
  indicesLeaderRefreshTimer = setInterval(() => {
    if (indicesShuttingDown || !indicesIsLeader) return;
    getUwCacheRedis()
      .then(async (redis) => {
        if (!redis) return;
        const stillMine = await renewFencedLock(redis as unknown as IoredisExtra, INDICES_LEADER_KEY, INDICES_LOCK_TOKEN, INDICES_LEADER_TTL_SEC);
        if (!stillMine) {
          // Lost the lock to another replica (stalled past the TTL) — close our now-illegitimate
          // socket instead of continuing to hold two live connections cluster-wide. onclose's
          // scheduleIndicesReconnect will re-check tryAcquireIndicesLead before opening anything.
          console.warn("[polygon-socket] lost indices cluster lead to another replica (stalled past TTL) — standing down");
          indicesIsLeader = false;
          try {
            indicesWs?.close();
          } catch {
            /* ignore — onclose will still fire */
          }
        }
      })
      .catch(() => undefined);
  }, 10_000);
  (indicesLeaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
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
    void connectIndices();
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
  return isEtCashRth(now);
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

async function connectIndices() {
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

  // Leader election: only ONE replica in the cluster opens the WS (see comment above).
  // On reconnect attempts we must already be the leader (indicesIsLeader) or win the lock.
  if (!indicesIsLeader) {
    const won = await tryAcquireIndicesLead();
    if (!won) {
      console.log("[polygon-socket] not leader — skipping WS (reading Redis snapshot)");
      return;
    }
    indicesIsLeader = true;
    startIndicesLeaderRefresh();
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
            // FIX-A: on every (re)connect, seed session_open from the authoritative REST snapshot so
            // day change% is correct immediately — including a mid-session cold start where the first
            // WS bar open would otherwise anchor the day to the price AT BOOT (wrong on any deploy
            // after ~09:31 ET). Only matters once the session has opened; before the open the bar
            // open IS the session open, so we skip the REST round-trip. Best-effort & non-blocking.
            if (etMinutesNow() >= etClock(9, 31)) {
              void seedSessionOpenFromRest();
            }
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
              const isNewDay = Boolean(prev.session_date && prev.session_date !== todayET);
              // FIX-A: prefer an existing SAME-DAY anchor (REST seed or an earlier bar). Only fall to
              // this bar's open when we have no anchor yet for today. A REST anchor is authoritative
              // and its provenance is preserved; a brand-new anchor sourced from a bar open is marked
              // "ws-bar". On a NEW day, the first bar legitimately re-anchors the session.
              const haveSameDayAnchor = !isNewDay && prev.session_open > 0;
              const sessionOpen = haveSameDayAnchor ? prev.session_open : agg.o;
              const openSource: IndexStoreEntry["open_source"] = haveSameDayAnchor
                ? prev.open_source || "ws-bar"
                : "ws-bar";
              indexStore[agg.sym] = {
                price: agg.c,
                change_pct: sessionOpen > 0 ? ((agg.c - sessionOpen) / sessionOpen) * 100 : 0,
                session_open: sessionOpen,
                session_date: todayET,
                open_source: openSource,
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
            // I:TICK and I:ADD are breadth indices — values can be negative. Other V-channel
            // symbols (SPX, VIX, …) must stay strictly positive price updates.
            const breadthIndex = sym === "I:TICK" || sym === "I:ADD";
            if (
              sym &&
              indexStore[sym] &&
              Number.isFinite(val) &&
              (breadthIndex ? true : val > 0)
            ) {
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
  void connectIndices();
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
  if (indicesLeaderRefreshTimer) {
    clearInterval(indicesLeaderRefreshTimer);
    indicesLeaderRefreshTimer = null;
  }
  // Release the leader slot immediately so a newly booting replica can win it
  // without waiting out the 25s TTL. Best-effort — the TTL handles it if this throws.
  if (indicesIsLeader) {
    indicesIsLeader = false;
    getUwCacheRedis()
      .then((redis) => redis && releaseFencedLock(redis as unknown as IoredisExtra, INDICES_LEADER_KEY, INDICES_LOCK_TOKEN))
      .catch(() => undefined);
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
      // null when the symbol has never ticked — Date.now() - 0 would report the epoch
      // (~56 years) as an "age" in the admin/health status endpoints. Mirrors the
      // never-ticked guard in getIndexFeedFreshness above.
      ageMs: indexStore[sym].updatedAt > 0 ? Date.now() - indexStore[sym].updatedAt : null,
    })),
  };
}
