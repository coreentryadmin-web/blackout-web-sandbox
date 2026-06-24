# 03 — BACKEND SERVICE INVENTORY & AUDIT (Deliverable E + feeds L)

**Scope:** route handlers, `src/lib` service modules, `src/middleware.ts`, validation, error handling, logging/observability, retries, background processing, and the WebSocket managers in `src/lib/ws/*`. Read-only, evidence-grounded. Target: scale from <10 users to ~500 **concurrent** users on Railway (Next.js 14.2.35 App Router, React 18, Clerk 5.7.6, Whop billing, Polygon/Massive + Unusual Whales market data, Postgres via `pg`, Redis via `ioredis`).

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).

---

## 0. Verdict at a glance

The backend is **substantially more mature than a pre-launch codebase usually is**: there is a real cross-replica UW rate limiter (Redis Lua sliding window + cluster pub/sub circuit breaker), a shared single-flight server cache with SWR + degradation tracking, per-user cache-reader enrichment that holds the "O(distinct chains), never per-user upstream" scaling rule, graceful SIGTERM socket shutdown, a Largo concurrency + daily-budget gate, advisory-locked migrations and flow ingest, and SSE backpressure + connection caps on the two newest streams. Most of the obvious 500-user landmines have already been defused.

**However**, several real issues remain that will bite at 500 concurrent users:

- **Per-process Postgres pool default of 5** with `ensureSchema()` (an `await`-ed migration gate) on the front of **every** `dbQuery` — pool exhaustion + head-of-line latency is the single biggest DB bottleneck. (HIGH)
- **`/api/market/live` SSE has NO connection cap, NO heartbeat, NO backpressure** and rides the `spxBroadcaster` which **permanently gives up after 10 reconnect attempts** — a connection-count DoS + a silent permanent data outage. (HIGH)
- **`/api/market/spx/pulse/stream` issues a Redis `GET` every 250 ms per connection** — 500 clients = ~2,000 Redis GETs/sec/instance for data that is already in process memory. (HIGH)
- **`endpointStats` telemetry Map is unbounded** and keyed on per-ticker / per-OCC Polygon paths — a slow memory leak that grows with the breadth of tickers/contracts ever queried. (MEDIUM)
- **`polygon-socket.ts` (the SPX/VIX index feed that powers the pulse) has no half-open stall watchdog** unlike `uw-socket`/`options-socket` — a silently-stalled feed serves stale prices indefinitely. (MEDIUM)
- A scatter of **missing input bounds** (`/api/market/quote` ticker, `/api/market/flows` `since_hours`) and **fail-open auth/limiter** paths worth knowing about.

None of these are individually catastrophic, but the first three are launch-relevant and cheap to fix.

---

## 1. Backend service inventory

### 1.1 Infrastructure / cross-cutting modules (`src/lib`)

| Module | Role | State held | Scaling notes |
|---|---|---|---|
| `db.ts` (2602 LOC) | pg Pool factory, schema migrations, all query helpers, advisory locks | module `pool`, `schemaReady`, `heldLockClients` Map | **`max:5` default pool**; `ensureSchema()` awaited per query |
| `make-redis.ts` | single ioredis connect factory (mandatory `error` listener) | none | Good — fixes the "no error listener crashes replica" class |
| `shared-cache.ts` | Redis-or-memory KV with TTL, 30s failure backoff | `memory` Map, `redisClient` | `memory` Map **never bounded** (see §4) |
| `server-cache.ts` | in-proc TTL cache + single-flight + SWR + Redis layer + degradation | `store` (bounded 5000), `inflight`, `failureCount`, `degradedKeys` | Good — `store` is LRU-bounded; the SWR core is sound |
| `tier-cache.ts` | 60s per-user tier cache shared by page + API gates | `tierCache` Map | Per-user Map, **never bounded** (see §4) |
| `redis-pubsub.ts` | shared publisher/subscriber + channel handler registry | `channelHandlers` Map, clients | Sound; unsubscribe is ref-counted |
| `flow-events.ts` | local + Redis fan-out of flow alerts to SSE listeners | `listeners` Set | Bounded by live SSE connections |
| `api-telemetry.ts` | in-mem ring buffer of API calls + per-endpoint stats | `events` (bounded 800), **`endpointStats` UNBOUNDED**, `activeRetries` | **Memory leak** via per-ticker endpoint keys (see §4) |
| `api-tracked-fetch.ts` | retrying fetch wrapper that records telemetry | none | Sound; retries on 429/5xx with linear backoff |
| `providers/uw-rate-limiter.ts` | token bucket + Redis-global Lua sliding window + cluster breaker | module counters, `coalescedInflight` Map | Strong. The 2 RPS cluster ceiling is real |
| `providers/polygon-rate-limiter.ts` | permissive (40 rps) bucket + breaker | module counters | Sound; fail-open by design |
| `engine.ts` | proxy to internal engine (`API_BASE`) with SSRF allowlist | none | Good path validation |
| `cron-run.ts` / `cron-registry.ts` | cron logging + registry of 10 jobs | none | Sound |
| `instrumentation.ts` | `unhandledRejection` listener + ops alert + error sink | globalThis flag | Good (deliberately no `uncaughtException`) |

