/**
 * Shared Massive/Polygon OPTIONS WebSocket — app-wide live marks engine.
 *
 * ONE app-wide connection pool streams option quotes (Q) for the UNION of
 * contracts users currently hold (Night's Watch open positions), writes the live
 * mark (mid of bid/ask) to a shared in-memory store + Redis, so per-user position
 * P&L is real-time with ZERO marginal upstream cost per user. Mirrors the
 * connect/auth/subscribe/reconnect/store shape of lib/ws/polygon-socket.ts.
 *
 * SAFETY: this engine is purely additive. A WS failure NEVER breaks the REST
 * snapshot fallback — getLiveOptionMark returns null on any miss/staleness, and
 * the valuation path falls back to the cached chain snapshot. It is env-gated
 * (OPTIONS_WS_ENABLED) and only initialized on the Node.js server runtime.
 *
 * Protocol (Massive options WS — see src/app/docs/polygon/websocket/options/page.tsx):
 *   URL       wss://socket.massive.com/options   (override via OPTIONS_WS_URL)
 *   auth      {"action":"auth","params":"<API_KEY>"}
 *   subscribe {"action":"subscribe","params":"Q.O:SPXW250616C05850000,..."}
 *   message   Array<{ ev: "Q"|"status"|..., sym, bp/bid, ap/ask, ... }>
 *   limits    <= 1000 contracts per connection (Q feed); shard across connections.
 *
 * The exact Q-quote field names on Massive are not fully pinned in the docs, so we
 * read bid/ask defensively (bp/ap and bid/ask aliases). If a field is missing we
 * store null and never fabricate a mark.
 */
import { MASSIVE_WS_OPTIONS } from "@/lib/polygon-docs-nav";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPTIONS_WS_URL = process.env.OPTIONS_WS_URL ?? MASSIVE_WS_OPTIONS;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";

/** True only when the engine is explicitly enabled AND a key is present. */
export function optionsWsEnabled(): boolean {
  const flag = (process.env.OPTIONS_WS_ENABLED ?? "").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  return on && Boolean(POLYGON_API_KEY);
}

/** Max option contracts per connection on the Q feed (Massive hard cap is 1,000). */
const MAX_CONTRACTS_PER_CONN = Math.max(
  1,
  Math.min(1000, Number(process.env.OPTIONS_WS_MAX_PER_CONN ?? 1000) || 1000)
);
/** Max concurrent connections to shard across (Massive ~10/connection limit). */
const MAX_CONNECTIONS = Math.max(
  1,
  Math.min(10, Number(process.env.OPTIONS_WS_MAX_CONNS ?? 10) || 10)
);

/** Short TTL for the Redis write-through (seconds). Marks are intraday + ephemeral. */
const MARK_REDIS_TTL_SEC = Math.max(
  2,
  Number(process.env.OPTIONS_WS_MARK_TTL_SEC ?? 15) || 15
);

/** A mark older than this is considered stale by getLiveOptionMark (ms). */
export const OPTION_MARK_FRESH_MS = Math.max(
  1000,
  Number(process.env.OPTIONS_WS_MARK_FRESH_MS ?? 30_000) || 30_000
);

const MARK_REDIS_PREFIX = "nw:optmark:";

// ---------------------------------------------------------------------------
// Shared mark store
// ---------------------------------------------------------------------------

export type OptionMark = {
  bid: number | null;
  ask: number | null;
  mark: number | null;
  last: number | null;
  ts: number; // epoch ms when this mark was received/updated
};

/** In-memory marks keyed by OCC symbol (e.g. "O:SPXW250616C05850000"). */
export const optionMarks: Map<string, OptionMark> = new Map();

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mid of bid/ask. bid may be 0 for deep-OTM; require ask>0 so it's a real quote. */
function midOf(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && ask > 0 && bid >= 0) {
    return Number(((bid + ask) / 2).toFixed(4));
  }
  return null;
}

async function writeMarkThrough(occ: string, m: OptionMark): Promise<void> {
  try {
    const { sharedCacheSet } = await import("../shared-cache");
    await sharedCacheSet(`${MARK_REDIS_PREFIX}${occ}`, m, MARK_REDIS_TTL_SEC);
  } catch {
    /* Redis optional — in-memory store already updated, non-fatal */
  }
}

