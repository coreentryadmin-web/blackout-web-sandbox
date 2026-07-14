// 0DTE Command LIVE MARKS LANE (B-9) — the bounded ~1s quote path for OPEN plays.
//
// WHY THIS EXISTS (see docs/audit/ZERODTE-DATA-PATH-AUDIT.md): the board's open-trade
// numbers used to reach members through a 3-layer poll — REST unified snapshot →
// zerodte:board:v1 5s cache (stale-while-revalidate: a poll gets the PREVIOUS build) →
// 10s client SWR — so a mark was typically 10–25s old, and silently up to ~2 min old
// (the last cron write) whenever the snapshot fetch tripped its 2.5s soft deadline.
// 0DTE premium moves 10–30%/minute near gamma, so "stale" reads as "wrong".
//
// This lane covers ONLY the ACTIVE contracts (open ledger plays, hard-capped at
// ZERODTE_LIVE_CONTRACT_CAP) and pushes {bid, ask, mid, last, mark, source, asOf}
// per contract at ~1s over SSE, with a REST poll fallback. The full-chain/board
// snapshot cadence is deliberately untouched — it's the open-trade numbers that
// must be ~1s, not the whole chain.
//
// MARK SOURCE (two-tier, honest about which one served):
//  1. The app-wide options WebSocket store (src/lib/ws/options-socket.ts) when
//     OPTIONS_WS_ENABLED is on — this lane subscribes the active OCCs into the
//     existing leader-elected pool (idempotent, capacity-capped; the pool's own
//     user_positions reconciler never unsubscribes symbols it didn't add itself —
//     its set-diff runs against its own lastDesired only), and getLiveOptionMark
//     serves ticks cross-replica via the nw:optmark: Redis write-through.
//  2. A tight REST poller as the guarantee lane: ONE batched unified-snapshot call
//     per second for the ≤CAP contracts that have no fresh WS tick (≤16 OCCs is a
//     single /v3/snapshot call through the rate-limited Polygon funnel). When the
//     WS lane is streaming, the REST lane goes quiet on its own.
//
// CORRECTNESS RULES: all of the number math (mid-is-the-mark, flagged last-trade
// fallback, pinned-entry P&L, staleness, stop-pin, the peak/trough latch) lives in
// the pure leaf src/lib/zerodte/marks-math.ts — imported here AND by
// zerodte-service, so display, push, and grading inputs share one derivation.
// The ledger's own status/peak/trough refresh sources from THIS store (the
// poller's persist pass below), so intraday state and the displayed numbers can
// never come from two different quote lanes.

import { dbConfigured, fetchZeroDteSetupLog, updateZeroDteLiveState, type ZeroDteSetupLogRow } from "@/lib/db";
import { etNowParts, todayEt } from "@/features/nighthawk/lib/session";
import { isEtCashRth } from "@/lib/et-market-hours";
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMark, subscribeContracts, unsubscribeContracts } from "@/lib/ws/options-socket";
import {
  advancePlayLatch,
  isZeroDteMarkStale,
  pinnedLivePnlPct,
  resolveZeroDteMark,
  zeroDteMidOf,
  ZERODTE_LIVE_CONTRACT_CAP,
  type PlayLatch,
  type ZeroDteMarkSource,
} from "./marks-math";
import type { PlayStatus } from "./plan";

export {
  ZERODTE_LIVE_CONTRACT_CAP,
  ZERODTE_MARK_STALE_MS,
  isZeroDteMarkStale,
  pinnedLivePnlPct,
  resolveZeroDteMark,
  type ZeroDteMarkSource,
} from "./marks-math";

// ---------------------------------------------------------------------------
// Cadence constants
// ---------------------------------------------------------------------------

/** Poller tick — one batched REST call per tick for WS-miss contracts. */
const POLL_TICK_MS = 1_000;

/** How long a WS-lane tick counts as "fresh enough" to skip the REST fill-in (ms).
 *  2.5s = 2–3 ticks of slack so a briefly-quiet-but-streaming contract doesn't
 *  double-fetch, while anything older gets re-quoted within one tick. */
const WS_FRESH_MS = 2_500;

/** Active-set (ledger) refresh cadence — entry premiums are PINNED at flag so 10s
 *  is purely about discovering newly-flagged / newly-closed plays. */
const ACTIVE_SET_TTL_MS = 10_000;

/** Per-row DB persist heartbeat: status changes persist immediately; otherwise the
 *  latched peak/trough/last_mark land at most this often (≤16 rows → trivial). */