### 1.2 WebSocket managers (`src/lib/ws`)

| Manager | Connection model | Watchdog | Shutdown | Notes |
|---|---|---|---|---|
| `uw-socket.ts` | ONE multiplex socket, all UW channels | ✅ half-open stall watchdog (30s heartbeat) | ✅ SIGTERM 1000-close | Strongest of the three |
| `options-socket.ts` | sharded pool (≤10 conns × ≤1000 contracts), reconciled from open positions | ✅ per-shard stall watchdog | ✅ | Holds the per-user cost rule; env-gated |
| `polygon-socket.ts` | ONE indices socket (SPX/VIX/TICK/…) | ❌ **NO stall watchdog, NO heartbeat ping** | ✅ | Powers the pulse — silent-stall risk (see §3) |
| `spx-broadcaster.ts` | ONE Polygon indices socket → SSE | ❌ caps at 10 reconnects then **gives up forever** | ❌ no shutdown hook | Marked "currently unused" but **still used by `/api/market/live`** |

### 1.3 SSE / streaming endpoints

| Route | Auth | Conn cap | Heartbeat | Backpressure | Per-conn upstream cost |
|---|---|---|---|---|---|
| `market/flows/stream` | ✅ premium/cron | ✅ 500 | ✅ 25s | ✅ | none (pushed via fan-out) |
| `market/spx/pulse/stream` | ✅ | ✅ 500 | ✅ 15s | ❌ (relies on enqueue throw) | **Redis GET every 250ms** |
| `admin/apis/stream` | ✅ admin | ❌ none | ✅ 8s | ✅ | none |
| `market/live` | ✅ premium/cron | ❌ **none** | ❌ **none** | ❌ **none** | none, but no cleanup-on-error counting |
| `market/largo/query` (stream) | ✅ premium + concurrency + budget | per-user gate (2) | n/a | abort-aware | Anthropic tool loop (cost-capped) |

### 1.4 Cron jobs (10, see `cron-registry.ts`)
`flow-ingest`, `spx-evaluate`, `largo-cleanup`, `nighthawk-outcomes`, `nighthawk-playbook` (worker), `uw-cache-refresh`, `nights-watch-warm`, `db-cleanup`, `membership-reconcile`, `cron-staleness-watchdog`. All HTTP crons gate on `isCronAuthorized` (constant-time bearer compare). Cross-replica safety via `pg_try_advisory_lock` where it matters (flow-ingest, migrations).

---

## 2. Critical & High findings

### 2.1 Postgres pool default of 5 + `ensureSchema()` on every query is the primary DB bottleneck

- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:**
  - `db.ts:91-97` — `return new Pool({ ..., max: parseInt(process.env.PG_POOL_MAX ?? "5", 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });`
  - `db.ts:637-643` — `export async function dbQuery(...) { await ensureSchema(); return (await getPool()).query(...); }`