/**
 * Public read: freshest live mark for an OCC symbol, in-memory first then Redis.
 * Returns null when absent OR stale (> OPTION_MARK_FRESH_MS) so callers can fall
 * back to the REST snapshot. NEVER fabricates — a missing/stale quote is null.
 */
export async function getLiveOptionMark(
  occ: string,
  maxAgeMs: number = OPTION_MARK_FRESH_MS
): Promise<{ mark: number; bid: number | null; ask: number | null; ts: number } | null> {
  const now = Date.now();
  const local = optionMarks.get(occ);
  if (local && local.mark != null && now - local.ts <= maxAgeMs) {
    return { mark: local.mark, bid: local.bid, ask: local.ask, ts: local.ts };
  }
  // Redis fallback (cross-instance): another server process may hold the mark.
  try {
    const { sharedCacheGet } = await import("../shared-cache");
    const hit = await sharedCacheGet<OptionMark>(`${MARK_REDIS_PREFIX}${occ}`);
    if (hit && hit.mark != null && now - hit.ts <= maxAgeMs) {
      // Re-seed the in-memory layer so subsequent reads skip Redis.
      if (!local || hit.ts > local.ts) optionMarks.set(occ, hit);
      return { mark: hit.mark, bid: hit.bid, ask: hit.ask, ts: hit.ts };
    }
  } catch {
    /* Redis optional */
  }
  return null;
}

/** Synchronous in-memory-only read (no Redis). Used by hot batch paths. */
export function getLiveOptionMarkSync(
  occ: string,
  maxAgeMs: number = OPTION_MARK_FRESH_MS
): { mark: number; bid: number | null; ask: number | null; ts: number } | null {
  const local = optionMarks.get(occ);
  if (local && local.mark != null && Date.now() - local.ts <= maxAgeMs) {
    return { mark: local.mark, bid: local.bid, ask: local.ask, ts: local.ts };
  }
  return null;
}

// ---------------------------------------------------------------------------
// OCC builder
// ---------------------------------------------------------------------------

/**
 * Build an OCC option symbol with Massive's "O:" prefix from position fields.
 * Format: O:<ROOT><YYMMDD><C|P><strike*1000, 8 digits zero-padded>
 * e.g. O:SPXW250616C05850000  (SPX 5850 call expiring 2025-06-16)
 *
 * SPX index options (and the SPXW weeklies) trade under the SPXW root on
 * Polygon/Massive — see lib/spx-play-options.ts which uses "SPXW". A bare "SPX"
 * underlying yields zero contracts. Returns null when inputs can't form a valid
 * OCC (never a malformed symbol).
 */
export function buildOcc(
  ticker: string,
  expiry: string, // YYYY-MM-DD
  optionType: "call" | "put",
  strike: number
): string | null {
  const rawRoot = ticker.trim().toUpperCase();
  if (!rawRoot) return null;
  // SPX -> SPXW (index weeklies/monthlies are listed under SPXW on Massive).
  const root = rawRoot === "SPX" ? "SPXW" : rawRoot;
  if (!/^[A-Z]{1,6}$/.test(root)) return null;

  const ymd = expiry.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const yy = m[1].slice(2);
  const date = `${yy}${m[2]}${m[3]}`;

  if (optionType !== "call" && optionType !== "put") return null;
  const cp = optionType === "call" ? "C" : "P";

  if (!Number.isFinite(strike) || strike <= 0) return null;
  // Strike is encoded as price * 1000, zero-padded to 8 digits. Round to the
  // nearest 1/1000 to avoid float drift (e.g. 5850 -> 05850000).
  const strikeInt = Math.round(strike * 1000);
  if (strikeInt <= 0 || strikeInt > 99_999_999) return null;
  const strikeStr = String(strikeInt).padStart(8, "0");

  return `O:${root}${date}${cp}${strikeStr}`;
}

// ---------------------------------------------------------------------------
// Sharded connection pool
// ---------------------------------------------------------------------------

function optionsWsError(err: unknown): string {
  if (err instanceof Error) return err.message;
  const evt = err as { message?: string; error?: unknown };
  if (typeof evt?.message === "string") return evt.message;
  if (evt?.error instanceof Error) return evt.error.message;
  return String(err);
}

/**
 * A single WS connection holding up to MAX_CONTRACTS_PER_CONN subscriptions.
 * Owns its own auth state, reconnect/backoff, and re-subscribes its assigned
 * symbol set on every (re)connect. The pool reassigns symbols to shards.
 */