const PERSIST_HEARTBEAT_MS = 10_000;

/** A store mark older than this is not usable even for the status latch (ms). */
const LATCH_MAX_MARK_AGE_MS = 30_000;

/** Shared payload memo so N SSE subscribers share ONE build per ~tick. */
const PAYLOAD_MEMO_MS = 900;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZeroDteLiveMark = {
  occ: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  /** The display mark: mid when a two-sided quote exists, else last (flagged). */
  mark: number | null;
  source: ZeroDteMarkSource;
  /** Epoch ms this quote was observed (WS tick time or REST fetch time). */
  asOf: number;
  /** Which lane produced it — surfaced for honesty/debugging, never for math. */
  lane: "ws" | "rest";
};

/** One open play in the live lane — the pinned identity + the pinned entry. */
export type ActiveZeroDtePlay = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  strike: number | null;
  occ: string;
  /** PINNED at first flag (ledger row) — the ONLY entry reference P&L may use. */
  entry_premium: number | null;
  status: string | null;
  peak_premium: number | null;
  trough_premium: number | null;
};

export type ZeroDteLiveMarkRow = {
  ticker: string;
  occ: string;
  direction: "long" | "short";
  strike: number | null;
  status: string | null;
  /** Pinned entry premium from the ledger row (see ActiveZeroDtePlay). */
  entry_premium: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  mark: number | null;
  source: ZeroDteMarkSource;
  /** ISO instant of the quote itself — NOT the payload build time. */
  mark_as_of: string | null;
  /** Quote age at build time (ms) — convenience for clients without clock skew. */
  mark_age_ms: number | null;
  stale: boolean;
  /** (mark − entry)/entry via pinnedLivePnlPct — the ONE P&L derivation. */
  live_pnl_pct: number | null;
};

export type ZeroDteLiveMarksPayload = {
  available: boolean;
  as_of: string;
  session_date: string;
  /** True when the live lane has nothing to track (no open plays). */
  idle: boolean;
  cap: number;
  marks: ZeroDteLiveMarkRow[];
};

// ---------------------------------------------------------------------------
// Active-set derivation (pure parts exported for tests)
// ---------------------------------------------------------------------------

/** Extract the live-lane view of a ledger row; null when it can't be tracked
 *  (CLOSED = frozen by design; no plan OCC = nothing to quote). */
export function toActivePlay(r: ZeroDteSetupLogRow): ActiveZeroDtePlay | null {
  if (r.status === "CLOSED") return null;
  const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
  if (!occ) return null;
  return {
    session_date: r.session_date,
    ticker: r.ticker,
    direction: r.direction,
    strike: r.top_strike,
    occ,
    entry_premium: r.entry_premium,
    status: r.status,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
  };
}