- **Why it's a problem:** Every single DB call funnels through `dbQuery`, which `await`s `ensureSchema()` first. `ensureSchema()` is memoized (`schemaReady` promise), so after the first call it resolves instantly — *but only after migrations complete*. The pool default is **5 connections per replica**. With `connectionTimeoutMillis: 15_000`, a request that can't get a connection within 15s throws. The code comment assumes "PgBouncer sits in front" doing the real pooling — but that is **not verified in this environment** and if PgBouncer is absent or in session-pooling mode, 5 connections is the hard ceiling.
- **Impact (500 concurrent users):** Night's Watch GET, flows, Largo history, push, positions — all hit Postgres. At 500 concurrent users polling on 10–60s intervals, bursts will routinely exceed 5 in-flight queries per replica, queuing behind the pool and adding latency, then timing out at 15s under load spikes. The advisory-lock helpers (`heldLockClients`) **hold a dedicated client out of the pool for the lock's entire lifetime** (`db.ts:697`, `db.ts:1106`), further shrinking the effective pool — e.g. a held flow-ingest lock or migration lock permanently consumes 1 of 5.
- **Recommended fix:** (1) Set `PG_POOL_MAX` explicitly per replica based on `max_connections / replica_count` (e.g. 10–20 if PgBouncer is in transaction mode; lower if direct). (2) **Verify PgBouncer is actually deployed and in transaction-pooling mode** (PGBOUNCER-SETUP.md exists in the repo — confirm it is wired). (3) Confirm the held-lock clients are never leaked under error (they release in `finally`, good — but each held lock still subtracts from `max`). (4) Lower `connectionTimeoutMillis` so a saturated pool fails fast instead of piling up 15s waits.
- **Example change:**
```
// Railway service env: PG_POOL_MAX=15  (with PgBouncer transaction mode)
// db.ts
connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000),
```
- **Not verified — needs prod:** whether PgBouncer is actually in front and its pool mode.

---

### 2.2 `/api/market/live` SSE has no connection cap, no heartbeat, and its broadcaster permanently dies after 10 reconnects

- **Severity:** High
- **File:** `src/app/api/market/live/route.ts`, `src/lib/spx-broadcaster.ts`
- **Code reference:**
  - `market/live/route.ts:24-43` — `new ReadableStream({ start(controller) { ... spxBroadcaster.subscribe(...) ... } })` — no `activeStreams` counter, no `MAX_STREAMS` check, no heartbeat interval, no backpressure on `controller.desiredSize`.
  - `spx-broadcaster.ts:28` — `private readonly MAX_RECONNECT_ATTEMPTS = 10`
  - `spx-broadcaster.ts:61-64` — `if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) { console.error('...Max reconnect attempts reached'); this.reconnecting = false; return }` — **after 10 failures it never reconnects again** for the process lifetime.
- **Why it's a problem:** Two distinct defects. (1) Every other SSE route caps at `SSE_MAX_STREAMS` (500) and sends heartbeats; `/api/market/live` does neither, so it is the one stream that can be opened without bound (one timer + one closure each, plus a stuck-open connection through Railway's proxy with no keepalive comment). (2) `MAX_RECONNECT_ATTEMPTS` resets to 0 only inside `auth_success` (`spx-broadcaster.ts:83`); if Polygon/Massive is unreachable for 10 consecutive attempts (≈ a few minutes of an upstream blip), the broadcaster **gives up permanently** and every `/api/market/live` consumer silently receives nothing until the process restarts.
- **Impact (500 concurrent users):** A connection-count amplifier (no cap) plus a single-point-of-failure that converts a transient Massive outage into a permanent live-bar outage with no self-heal. The `spx-broadcaster.ts:1` comment even says it is "currently unused by pulse/stream" — but `market/live/route.ts` still imports and subscribes to it, so it is live.
- **Recommended fix:** (1) Add the same `activeStreams`/`MAX_STREAMS` cap + heartbeat + `sseBackpressureExceeded` guard used by `flows/stream` and `pulse/stream`. (2) Remove the permanent give-up: keep reconnecting with the capped 60s backoff indefinitely while there are subscribers (mirror `uw-socket`/`polygon-socket` which never give up). (3) Decide whether `/api/market/live` should be retired in favor of the Redis-backed `pulse/stream` (they overlap).
- **Example change:**
```
// spx-broadcaster.ts — never give up while subscribers exist
private scheduleReconnect() {
  if (this.subscribers.size === 0) { this.reconnecting = false; return }
  this.clearReconnect()
  const delay = Math.min(1000 * 2 ** Math.min(this.reconnectAttempts, 6), 60000)
  this.reconnectAttempts++
  this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect() }, delay + Math.random()*1000)
}
```