class OptionsShard {
  readonly id: number;
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  /** Symbols this shard is responsible for (the desired set). */
  readonly symbols = new Set<string>();
  /** Symbols the server has acked a subscription for on the current socket. */
  private subscribed = new Set<string>();
  private lastMessageAt = 0;
  private authFailed = false;
  private shuttingDown = false;

  constructor(id: number) {
    this.id = id;
  }

  size(): number {
    return this.symbols.size;
  }

  has(occ: string): boolean {
    return this.symbols.has(occ);
  }

  /** Add a symbol to this shard's desired set (subscribes if socket is live). */
  add(occ: string): void {
    if (this.symbols.has(occ)) return;
    this.symbols.add(occ);
    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([occ]);
    } else {
      this.ensureConnected();
    }
  }

  /** Remove a symbol from this shard (unsubscribes if socket is live). */
  remove(occ: string): void {
    if (!this.symbols.has(occ)) return;
    this.symbols.delete(occ);
    if (this.subscribed.has(occ)) {
      this.subscribed.delete(occ);
      if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
        this.sendUnsubscribe([occ]);
      }
    }
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect(reason: string) {
    if (this.shuttingDown) return; // shutting down — do not resurrect the socket
    if (this.reconnectTimer) return;
    if (this.symbols.size === 0) return; // nothing to stream — stay idle
    this.consecutiveFailures += 1;
    const base = Math.min(this.reconnectDelay, 60_000);
    const jitter = Math.floor(Math.random() * 400);
    const delay = this.consecutiveFailures >= 8 ? 60_000 : base + jitter;
    console.warn(
      `[options-socket] shard ${this.id} reconnect in ${delay}ms (${reason}, failures=${this.consecutiveFailures})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
  }

  /** Connect only if there is work to do and we are not already connected. */
  ensureConnected(): void {
    if (this.shuttingDown) return; // shutting down — do not open a new socket
    if (this.symbols.size === 0) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  private sendSubscribe(symbols: string[]) {
    if (!symbols.length || this.ws?.readyState !== WebSocket.OPEN) return;
    const params = symbols.map((s) => `Q.${s}`).join(",");
    this.ws.send(JSON.stringify({ action: "subscribe", params }));
    for (const s of symbols) this.subscribed.add(s);
  }

  private sendUnsubscribe(symbols: string[]) {
    if (!symbols.length || this.ws?.readyState !== WebSocket.OPEN) return;
    const params = symbols.map((s) => `Q.${s}`).join(",");
    this.ws.send(JSON.stringify({ action: "unsubscribe", params }));
  }

  private connect() {
    if (this.shuttingDown) return; // shutting down — do not open a new socket
    if (!POLYGON_API_KEY) return;
    if (this.symbols.size === 0) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnect();
    this.subscribed.clear();

    try {
      const ws = new WebSocket(OPTIONS_WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        this.authenticated = false;
        console.log(`[options-socket] shard ${this.id} connected (${this.symbols.size} contracts)`);
      };

      ws.onmessage = (event) => {
        this.handleMessage(String(event.data));
      };

      ws.onerror = (err) => {
        // onclose carries the actionable reason; log host-level transient errors.
        console.warn(`[options-socket] shard ${this.id} error: ${optionsWsError(err)}`);
      };

      ws.onclose = (event) => {
        this.ws = null;
        this.authenticated = false;
        this.subscribed.clear();
        const authFailure =
          event.code === 1008 || event.code === 4401 || event.code === 4403;
        if (authFailure) {
          this.authFailed = true;
          console.error(
            `[options-socket] shard ${this.id} auth failed (code=${event.code}) — check POLYGON_API_KEY`
          );
        }
        this.scheduleReconnect(`code=${event.code}`);
      };
    } catch (err) {
      this.ws = null;
      console.error(`[options-socket] shard ${this.id} failed to connect: ${optionsWsError(err)}`);
      this.scheduleReconnect("connect-threw");
    }
  }

  private handleMessage(raw: string) {
    let msgs: Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(raw);
      msgs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return;
    }

    // Any inbound frame (connected / auth / status / subscribe-ack / heartbeat / quote) proves
    // the socket is ALIVE — track liveness HERE, not only on a priced quote. Otherwise a single
    // quiet contract with no NBBO update for >stallMs reads as a "stall" and triggers a needless
    // reconnect (which then collides with the still-closing old socket → 1006 backoff storm).
    this.lastMessageAt = Date.now();

    for (const msg of msgs) {
      const ev = String(msg.ev ?? "");
      const status = msg.status as string | undefined;

      if (ev === "connected" || (ev === "status" && status === "connected")) {
        this.ws?.send(JSON.stringify({ action: "auth", params: POLYGON_API_KEY }));
      } else if (ev === "auth_success" || (ev === "status" && status === "auth_success")) {
        this.authenticated = true;
        this.authFailed = false;
        this.reconnectDelay = 1000;
        this.consecutiveFailures = 0;
        // (Re)subscribe the full desired set for this shard on a fresh socket.
        this.subscribed.clear();
        this.sendSubscribe(Array.from(this.symbols));
        console.log(
          `[options-socket] shard ${this.id} authenticated — subscribed ${this.symbols.size} contracts`
        );
      } else if (
        ev === "auth_failed" ||
        (ev === "status" && (status === "auth_failed" || status === "unauthorized"))
      ) {
        this.authFailed = true;
        console.error(`[options-socket] shard ${this.id} auth_failed — check POLYGON_API_KEY`);
      } else if (ev === "Q") {
        this.handleQuote(msg);
      }
      // status:success acks for subscribe/unsubscribe are ignored (no-op).
    }
  }

  private handleQuote(msg: Record<string, unknown>) {
    // OCC symbol — Massive uses `sym`; tolerate `T`/`ticker` aliases.
    const occ = String(msg.sym ?? msg.T ?? msg.ticker ?? "");
    if (!occ) return;

    // Bid/ask — Massive quote fields are bp/ap (bid price / ask price). Tolerate
    // bid/ask aliases. Sizes (bs/as) are ignored — we only need the NBBO prices.
    const bid = finiteOrNull(msg.bp ?? msg.bid);
    const ask = finiteOrNull(msg.ap ?? msg.ask);
    const last = finiteOrNull(msg.lp ?? msg.last ?? msg.p);
    const mark = midOf(bid, ask);
    // A Q frame with no usable price at all is dropped — never store a fabricated mark.
    if (mark == null && bid == null && ask == null && last == null) return;

    const now = Date.now();
    // (liveness is tracked in handleMessage on ANY frame; here we only need `now` for the ts)
    const entry: OptionMark = { bid, ask, mark, last, ts: now };
    optionMarks.set(occ, entry);
    void writeMarkThrough(occ, entry);
  }

  /** Half-open watchdog: tear down + reconnect if OPEN but silent past stallMs. */
  reconnectIfStalled(stallMs: number, now = Date.now()): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.symbols.size === 0) return;
    if (this.lastMessageAt === 0) return; // never delivered yet — leave alone
    if (now - this.lastMessageAt <= stallMs) return;
    console.warn(
      `[options-socket] shard ${this.id} stall watchdog — OPEN but no data for ${Math.round(
        (now - this.lastMessageAt) / 1000
      )}s, reconnecting`
    );
    // 3s (not 1s) so Massive releases the old (closing) connection before we reopen — a too-fast
    // reopen collides with the lingering socket and the server drops the new one with 1006.
    this.reconnectDelay = 3000;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.authenticated = false;
    this.scheduleReconnect("stall");
  }

  /**
   * Graceful shutdown of this shard. Sets the shutdown flag (so scheduleReconnect
   * / ensureConnected / connect bail and cannot reopen), clears the reconnect
   * timer, and closes the live WS with a normal close (1000). Best-effort,
   * idempotent, never throws.
   */
  shutdown(): void {
    this.shuttingDown = true;
    this.clearReconnect();
    const ws = this.ws;
    this.ws = null;
    this.authenticated = false;
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
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "server shutdown");
        }
      } catch {
        /* best-effort — must not block shutdown */
      }
    }
  }

  status() {
    return {
      id: this.id,
      contracts: this.symbols.size,
      ws_state: this.ws
        ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][this.ws.readyState]
        : "NOT_CREATED",
      authenticated: this.authenticated,
      auth_failed: this.authFailed,
      consecutive_failures: this.consecutiveFailures,
      last_message_age_ms: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
    };
  }
}

/**
 * The pool: routes OCC symbols to shards (each <= MAX_CONTRACTS_PER_CONN), caps
 * total at MAX_CONNECTIONS * MAX_CONTRACTS_PER_CONN and logs an overflow warning
 * rather than silently dropping. Ref-counting is unnecessary because the desired
 * set IS the union of held contracts (the reconciler replaces it wholesale).
 */
class OptionsSocketPool {
  private shards: OptionsShard[] = [];
  /** occ -> shard index, so removals find their owner in O(1). */
  private owner = new Map<string, number>();
  private overflowLogged = false;
  private shuttingDown = false;

  private capacity(): number {
    return MAX_CONNECTIONS * MAX_CONTRACTS_PER_CONN;
  }

  totalSubscribed(): number {
    return this.owner.size;
  }

  /** Subscribe a batch of OCC symbols (idempotent). Respects the global cap. */
  subscribe(symbols: string[]): void {
    if (this.shuttingDown) return; // shutting down — accept no new subscriptions
    for (const occ of symbols) {
      if (!occ || this.owner.has(occ)) continue;
      const shard = this.pickShard();
      if (!shard) {
        if (!this.overflowLogged) {
          this.overflowLogged = true;
          console.warn(
            `[options-socket] capacity reached (${this.capacity()} contracts across ${MAX_CONNECTIONS} connections) — extra contracts will rely on REST snapshot fallback`
          );
        }
        continue;
      }
      shard.add(occ);
      this.owner.set(occ, shard.id);
    }
  }

  /** Unsubscribe a batch of OCC symbols (idempotent). */
  unsubscribe(symbols: string[]): void {
    for (const occ of symbols) {
      const idx = this.owner.get(occ);
      if (idx === undefined) continue;
      this.shards[idx]?.remove(occ);
      this.owner.delete(occ);
    }
    // Reset overflow latch once we drop below capacity so a later spike re-warns.
    if (this.overflowLogged && this.owner.size < this.capacity()) {
      this.overflowLogged = false;
    }
  }

  /** Find a shard with spare capacity, creating a new one up to MAX_CONNECTIONS. */
  private pickShard(): OptionsShard | null {
    for (const s of this.shards) {
      if (s.size() < MAX_CONTRACTS_PER_CONN) return s;
    }
    if (this.shards.length < MAX_CONNECTIONS) {
      const shard = new OptionsShard(this.shards.length);
      this.shards.push(shard);
      return shard;
    }
    return null; // at capacity
  }

  /** Periodic heartbeat: reconnect idle/stalled shards. */
  watchdog(stallMs: number): void {
    if (this.shuttingDown) return; // shutting down — do not revive shards
    const now = Date.now();
    for (const s of this.shards) {
      s.ensureConnected();
      s.reconnectIfStalled(stallMs, now);
    }
  }

  /**
   * Graceful shutdown of the pool: set the flag (so subscribe / watchdog bail)
   * and shut down every shard (each closes its WS + bails its own reconnect).
   * Best-effort, idempotent, never throws.
   */
  shutdown(): void {
    this.shuttingDown = true;
    for (const s of this.shards) {
      try {
        s.shutdown();
      } catch {
        /* one shard failing must not block the others */
      }
    }
  }

  status() {
    return {
      enabled: optionsWsEnabled(),
      url: OPTIONS_WS_URL,
      total_contracts: this.owner.size,
      capacity: this.capacity(),
      max_per_conn: MAX_CONTRACTS_PER_CONN,
      max_connections: MAX_CONNECTIONS,
      shards: this.shards.map((s) => s.status()),
      marks_in_memory: optionMarks.size,
    };
  }
}

const pool = new OptionsSocketPool();

// ---------------------------------------------------------------------------
// Public subscription API
// ---------------------------------------------------------------------------

/** Subscribe the WS pool to a set of OCC symbols (idempotent, capacity-capped). */
export function subscribeContracts(occs: string[]): void {
  if (!optionsWsEnabled()) return;
  pool.subscribe(occs.filter(Boolean));
}

/** Unsubscribe the WS pool from a set of OCC symbols (idempotent). */
export function unsubscribeContracts(occs: string[]): void {
  pool.unsubscribe(occs.filter(Boolean));
}

export function getOptionsSocketStatus() {
  return pool.status();
}

// ---------------------------------------------------------------------------
// Subscription reconciler
// ---------------------------------------------------------------------------

const RECONCILE_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.OPTIONS_WS_RECONCILE_MS ?? 30_000) || 30_000
);
// 5 min default. With any-frame liveness (handleMessage), a real half-open stall is rare, and a
// single quiet contract can legitimately go minutes without an NBBO update — so a tight 90s
// threshold produced spurious reconnect storms. A genuinely dead-but-OPEN socket is still caught
// within 5 min, and the live-mark gap meanwhile falls back to the REST snapshot. Tunable via env.
const WATCHDOG_STALL_MS = Math.max(
  10_000,
  Number(process.env.OPTIONS_WS_STALL_MS ?? 300_000) || 300_000
);

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileRunning = false;
/** The desired OCC set computed on the last successful reconcile. */
let lastDesired = new Set<string>();

/**
 * Read DISTINCT open-position contracts and reconcile WS subscriptions:
 * subscribe newly-held OCCs, unsubscribe ones no user holds. Set-diff against the
 * previous desired set keeps the active subscription = currently-held contracts
 * with no manual signaling. Safe under failure: a DB error leaves the prior set
 * intact (no churn) and is swallowed — the snapshot fallback is unaffected.
 */
export async function reconcileOptionSubscriptions(): Promise<void> {
  if (!optionsWsEnabled()) return;
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const { dbConfigured, dbQuery } = await import("@/lib/db");
    if (!dbConfigured()) return;

    const res = await dbQuery<{
      ticker: string;
      expiry: unknown;
      option_type: string;
      strike: string | number;
    }>(
      `SELECT DISTINCT ticker, expiry, option_type, strike
         FROM user_positions
        WHERE status = 'open'`
    );

    const desired = new Set<string>();
    for (const row of res.rows) {
      const ymd =
        row.expiry instanceof Date
          ? `${row.expiry.getFullYear()}-${String(row.expiry.getMonth() + 1).padStart(2, "0")}-${String(
              row.expiry.getDate()
            ).padStart(2, "0")}`
          : String(row.expiry).slice(0, 10);
      const occ = buildOcc(
        String(row.ticker),
        ymd,
        row.option_type === "put" ? "put" : "call",
        Number(row.strike)
      );
      if (occ) desired.add(occ);
    }

    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const occ of Array.from(desired)) if (!lastDesired.has(occ)) toAdd.push(occ);
    for (const occ of Array.from(lastDesired)) if (!desired.has(occ)) toRemove.push(occ);

    if (toAdd.length) subscribeContracts(toAdd);
    if (toRemove.length) unsubscribeContracts(toRemove);
    lastDesired = desired;

    if (toAdd.length || toRemove.length) {
      console.log(
        `[options-socket] reconciled — +${toAdd.length} -${toRemove.length} (${desired.size} held contracts)`
      );
    }
  } catch (err) {
    // Reconcile failure must NEVER break valuation — prior subscriptions persist,
    // and getLiveOptionMark simply ages out to the snapshot fallback.
    console.warn(`[options-socket] reconcile failed (non-fatal): ${optionsWsError(err)}`);
  } finally {
    reconcileRunning = false;
  }
}

let optionsSocketInitialized = false;

/**
 * Initialize the shared options WS engine: start the reconcile loop + watchdog.
 * Idempotent and env-gated. Does nothing (strict no-op) when disabled, so it can
 * be toggled off without affecting the uw/polygon sockets or the REST fallback.
 */
export function initOptionsSocket(): void {
  if (optionsSocketInitialized) return;
  if (!optionsWsEnabled()) {
    console.log("[options-socket] disabled (OPTIONS_WS_ENABLED off or POLYGON_API_KEY missing)");
    return;
  }
  optionsSocketInitialized = true;

  // First reconcile immediately so marks start flowing without a 30s wait.
  void reconcileOptionSubscriptions();

  if (!reconcileTimer) {
    reconcileTimer = setInterval(() => {
      void reconcileOptionSubscriptions();
      pool.watchdog(WATCHDOG_STALL_MS);
    }, RECONCILE_INTERVAL_MS);
  }

  console.log(
    `[options-socket] initialized — reconcile every ${Math.round(RECONCILE_INTERVAL_MS / 1000)}s, ` +
      `cap ${MAX_CONNECTIONS}x${MAX_CONTRACTS_PER_CONN} contracts`
  );
}

/**
 * Graceful shutdown for the options WS engine. Clears the reconcile/watchdog
 * interval and shuts down every shard's connection (the pool sets its own
 * shutdown flag so shards won't reconnect and reconcile won't re-subscribe).
 * Best-effort, idempotent, never throws. Called on SIGTERM so the old container
 * releases its Massive options slots immediately.
 */
export function shutdownOptionsSocket(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  pool.shutdown();
}