/** Bound the tracked set: ledger order (score_max DESC from the fetch) capped hard. */
export function boundActivePlays(
  rows: ZeroDteSetupLogRow[],
  cap = ZERODTE_LIVE_CONTRACT_CAP
): ActiveZeroDtePlay[] {
  const out: ActiveZeroDtePlay[] = [];
  for (const r of rows) {
    const p = toActivePlay(r);
    if (!p) continue;
    out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The in-memory mark store (per replica; WS lane is cross-replica via Redis)
// ---------------------------------------------------------------------------

const markStore = new Map<string, ZeroDteLiveMark>();

/** Read one contract's live mark (undefined = never quoted this process). */
export function getZeroDteLiveMark(occ: string): ZeroDteLiveMark | undefined {
  return markStore.get(occ);
}

/** Write a mark into the store — newest asOf wins (never regress a fresher tick). */
export function putZeroDteLiveMark(m: ZeroDteLiveMark): void {
  const prev = markStore.get(m.occ);
  if (prev && prev.asOf > m.asOf) return;
  markStore.set(m.occ, m);
}

function markFromSnapshot(occ: string, snap: OptionSnapshot, asOf: number): ZeroDteLiveMark {
  const { mark, source } = resolveZeroDteMark(snap.bid, snap.ask, snap.last);
  return {
    occ,
    bid: snap.bid,
    ask: snap.ask,
    mid: zeroDteMidOf(snap.bid, snap.ask),
    last: snap.last,
    mark,
    source,
    asOf,
    lane: "rest",
  };
}

// ---------------------------------------------------------------------------
// Active-set cache (10s) — which contracts the lane tracks
// ---------------------------------------------------------------------------

let activeCache: { plays: ActiveZeroDtePlay[]; fetchedAt: number } | null = null;
let activeInflight: Promise<ActiveZeroDtePlay[]> | null = null;

async function getActivePlays(now = Date.now()): Promise<ActiveZeroDtePlay[]> {
  if (activeCache && now - activeCache.fetchedAt <= ACTIVE_SET_TTL_MS) return activeCache.plays;
  if (activeInflight) return activeInflight;
  activeInflight = (async () => {
    try {
      if (!dbConfigured()) return [];
      const rows = await fetchZeroDteSetupLog(todayEt());
      const plays = boundActivePlays(rows);
      activeCache = { plays, fetchedAt: Date.now() };
      return plays;
    } catch {
      // DB hiccup: keep serving the previous set rather than dropping the lane.
      return activeCache?.plays ?? [];
    } finally {
      activeInflight = null;
    }
  })();
  return activeInflight;
}

// ---------------------------------------------------------------------------
// The poller — WS-first, batched-REST fill-in, bounded, self-idling
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;
let subscribedOccs = new Set<string>();
/** Per (session:ticker) persisted-state memo so status flips persist immediately
 *  and everything else heartbeats at PERSIST_HEARTBEAT_MS. */
const persistMemo = new Map<string, { status: PlayStatus; at: number }>();
const latchMemo = new Map<string, PlayLatch>();

/** One poll tick, exported for tests (deps injectable). Never throws. */
export async function runZeroDteMarkTick(deps?: {
  plays?: ActiveZeroDtePlay[];
  fetchSnapshots?: typeof fetchOptionsUnifiedSnapshot;
  readWsMark?: typeof getLiveOptionMark;
  persist?: typeof updateZeroDteLiveState;
  nowMs?: number;
  nowEtMinutes?: number;
  skipPersist?: boolean;
}): Promise<void> {
  if (tickRunning) return; // a slow REST call must not stack ticks
  tickRunning = true;
  try {
    const now = deps?.nowMs ?? Date.now();
    const plays = deps?.plays ?? (await getActivePlays(now));
    if (plays.length === 0) return;

    const occs = Array.from(new Set(plays.map((p) => p.occ)));

    // Keep the app-wide options WS pool subscribed to exactly the active set —
    // additive to its own user_positions reconciler (which set-diffs only against
    // symbols it added itself, so it never tears these down).
    if (!deps) reconcileWsSubscriptions(occs);

    // WS-first: any contract with a fresh WS tick skips the REST fill-in.
    const readWs = deps?.readWsMark ?? getLiveOptionMark;
    const misses: string[] = [];
    await Promise.all(
      occs.map(async (occ) => {
        try {
          const ws = await readWs(occ, WS_FRESH_MS);
          if (ws && ws.mark != null) {
            putZeroDteLiveMark({
              occ,
              bid: ws.bid,
              ask: ws.ask,
              mid: zeroDteMidOf(ws.bid, ws.ask),
              // The WS store's mark is already mid-preferred (options-socket midOf)
              // with a last-trade fallback baked in; provenance is flagged from
              // whether a two-sided quote backs it.
              last: null,
              mark: ws.mark,
              source: zeroDteMidOf(ws.bid, ws.ask) != null ? "mid" : "last",
              asOf: ws.ts,
              lane: "ws",
            });
            return;
          }
        } catch {
          /* WS read is best-effort — REST covers it */
        }
        misses.push(occ);
      })
    );

    if (misses.length > 0) {
      const fetchSnaps = deps?.fetchSnapshots ?? fetchOptionsUnifiedSnapshot;
      try {
        const snaps = await fetchSnaps(misses);
        const asOf = Date.now();
        for (const occ of misses) {
          const snap = snaps.get(occ);
          if (snap) putZeroDteLiveMark(markFromSnapshot(occ, snap, asOf));
        }
      } catch {
        /* best-effort: existing store entries simply age into staleness */
      }
    }

    // Ledger sync FROM THE SAME STORE (B-9 structural rule): latch peak/trough,
    // derive status, persist status flips immediately + heartbeat the rest. The
    // DB write itself is the same GREATEST/LEAST latch scan.ts's cron sync uses,
    // so concurrent writers can only widen, never fight.
    const persist = deps?.persist ?? (dbConfigured() ? updateZeroDteLiveState : null);
    if (!deps?.skipPersist && persist) {
      const nowEtMinutes =
        deps?.nowEtMinutes ??
        (() => {
          const { hour, minute } = etNowParts();
          return hour * 60 + minute;
        })();
      for (const play of plays) {
        const key = `${play.session_date}:${play.ticker}`;
        const m = markStore.get(play.occ);
        const mark = m && !isZeroDteMarkStale(m.asOf, now, LATCH_MAX_MARK_AGE_MS) ? m.mark : null;
        const latch = advancePlayLatch(play, latchMemo.get(key) ?? null, mark, nowEtMinutes);
        latchMemo.set(key, latch);
        const prev = persistMemo.get(key);
        const statusChanged = !prev || prev.status !== latch.status;
        const due = !prev || now - prev.at >= PERSIST_HEARTBEAT_MS;
        if (statusChanged || due) {
          persistMemo.set(key, { status: latch.status, at: now });
          await persist(play.session_date, play.ticker, { status: latch.status, mark }).catch(() => {});
        }
      }
    }
  } finally {
    tickRunning = false;
  }
}

function reconcileWsSubscriptions(occs: string[]): void {
  try {
    const desired = new Set(occs);
    const toAdd = occs.filter((o) => !subscribedOccs.has(o));
    const toRemove = Array.from(subscribedOccs).filter((o) => !desired.has(o));
    if (toAdd.length) subscribeContracts(toAdd); // strict no-op unless OPTIONS_WS_ENABLED
    if (toRemove.length) unsubscribeContracts(toRemove);
    subscribedOccs = desired;
  } catch {
    /* WS pool optional */
  }
}

/**
 * Start the ~1s live-mark poller for this replica (idempotent). Self-idling:
 * off cash RTH each tick is a single clock check; with no open plays it's one
 * cached-set check per tick and a DB read at most every 10s.
 */
export function ensureZeroDteMarkPoller(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!isEtCashRth(new Date())) return;
    void runZeroDteMarkTick().catch(() => {});
  }, POLL_TICK_MS);
  (pollTimer as unknown as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Member payload (SSE frame body + REST fallback body) — memoized per ~tick
// ---------------------------------------------------------------------------

let payloadMemo: { json: string; builtAt: number } | null = null;

/** Build the live-marks payload from the active set + the mark store. Pure given
 *  injected inputs (tests); production callers use the cached active set. */
export function buildZeroDteLiveMarksPayloadFrom(
  plays: ActiveZeroDtePlay[],
  nowMs: number,
  sessionDate: string,
  readMark: (occ: string) => ZeroDteLiveMark | undefined = getZeroDteLiveMark
): ZeroDteLiveMarksPayload {
  const marks: ZeroDteLiveMarkRow[] = plays.map((p) => {
    const m = readMark(p.occ);
    const asOf = m?.asOf ?? 0;
    const stale = isZeroDteMarkStale(asOf, nowMs);
    return {
      ticker: p.ticker,
      occ: p.occ,
      direction: p.direction,
      strike: p.strike,
      status: p.status,
      entry_premium: p.entry_premium,
      bid: m?.bid ?? null,
      ask: m?.ask ?? null,
      mid: m?.mid ?? null,
      last: m?.last ?? null,
      mark: m?.mark ?? null,
      source: m?.source ?? "none",
      mark_as_of: asOf > 0 ? new Date(asOf).toISOString() : null,
      mark_age_ms: asOf > 0 ? Math.max(0, nowMs - asOf) : null,
      stale,
      live_pnl_pct: pinnedLivePnlPct(p.entry_premium, m?.mark ?? null),
    };
  });
  return {
    available: true,
    as_of: new Date(nowMs).toISOString(),
    session_date: sessionDate,
    idle: marks.length === 0,
    cap: ZERODTE_LIVE_CONTRACT_CAP,
    marks,
  };
}

/** Serialized payload for the SSE/REST routes — one build shared per ~tick. */
export async function getZeroDteLiveMarksJson(): Promise<string> {
  const now = Date.now();
  if (payloadMemo && now - payloadMemo.builtAt <= PAYLOAD_MEMO_MS) return payloadMemo.json;
  const plays = await getActivePlays(now);
  const payload = buildZeroDteLiveMarksPayloadFrom(plays, now, todayEt());
  const json = JSON.stringify(payload);
  payloadMemo = { json, builtAt: now };
  return json;
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Test-only: reset every module store/memo between cases. */
export function _resetZeroDteLiveMarksForTest(): void {
  markStore.clear();
  latchMemo.clear();
  persistMemo.clear();
  subscribedOccs = new Set();
  activeCache = null;
  activeInflight = null;
  payloadMemo = null;
  tickRunning = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