---

### 2.3 Pulse SSE does one Redis `GET` per connection every 250 ms — ~2,000 GETs/sec/instance at 500 users for data already in memory

- **Severity:** High
- **File:** `src/app/api/market/spx/pulse/stream/route.ts`
- **Code reference:**
  - `pulse/stream/route.ts:44-72` — inside `send()`: `const redis = await getUwCacheRedis(); if (redis) { const raw = await redis.get("spx:pulse:snapshot"); ... }`
  - `pulse/stream/route.ts:78` — `interval = setInterval(() => { void send(); }, 250);`
- **Why it's a problem:** Each SSE connection runs a 250 ms timer, and on **every tick** it does a Redis round-trip to read the *single shared* `spx:pulse:snapshot` key. The snapshot is the same for all clients and is **already mirrored into the in-process `indexStore`** (written by `polygon-socket.ts:139` via `setex`, and `indexStore` is the default fallback at `pulse/stream/route.ts:47`). So 500 connections × 4 Hz = ~2,000 identical Redis GETs/sec per replica, every one of which returns the same value that the process already holds in memory.
- **Impact (500 concurrent users):** Redis CPU + network amplified by N connections for zero added freshness. It also serializes each connection's send behind a network await, so a Redis hiccup stalls every client's tick. This violates the project's own cache-reader spirit (collapse to one shared read, not N).
- **Recommended fix:** Read `indexStore` directly (it is already updated in real time by the indices WS and re-seeded from Redis). If cross-replica freshness is required, have **one** module-level poller refresh a shared in-memory snapshot from Redis on a single timer and have all connections read that snapshot synchronously. Drop the per-connection per-tick Redis GET entirely.
- **Example change:**
```
// One shared snapshot refreshed on a single timer; connections read it sync.
let pulseSnapshot = indexStore;
let pulsePollTimer: ReturnType<typeof setInterval> | null = null;
function ensurePulsePoller() {
  if (pulsePollTimer) return;
  pulsePollTimer = setInterval(async () => {
    try { const r = await getUwCacheRedis(); if (r) { const raw = await r.get("spx:pulse:snapshot"); if (raw) pulseSnapshot = JSON.parse(raw); } } catch {}
  }, 1000);
}
// per-connection send() now just serializes pulseSnapshot — no await, no per-conn Redis.
```

---

## 3. Medium findings

### 3.1 `endpointStats` telemetry Map is unbounded and keyed on per-ticker / per-OCC Polygon paths

- **Severity:** Medium
- **File:** `src/lib/api-telemetry.ts`, called from `src/lib/providers/polygon.ts`, `polygon-largo.ts`, `polygon-options-gex.ts`
- **Code reference:**
  - `api-telemetry.ts:40` — `const endpointStats = new Map<string, ApiEndpointStats>();` (never evicted; only `events` is bounded at 800).
  - `api-telemetry.ts:203` — `const key = statsKey(event.provider, event.method, event.endpoint);` where `statsKey = ${provider}|${method}|${endpoint}`.
  - `polygon.ts:20` — `polygonTrackedFetch(path, ...)` passes the raw `path` (e.g. `/v3/snapshot/options/SPXW250101C05850000`, `/v2/aggs/ticker/AAPL/...`) as the telemetry `endpointKey`.
- **Why it's a problem:** The `endpoint` label embeds the ticker / OCC symbol / aggregate window in the path. Every *distinct* path becomes a permanent `endpointStats` entry holding up to `MAX_SAMPLES = 100` latency samples (`api-telemetry.ts:217`). Across a trading day with 500 users querying many tickers and contracts (ticker-search, quote, Largo, GEX, Night's Watch chains), the number of distinct paths is effectively unbounded, so the Map grows without limit and is never cleaned up for the process lifetime. (UW is safe — its in-memory cache only stores allowlisted paths, and UW's stats keys are coarse REST endpoints; Polygon is the leak source.)
- **Impact (500 concurrent users):** A slow but real per-replica memory leak proportional to the breadth of symbols touched. On a long-lived Railway container it trends toward OOM / GC pressure. Also makes the admin API dashboard's per-endpoint table explode in cardinality.
- **Recommended fix:** Either (a) normalize the `endpointKey` to a templated route (`/v3/snapshot/options/:occ`, `/v2/aggs/ticker/:ticker/...`) before it reaches telemetry, or (b) LRU-bound `endpointStats` the same way `server-cache.ts` bounds `store` (cap + insertion-order eviction). Option (a) also makes the dashboard far more useful.
- **Example change:**
```
// polygon.ts — collapse symbol-bearing segments to a template before tracking
function endpointTemplate(path: string): string {
  return path
    .replace(/\/O:[A-Z0-9]+/g, "/:occ")
    .replace(/\/ticker\/[A-Z.\-]+/g, "/ticker/:sym")
    .replace(/\/[A-Z]{1,6}\b/g, m => m); // keep coarse, drop unique IDs
}
```

---

### 3.2 `polygon-socket.ts` (indices feed) has no half-open stall watchdog or heartbeat — a silent stall serves stale prices

- **Severity:** Medium
- **File:** `src/lib/ws/polygon-socket.ts`
- **Code reference:** the file has `scheduleIndicesReconnect` on `onclose` (`polygon-socket.ts:157-162`) but, unlike `uw-socket.ts:343` (`reconnectIfStalled`) and `options-socket.ts:413` (`reconnectIfStalled`), there is **no periodic watchdog** that detects "socket OPEN but no `A`/`AM` messages for N seconds," and **no `ping` heartbeat**.
- **Why it's a problem:** A WebSocket can stay in `readyState OPEN` while the upstream silently stops delivering aggregates (TCP half-open, idle proxy, Massive gateway hiccup). With no stall detection, `indexStore` freezes at its last value and never reconnects until the socket actually closes — which may never happen. The pulse SSE (§2.3) and `/api/market/quote`'s WS path (`quote/route.ts:147-160`) both read `indexStore` and would serve a stale SPX/VIX price; the quote route does have a `WS_STALE_MS` guard that falls back to REST, but the pulse SSE serves whatever is in the store.
- **Impact (500 concurrent users):** Stale live prices across the whole desk during an upstream half-open, with no auto-recovery. This is the index feed that every SPX surface depends on.
- **Recommended fix:** Add the same stall watchdog + heartbeat pattern already implemented in `uw-socket.ts` / `options-socket.ts`: a module-level `setInterval` that, when the socket is OPEN and `Date.now() - lastIndicesMessageAt > STALL_MS`, tears down and reconnects; plus a `ping()` on the same timer. Track `lastIndicesMessageAt` in the `A`/`AM` branch.
- **Example change:**
```
let lastIndicesMessageAt = 0;            // set in the A/AM branch
let indicesWatchdog: ReturnType<typeof setInterval> | null = null;
function startIndicesWatchdog() {
  if (indicesWatchdog) return;
  indicesWatchdog = setInterval(() => {
    if (indicesWs?.readyState === WebSocket.OPEN && lastIndicesMessageAt &&
        Date.now() - lastIndicesMessageAt > 90_000) {
      try { indicesWs.close() } catch {}  // onclose schedules reconnect
    }
  }, 30_000);
}
```

---

### 3.3 `tier-cache` and `shared-cache` in-memory Maps are per-user/per-key and never bounded

- **Severity:** Medium
- **File:** `src/lib/tier-cache.ts`, `src/lib/shared-cache.ts`
- **Code reference:**
  - `tier-cache.ts:19` — `const tierCache = new Map<string, { tier; at }>();` keyed by `userId`, 60s TTL but **entries are never deleted** (only overwritten on refresh). With 500+ distinct users (and Clerk userIds for churned/trial users) this Map only grows.
  - `shared-cache.ts:3` — `const memory = new Map<string, MemoryEntry>();` the in-memory fallback Map is **never swept**; expired entries are checked on read but never evicted, and any key written when Redis is up *also* writes the memory copy (`shared-cache.ts:97`). Keys like `quote:{ticker}`, `nw:optmark:{occ}`, `server:{key}` accumulate.
- **Why it's a problem:** Both Maps grow with cardinality and never shrink. `tierCache` is bounded in practice by total distinct users (acceptable at 500, but unbounded over months of signups). `shared-cache.memory` is the riskier one: it mirrors every `sharedCacheSet`, including per-OCC option marks (`nw:optmark:`) and per-ticker quotes, with no cap and no sweep.
- **Impact (500 concurrent users):** Slow memory growth on long-lived replicas; `shared-cache.memory` can accumulate thousands of per-symbol keys over a session. Not an immediate crash, but it undermines the "memory is a fallback" assumption.
- **Recommended fix:** Bound both with the insertion-order LRU eviction pattern already proven in `server-cache.ts:39` (`setStoreEntry`) — cap size, sweep expired on write when at/over cap. For `tierCache`, also delete on a periodic sweep or cap to a few thousand entries.

---

### 3.4 `/api/market/quote` does not validate the `ticker` param before hitting paid upstream

- **Severity:** Medium
- **File:** `src/app/api/market/quote/route.ts`
- **Code reference:**
  - `quote/route.ts:136` — `const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();`
  - then `getRestQuote(ticker, ...)` → `fetchStockSnapshot(ticker)` (paid Massive call), no length/charset allowlist (contrast `ticker-search/route.ts:16` which *does* validate `q` with a regex + length cap and a comment explaining why).
- **Why it's a problem:** An authenticated user can pass an arbitrary-length / arbitrary-charset `ticker`, which is (a) forwarded to the paid upstream as a snapshot request and (b) used as a telemetry endpoint key (feeding §3.1's unbounded Map) and (c) used as a `quote:{ticker}` cache key. `quoteMem` is bounded (clears at 200, `quote/route.ts:109`), so memory is contained, but the upstream call and telemetry cardinality are not. The `ticker-search` route fixed exactly this class; `quote` did not.
- **Impact (500 concurrent users):** Cheap upstream/telemetry-pollution vector for any premium user; junk tickers waste paid Massive calls and inflate the admin dashboard.
- **Recommended fix:** Apply the same allowlist as `ticker-search`: `if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) return 400`.

---

### 3.5 `/api/market/flows` `since_hours` is unbounded → unbounded DB scan window

- **Severity:** Medium
- **File:** `src/app/api/market/flows/route.ts`
- **Code reference:**
  - `flows/route.ts:20` — `const since_hours = Number(sp.get("since_hours") ?? 168) || 168;`
  - `flows/route.ts:24` — cache key `flows:pg:${since_hours}:${min_premium ?? 0}:${ticker ?? "all"}`
- **Why it's a problem:** `since_hours` is parsed with no upper bound. A caller can pass `since_hours=10000000`, producing a query over the entire `flow_alerts` table (a high-volume, telemetry-grade table per `db-cleanup`'s purpose) and a distinct cache key per value. `limit` is correctly capped at 1000 (`flows/route.ts:17`), but the time window is not.
- **Impact (500 concurrent users):** A premium user can issue expensive wide-window scans and mint distinct `serverCache` keys (the cache is LRU-bounded at 5000 so memory is safe, but the underlying DB scan is not). Combined with §2.1's 5-connection pool, a few of these can saturate the pool.
- **Recommended fix:** Clamp: `const since_hours = Math.min(Math.max(Number(...) || 168, 1), 720);` (30-day ceiling) and ensure `idx_flow_alerts_created_at` (it exists, `db.ts:156`) covers the predicate.

---

### 3.6 SSE backpressure relies on a controller throw for `pulse/stream` rather than the `desiredSize` predicate

- **Severity:** Medium
- **File:** `src/app/api/market/spx/pulse/stream/route.ts`
- **Code reference:** `pulse/stream/route.ts:44-72` — `send()` enqueues directly and only tears down when `controller.enqueue` throws; it never checks `sseBackpressureExceeded(controller.desiredSize)` the way `flows/stream/route.ts:47` and `admin/apis/stream/route.ts:45` do.
- **Why it's a problem:** A slow client (mobile on a poor connection) lets the controller's internal queue grow at 4 Hz; Node won't throw on enqueue until the stream errors, so the queue can buffer well beyond the 64-chunk slack the project standardized on. The other two streams proactively drop laggards; pulse does not.
- **Impact (500 concurrent users):** Per-connection unbounded buffering for slow consumers → memory growth and head-of-line latency under a flaky-network cohort.
- **Recommended fix:** Add the `if (sseBackpressureExceeded(controller.desiredSize)) { controller.close(); cleanup(); return; }` guard at the top of `send()`, matching the other streams. (This pairs naturally with the §2.3 rewrite.)

---

### 3.7 Largo non-stream branch holds a server worker up to 120s; admin SSE stream has no connection cap

- **Severity:** Medium
- **File:** `src/app/api/market/largo/query/route.ts`, `src/app/api/admin/apis/stream/route.ts`
- **Code reference:**
  - `largo/query/route.ts:98` — `export const maxDuration = 120;` and the non-stream branch `await runLargoQuery(...)` (line 225) holds the request open for the full Anthropic tool loop.
  - `admin/apis/stream/route.ts` — has `closed`/backpressure/heartbeat but **no `activeStreams`/`MAX_STREAMS`** cap (unlike the two market streams).
- **Why it's a problem:** Largo is correctly gated (2 concurrent/user via `acquireLargoSlot`, daily budget via `recordLargoBudgetUsage`), so the blast radius is capped — but the *non-stream* path still ties up a serverless/Node worker for up to 2 minutes each. The admin stream's missing cap is low-risk (admin-only) but inconsistent with the codebase's own pattern.
- **Impact (500 concurrent users):** Largo concurrency is bounded per-user but not globally; 250 users each running 2 long queries could occupy many workers for 120s. The admin gap is minor.
- **Recommended fix:** Add a global Largo in-flight ceiling (Redis counter) in addition to the per-user gate; add `MAX_STREAMS` to the admin stream for consistency. Prefer the streaming branch (it already exists and frees the worker incrementally).

---

## 4. Low findings

### 4.1 `quote`/`flows` cache keys are user-influenced but bounded — documented, not a bug
`server-cache.store` is LRU-capped at 5000 (`server-cache.ts:31`), so user-controlled keys (`search:`, `flows:`, `quote:`) cannot grow it unbounded. This is a *correct* defense; noting it so a future refactor doesn't remove the cap. (Severity: Low / informational.)

### 4.2 `maybeRunFlowIngest` check-then-set on `ingestInFlight` is not atomic
- **File:** `src/lib/providers/flow-ingest.ts:123-139`. The `if (ingestInFlight) return ingestInFlight;` then assignment is not atomic across microtasks, so two near-simultaneous lazy triggers could both start `runFlowIngest()`. **Mitigated** by the `pg_try_advisory_lock` inside `runFlowIngest` (`flow-ingest.ts:55`) and by `alert_id UNIQUE`, so the worst case is one wasted UW call. (Severity: Low.)

### 4.3 `withServerCache` SWR can serve up to `MAX_STALE_AGE_MS` (10 min) stale on a dead upstream
- **File:** `src/lib/server-cache.ts:135-143`. By design (degradation tracking flags it after 3 failures), but for live market data a 10-minute stale window is long. Confirm per-key TTLs and the degraded-key UI surfacing are acceptable for trading data. (Severity: Low.)

### 4.4 `engine.ts` allowlist + `engine/[...path]` allowlist are duplicated
- **Files:** `engine.ts:28` (`ALLOWED_PREFIXES`) and `engine/[...path]/route.ts:12` (`ALLOWED_ENGINE_PATHS`). Two independent allowlists guard the same proxy; a future path added to one but not the other will silently 404/400. Consolidate to one source of truth. (Severity: Low.)

### 4.5 Whop webhook returns 200 on missing secret (intentional) but silently drops membership changes
- **File:** `webhook/whop/route.ts:31-59`. Returning 200 to avoid Whop retry storms is defensible and is loudly alerted via Discord + telemetry, but **membership changes are lost** until the env var is set. The `membership-reconcile` cron (every 6h) is the safety net. Ensure `WHOP_WEBHOOK_SECRET` is set at launch and the reconcile cron is actually firing. (Severity: Low — operational.)

### 4.6 `personal-alert-fanout` recipient source is a stub returning `[]`
- **File:** `src/lib/personal-alert-fanout.ts:29`. Inert by design (scaffold), but if activated naively it warns against enumerating all Clerk users on the alert path — heed that comment; a per-alert Clerk enumeration would be a hard scaling failure. (Severity: Low — future risk.)

---

## 5. What is already done well (so it isn't "fixed" away)

- **UW 2 RPS cluster ceiling is real and correct.** `uw-rate-limiter.ts` combines a local token bucket, a Redis Lua **atomic** sliding-window check-and-increment (`RATE_LIMIT_LUA`, `uw-rate-limiter.ts:151`), in-flight coalescing (`throttleUwCoalesced`), and a cluster-wide circuit breaker broadcast over Redis pub/sub with a poison-clamp (`mergeBreakerOpenUntil`). This is the single most important piece for staying under UW's hard limit and it is solid.
- **Per-user cache-reader rule holds.** `nights-watch/enrichment.ts` fetches each distinct `(underlying, expiry)` chain exactly once per request via single-flight `getNwChain`, resolves desk context once, and matches strikes in-memory — O(distinct chains), never per-user upstream. The `nights-watch-warm` cron pre-warms those chains so user GETs are pure cache hits. The options WS subscribes to the *union* of held contracts (one app-wide pool), giving real-time marks at zero marginal per-user cost.
- **`server-cache.ts`** is a genuinely good single-flight + SWR + Redis-layer cache with LRU bounding and degradation tracking.
- **Graceful shutdown** is wired for all three data sockets (SIGTERM → 1000-close) so old Railway containers release upstream slots — important for rolling deploys not colliding with UW/Massive connection limits.
- **Auth self-guarding is explicit and well-documented** in `middleware.ts` (every `/api` route authorizes itself; the matcher does not protect API routes). Cron auth uses constant-time compare. SSRF is guarded in `engine.ts` and the engine proxy. Per-user position ownership always comes from Clerk `auth()`, never the client body.
- **Migrations are advisory-locked on a dedicated client** (`db.ts:127`) so concurrent cold-start replicas serialize correctly.

---

## 6. Launch blockers (must-fix before 500 concurrent)

1. **Verify + size the Postgres pool** (§2.1). Confirm PgBouncer is deployed in transaction mode and set `PG_POOL_MAX` accordingly. `max:5` with `ensureSchema` fronting every query is the top DB risk.
2. **Cap + heartbeat `/api/market/live` and make `spxBroadcaster` reconnect forever** (§2.2). The permanent give-up after 10 reconnects is a silent total-outage bug; the missing connection cap is a DoS amplifier.
3. **Stop the per-connection 250 ms Redis GET in the pulse stream** (§2.3). Read in-memory `indexStore` (or one shared poller); 2,000 GETs/sec/instance for in-memory data will not scale.

## 7. Strongly recommended (fix soon after launch)

4. Bound `endpointStats` / normalize telemetry endpoint keys (§3.1) — slow memory leak.
5. Add a stall watchdog + heartbeat to `polygon-socket.ts` (§3.2) — silent stale-price risk on the core index feed.
6. Bound `tier-cache` and `shared-cache.memory` Maps (§3.3).
7. Validate `quote` ticker (§3.4) and clamp `flows.since_hours` (§3.5); add backpressure to the pulse stream (§3.6).

---

### Severity counts
- **Critical:** 0
- **High:** 3 (Postgres pool sizing/`ensureSchema`; `/api/market/live` cap+broadcaster give-up; pulse per-connection Redis GET)
- **Medium:** 7 (telemetry Map leak; polygon-socket no watchdog; tier/shared-cache unbounded Maps; quote ticker validation; flows since_hours; pulse backpressure; Largo non-stream duration / admin stream cap)
- **Low:** 6
