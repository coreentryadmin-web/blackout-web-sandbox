# 09 — SCALABILITY AUDIT (Deliverable K)

**Target:** scale from <10 users today to **~500 CONCURRENT active users** on the BLACKOUT trading-intelligence platform.
**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Stack verified from code:** Next.js `14.2.35` App Router, React 18, `@clerk/nextjs ^5.7.6`, Whop `@whop/sdk 0.0.40`, `pg 8.21.0`, `ioredis 5.11.1`, `@anthropic-ai/sdk ^0.105.0`, `ws ^8.18.0`, Railway deploy (`package.json:23-40`). Crons run as **separate single-replica Railway trigger services** (`railway.*.toml`) that hit `/api/cron/*` via `scripts/hit-cron.mjs`. The web app boots the UW/Polygon/options WebSockets in-process via `ensureDataSockets()` (`src/lib/ws/init-data-sockets.ts:44`).

**Method:** READ-ONLY. Every finding is grounded in a file:line reference I read. Where a number depends on prod/env (replica count, PgBouncer presence, actual concurrency) I label it **Not verified — needs X** and never invent.

---

## A. Architecture facts that drive every scaling conclusion

These are the load-bearing facts. Re-read them before any conclusion below.

| Fact | Evidence | Why it matters at 500 concurrent |
|---|---|---|
| **Replica count of the web service is NOT pinned in code.** Only the 10 cron services set `numReplicas = 1`. `railway.toml` (the web app) has no `numReplicas`. | `railway.toml:1-9` (no replica key); `grep numReplicas *.toml` → only cron tomls. | Replica count is dashboard-controlled. **Almost every per-process safety (rate-limit fallback, AI-spend tripwire, in-memory caches, WS connections) is per-replica.** If the dashboard scales the web service to N>1 to absorb 500 users, several invariants silently break (see C, D, K). **Not verified — needs prod replica count.** |
| **In-memory caches are per-replica.** `server-cache.ts` `store` Map; `shared-cache.ts` `memory` Map; WS stores (`tideStore`, `gexStore`, …). | `server-cache.ts:22`, `shared-cache.ts:3`, `uw-socket.ts:457-491` | Redis is the only cross-replica layer. With Redis healthy, cross-replica coherence holds; with Redis down everything degrades to N independent in-memory copies, and the UW global ceiling disappears (D.1). |
| **The cache-reader rule is real and mostly honored.** Per-user features read shared caches, not per-user upstream. | `enrichment.ts:1-84`, `chain-cache.ts:30-37`, `quote/route.ts:60-111`, `spx-desk-loader.ts:24-31` | This is the single biggest reason 500 users is feasible at all on a UW 2-RPS ceiling. The risk is in the few paths that do NOT obey it and in the shared-resource contention the rule creates downstream (DB pool, Redis, telemetry). |
| **One un-batched Postgres INSERT per upstream API call** (telemetry). | `api-telemetry-persist.ts:6-46`, `api-telemetry.ts:241` | Becomes the dominant write load and the largest table — competes with user reads for a **pool of 5** (B.1, F.1). |
| **Postgres pool `max` defaults to 5 per replica**; PgBouncer is *assumed*, not provisioned in-repo. | `db.ts:91-96` (`PG_POOL_MAX ?? "5"`), comment `db.ts:88-90` | If PgBouncer is absent, 5 is the hard concurrency ceiling per replica against Postgres directly (F.1). |
| **Crons are isolated single-replica trigger services**, so cron fan-out does NOT multiply with replicas. | all `railway.*.toml` `numReplicas = 1`, `restartPolicyType="never"` | Good: cron amplification is bounded. The risk is cron + per-request UW reads sharing the same 2-RPS bucket (D.2). |

---

## B. Per-area inventory (breaking points at a glance)

| # | Area | Breaking point (first thing that fails) | Severity |
|---|---|---|---|
| C.1 | External API — UW 2 RPS | UW global bucket fail-opens when Redis is degraded → 2 RPS × N replicas → 429 storm → circuit breaker | **High** |
| C.2 | External API — UW cron contention | `uw-cache-refresh` (~26 tasks) + `flow-ingest` share the 2-RPS bucket; ~13s drain every 2 min starves per-request UW reads | **Medium** |
| C.3 | External API — Polygon | Permissive 40 RPS local / 40 RPS global; headroom is large but fail-open same as UW | **Low** |
| C.4 | Anthropic spend | `SpendTracker` tripwire is per-replica; true org spend = N× threshold; Largo budget fail-opens on Redis loss | **High** |
| F.1 | Postgres pool | Pool max 5/replica; held advisory-lock clients + telemetry inserts + reads → 15s queue → 503 | **Critical** |
| F.2 | Postgres write volume | One INSERT per upstream call, no batching/sampling; millions of rows/day | **High** |
| F.3 | Postgres migrations | Lazy `ensureSchema` + pool-nuke-on-error → deploy/restart thundering herd | **High** |
| G.1 | Redis load | Single ioredis client per module per replica; rate-limit Lua + cache + SSE GET-loops all on one Redis | **Medium** |
| H.1 | SSE / real-time | Each SSE stream holds a 250ms Redis-GET timer; capped 500/instance → 503 beyond cap | **High** |
| H.2 | Client poll cadence | 3s pulse embed + 5s Night's Watch + 1.5s quote polls × 500 = high request rate to the web tier | **Medium** |
| I.1 | Frontend render | `fetchRecentFlows` returns up to 5000 rows; `FlowFeed` renders/sorts large arrays each poll | **Medium** |
| J.1 | Backend CPU/mem | WS stores + per-request desk merge; in-memory Maps bounded; per-replica socket CPU | **Low** |
| K.1 | Cron amplification | Bounded (single-replica), but no in-flight guard on `uw-cache-refresh` overlap with web reads | **Low** |
| L.1 | Cold starts | Lazy schema/pool build on first request after deploy; SSE/WS reconnect storms on rolling deploy | **Medium** |
| M.1 | Failure cascades | Redis-down → UW ceiling off + AI budget off + Largo gate off simultaneously | **High** |

---

## C. External API rate-limit exposure

### C.1 — UW global rate-limit ceiling FAILS OPEN; with N replicas this blows the hard 2-RPS cluster cap
- **Severity:** High
- **File:** `src/lib/providers/uw-rate-limiter.ts`
- **Code reference:** `uw-rate-limiter.ts:168-195`
  ```ts
  async function acquireGlobalRedisSlot(): Promise<boolean> {
    const client = await getSharedRedis();
    if (!client) return true;          // no Redis → no global ceiling
    ...
    } catch {
      return true;                     // FAIL-OPEN on any Redis error
    }
  }
  ```
  And the per-process pacing: `const MAX_RPS = envNumber("UW_MAX_RPS", 2)` (`uw-rate-limiter.ts:12`).
- **Why it's a problem:** The cluster-wide UW ceiling is enforced ONLY through Redis (`blackout:uw:rps:<sec>` sliding-window Lua, `uw-rate-limiter.ts:151-166`). When `REDIS_URL` is unset, Redis is unreachable, or the `eval` throws, `acquireGlobalRedisSlot()` returns `true` and each replica falls back to its **own local 2-RPS token bucket**. UW's documented hard limit is **2 RPS cluster-wide**, not per replica.
- **Impact (500 concurrent):** Under a 500-user load spike Redis is most likely to be stressed exactly when fan-out peaks. If it degrades, every web replica paces at 2 RPS locally → **2 × N RPS** hits UW. With even 2 replicas that is 4 RPS, doubling the hard cap → sustained 429s → the reactive breaker trips for 45s (`CIRCUIT_PAUSE_MS`, `uw-rate-limiter.ts:18`) → UW-backed panels (tide, dark pool, net flow, flow-per-strike) go stale platform-wide.
- **Recommended fix:** Set `UW_MAX_RPS = ceil(2 / expected_replica_count)` via env so the Redis-down fallback still respects the cluster cap. Add a metric/alert when `acquireGlobalRedisSlot` has been failing-open (catch at `:192`). Consider a brief local cooldown when Redis is unavailable instead of unbounded local pacing.
- **Example change:** In Railway web service env: `UW_MAX_RPS=1` if running 2 replicas, `UW_MAX_RPS=1` and accept slight under-utilization for 3+; keep `UW_GLOBAL_MAX_RPS=2`.

### C.2 — `uw-cache-refresh` cron (~26 serialized UW tasks) contends with `flow-ingest` and per-request UW reads on the single 2-RPS bucket
- **Severity:** Medium
- **File:** `src/app/api/cron/uw-cache-refresh/route.ts`
- **Code reference:** `uw-cache-refresh/route.ts:42-102` builds ~26 tasks (market tide + 5 sectors + dark pool + movers + top-net-impact + congress + 4 index tickers × 3 endpoints + 2 flow-per-strike) then `Promise.allSettled(tasks.map((fn) => fn()))`. Every task funnels through `throttleUw` → the 2-RPS bucket.
- **Why it's a problem:** All ~26 tasks fire concurrently but serialize behind the global 2-RPS slot → ~**13 seconds** of continuous UW saturation per run, every 2 minutes (`cronSchedule = "*/2 11-21 * * 1-5"`, `railway.uw-cache-refresh.toml`). `flow-ingest` runs on the SAME `*/2` cadence (`railway.flow-ingest.toml`). During those overlapping windows, any *per-request* UW read (e.g. a ticker the warm cron doesn't pre-warm) queues behind the cron's backlog.
- **Impact (500 concurrent):** The pre-warm design means most user UW reads are Redis hits (good — see `quote`/`gex-heatmap` caching), so this is Medium not High. But a cache miss on a non-pre-warmed ticker during the 13s cron drain can see multi-second latency or a 429. The cron runs on a separate single-replica service, so it does NOT multiply with web replicas (bounded).
- **Recommended fix:** Stagger the two `*/2` crons (offset `flow-ingest` to `1-59/2`), and/or add a small priority lane so interactive per-request UW reads preempt the bulk warm. Confirm the warm set covers every ticker a user can reach (Night's Watch lets users add arbitrary tickers — `account/positions/route.ts:60`).

### C.3 — Polygon limiter is permissive (40 RPS) with large headroom; fail-open is the only residual risk
- **Severity:** Low
- **File:** `src/lib/providers/polygon-rate-limiter.ts`
- **Code reference:** `polygon-rate-limiter.ts:32-35` (`MAX_RPS=40`, `GLOBAL_MAX_RPS=40`, `MAX_CONCURRENCY=24`); single funnel `polygonTrackedFetch` (`:325-347`); fail-open `:174,194`.
- **Why it's a problem:** Same fail-open shape as UW, but Polygon Advanced/Massive is high-throughput so there's no hard 2-RPS cliff. Quote (`quote/route.ts`, 2s Redis TTL), GEX (`gex-heatmap/route.ts`, 30s TTL), and the NW chain (`chain-cache.ts`, 30s TTL) are all cache-fronted, so steady-state Polygon RPS stays far under 40 even at 500 users.
- **Impact (500 concurrent):** Minimal. The `NightsWatchPanel` comment claims "actual Polygon stays <0.2 rps cluster-wide" (`NightsWatchPanel.tsx:30`) which is plausible given the 30s shared chain cache. Risk is only a correlated cache-stampede after a Redis flush.
- **Recommended fix:** Keep as-is. Optionally set `POLYGON_MAX_RPS` to `ceil(40/replicas)` for symmetry with the UW fix, and alert on Polygon fail-open.

### C.4 — Anthropic spend tripwire is PER-REPLICA; Largo per-user budget FAILS OPEN on Redis loss
- **Severity:** High
- **File:** `src/lib/ai-spend.ts`, `src/app/api/market/largo/query/route.ts`
- **Code reference:**
  - `ai-spend.ts:6-9` — explicit caveat: *"the running total is PER PROCESS… the true org-wide daily total is the SUM across replicas."* `SpendTracker` default threshold `$50` (`ai-spend.ts:110`).
  - `largo/query/route.ts:75-84` — `isLargoBudgetExceeded` returns `false` (allow) on `!redis` or any Redis error; `acquireLargoSlot` also fails open (`:35,46`).
- **Why it's a problem:** Two layers of cost control both weaken under the exact conditions that accompany a 500-user surge. The global spend tripwire only alerts per replica, so the org-wide spend can reach N×$50 before anyone is paged. The per-user daily Largo budget and the max-2-concurrent gate both fail open when Redis is unavailable, so during a Redis outage a user (or a script) can run unbounded concurrent Claude tool-loops.
- **Impact (500 concurrent):** Largo is the only user-driven Claude path (`largo/query/route.ts:225`), gated to `premium` tier (`:107`). Each query is itself bounded by `anthropicToolLoop` max-rounds × max-tokens (per the route comment `:66-67`), so a single query is capped — but **concurrency** and **daily count** are the cost levers, and both fail open. At 500 premium users a Redis blip can produce a sharp, unalerted Anthropic bill spike. Night Hawk's Claude pipeline is cron-bounded (single replica) so it's not the exposure here.
- **Recommended fix:** (1) Make the spend tripwire cross-replica: accumulate the daily total in Redis/Postgres (`INCRBYFLOAT blackout:ai:spend:<etday>`) and alert on the org total. (2) For the Largo gates, fail **closed** above a hard ceiling (or use a short local in-memory counter as a backstop when Redis is down) so a Redis outage cannot uncork unlimited concurrent Claude calls. (3) Add an absolute org-wide daily Anthropic kill-switch.

---

## D. Failure-cascade view of the rate limiters (cross-cutting)

### M.1 — A single Redis outage simultaneously removes the UW ceiling, the AI-spend cap, AND the Largo gate
- **Severity:** High
- **Files:** `uw-rate-limiter.ts`, `polygon-rate-limiter.ts`, `largo/query/route.ts`, `ai-spend.ts`, `shared-cache.ts`
- **Code reference:** All fail-open on Redis loss: `uw-rate-limiter.ts:192`, `polygon-rate-limiter.ts:194`, `largo/query/route.ts:35,46,82`, plus `shared-cache.ts:25` (30s backoff before retry) and `server-cache.ts:114-123` (Redis read best-effort).
- **Why it's a problem:** The design choice "fail open so the app keeps working" is locally reasonable but **globally correlated** — one dependency (Redis) failing flips every protective ceiling off at once, precisely during the high-load event most likely to have caused the Redis stress. The in-memory cache fallbacks (`shared-cache.ts:59`, `server-cache.ts`) keep serving, which *masks* the outage from users while upstream costs/limits blow out invisibly.
- **Impact (500 concurrent):** Worst-case sequence: load spike → Redis saturates → UW limiter local-only (2×N RPS → 429 → breaker) + AI budget off (cost spike) + Largo concurrency uncapped + per-replica caches diverge. The platform appears "up" while UW data goes stale and the Anthropic bill climbs, with the only signal being per-replica console warns.
- **Recommended fix:** Add a single "Redis degraded" health signal (the limiters already track `sharedRedisFailedAt`, `uw-rate-limiter.ts:96`) wired into the admin critical-alerts/Discord path, and switch the cost-sensitive gates (AI budget, Largo concurrency) to fail-closed-with-conservative-local-fallback rather than fully open.

---

## E. (reserved)

---

## F. Postgres load & pool exhaustion

### F.1 — Postgres pool `max = 5` per replica; long-held advisory-lock clients can starve request traffic → 15s queue → 503
- **Severity:** Critical
- **File:** `src/lib/db.ts`
- **Code reference:**
  - `db.ts:91-96` — `max: parseInt(process.env.PG_POOL_MAX ?? "5", 10)`, `connectionTimeoutMillis: 15_000`.
  - `db.ts:88-90` — comment asserts PgBouncer "handles real connection pooling" (an **infra assumption**; nothing in-repo provisions it).
  - Held-connection paths that subtract from the 5: `runMigrations` holds one for the whole migration (`db.ts:133`), `insertOpenSpxPlay` holds one across BEGIN…COMMIT (`db.ts:1106-1152`), and `heldLockClients` pins one connection **per held advisory lock** for the lock's entire lifetime (`db.ts:693-710`) — including the long-lived `spx-eval` lock (`db.ts:765-768`).
- **Why it's a problem:** If PgBouncer is NOT actually in the Railway topology, 5 is the hard concurrent-query ceiling per replica directly against Postgres. With the SPX-eval lock held (1 connection pinned for the whole evaluation) plus a migration or play-open txn in flight, a replica can be down to **2-3 usable connections** while serving 500 users' positions/journal/largo reads + telemetry/cron inserts.
- **Impact (500 concurrent):** A burst that needs >5 concurrent queries on a replica makes `pool.connect()` queue up to **15 seconds** (`connectionTimeoutMillis`) then throw → user sees a hang then a 502/503. `getDatabasePoolStats` exposes `waitingCount` (`db.ts:682`) but nothing acts on it (F.4). This is the **most likely first hard failure** of the whole system at 500 concurrent if PgBouncer is absent. **Not verified — needs prod: PgBouncer presence + `waitingCount` metric.**
- **Recommended fix:** (1) **Confirm PgBouncer.** If absent, set `PG_POOL_MAX` deliberately, sized as `floor(postgres_max_connections / replica_count) - headroom` (e.g. 10-20). (2) Move long-lived advisory locks (`spx-eval`, migration) onto a **dedicated connection created outside the request pool**, so they never subtract from request capacity. (3) Lower `connectionTimeoutMillis` to 3-5s so a saturated pool sheds load fast instead of stacking 15s waits.

### F.2 — One un-batched INSERT per upstream API call (telemetry) is the dominant write load and largest table
- **Severity:** High
- **File:** `src/lib/api-telemetry-persist.ts`, `src/lib/api-telemetry.ts`
- **Code reference:** `api-telemetry-persist.ts:12-42` — a single `INSERT … ON CONFLICT (event_id) DO NOTHING` per event, via `dbQuery` (one pooled connection per call). `api-telemetry.ts:241` fires `persistApiTelemetryEvent(event)` with **no sampling gate** on the persist path (the `MAX_SAMPLES=100` at `api-telemetry.ts:59` only bounds the in-memory latency-percentile window, not DB writes).
- **Why it's a problem:** Every Polygon/UW/Anthropic fetch made by crons, the desk loader, the warm loops, and per-request paths writes one row. Volume scales with **upstream-call volume**, which the cache-reader rule keeps roughly constant per TTL window — but the warm crons (every 2 min), desk pulse builds, and 500 users' Largo tool-calls still multiply it. Each INSERT also checks the `event_id` UNIQUE index (`db.ts:478-481`) which grows large.
- **Impact (500 concurrent):** Expect **hundreds of thousands to low-millions of INSERTs/day**, each consuming a slot from the pool of 5 (F.1) and competing directly with user reads. Retention is ≥90 days floor (`db-cleanup-targets.ts:cleanupRetentionDays floorDays=90`), so the table holds many millions of rows; index bloat slows both the ON-CONFLICT check and the admin telemetry reads.
- **Recommended fix:** (1) **Batch** telemetry inserts (buffer in-process, flush every N rows / M ms with a multi-row INSERT) to collapse round-trips. (2) **Sample** non-error events (persist all errors/SLA-breaches, sample 1-in-K successes). (3) Consider a dedicated low-priority pool or async fire-and-forget queue so telemetry never competes with user reads for the 5 connections.

### F.3 — Lazy `ensureSchema()` + pool-nuke-on-error → deploy/restart thundering herd
- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:624-635` — `ensureSchema()` memoizes one `runMigrations()` promise but on ANY error does `schemaReady = null; pool = null; poolInit = null; throw`. `runMigrations` runs ~30 DDL statements + a `LOCK TABLE spx_signal_log … DELETE` dedup (`db.ts:199-218`) inside advisory lock 42 (`db.ts:137`), with a 30s statement timeout on the lock wait.
- **Why it's a problem:** Schema setup is triggered lazily on the first query, not at boot. On a Railway rolling deploy, N replicas boot and each blocks on lock 42; the first runs all DDL, the rest wait up to 30s. If the DB is momentarily slow and one statement errors, the cached promise is nulled **and the pool is discarded**, so the next request rebuilds the pool and re-runs the entire migration — a thundering herd exactly when the DB is stressed.
- **Impact (500 concurrent):** During every deploy, requests arriving in the 30s migration window queue on `ensureSchema()`. A transient DB hiccup during a deploy can cascade: every in-flight request re-triggers full migration + pool recreation, amplifying load and lengthening the outage. Routine Railway rolling deploys are the trigger.
- **Recommended fix:** (1) Run migrations once at **boot** (in `instrumentation.ts` register, gated to nodejs) and have query functions assume schema-ready. (2) On `ensureSchema` failure, reset only `schemaReady` — do **not** nuke the working pool. (3) Guard the `LOCK TABLE`/dedup behind a `platform_meta` migration-version flag so it runs once ever, not on every cold start.

### F.4 — No pool-saturation backpressure or alerting; `waitingCount` is exposed but unused
- **Severity:** Medium
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:667-687` returns `{ total, idle, waiting }` but nothing reads `waiting`. `dbQuery` (`db.ts:637-643`) just awaits `pool.query`, which queues up to `connectionTimeoutMillis = 15_000` before throwing.
- **Why it's a problem:** When the pool saturates (F.1) requests silently queue for up to 15s then fail — no fast-fail, no shedding, no alert tied to `waitingCount`.
- **Impact (500 concurrent):** A burst over 5 connections/replica produces a wave of 15s-latency requests then timeouts, with no early operational signal — users see hangs, not clean errors.
- **Recommended fix:** Wire `getDatabasePoolStats().waiting` into the admin critical-alerts/cron-health path; lower `connectionTimeoutMillis` to 3-5s to shed load instead of stacking 15s waits.

### F.5 — Hot read `fetchRecentFlows` returns up to 5000 JSONB-heavy rows, sorted by premium, uncached at the DB layer
- **Severity:** Medium
- **File:** `src/lib/db.ts`, fronted by `src/app/api/market/flows/route.ts`
- **Code reference:** `db.ts:796-897` — `LIMIT $i` defaults to `5000` (`db.ts:822`), 48h window, `ORDER BY COALESCE(total_premium,0) DESC`, with multiple `raw_payload->>'…'::numeric` JSONB extractions per row. The flows route DOES wrap it in `serverCache(cacheKey, TTL.DARK_POOL=30s)` (`flows/route.ts:26,54`) — **this corrects the Phase-1 "Not verified — needs the flows route" note: caching IS present.**
- **Why it's a problem:** Even cached at 30s, each cache-miss refresh runs a 5000-row sort + per-row JSONB parse against `flow_alerts`, the table simultaneously receiving the highest insert volume (UW WS flow alerts). The in-flight dedup (`server-cache.ts:23`) collapses concurrent callers to one query per TTL, which is what makes 500 users survivable — but the per-refresh cost itself is heavy.
- **Impact (500 concurrent):** With caching, steady-state is one heavy query per 30s window regardless of user count (good). Residual risk: cache miss + insert pressure together, and the large JSON payload serialized to 500 clients (frontend cost, I.1).
- **Recommended fix:** Lower the default `LIMIT` (the UI slices `alerts.slice(0,500)` anyway — `FlowFeed.tsx:157`), or push the premium-sort + top-N into SQL with a covering index, and pre-compute the displayed columns to avoid per-row JSONB parsing on every refresh.

---

## G. Redis memory & load

### G.1 — All cross-replica state funnels through Redis; one client per module per replica, several hot loops
- **Severity:** Medium
- **File:** `src/lib/make-redis.ts` + every caller
- **Code reference:** `make-redis.ts:41-60` builds one connected ioredis client per `(module,label)`; callers: shared-cache, redis-pubsub (pub + sub), uw-shared-cache, uw-rate-limiter, polygon-rate-limiter, api-telemetry-redis, membership-sync-limit, Largo gate (`largo/query/route.ts:34`). The rate-limit Lua runs **once per gated upstream call** (`uw-rate-limiter.ts:182`, `polygon-rate-limiter.ts:183`); SSE streams run a **Redis GET every 250ms per connection** (`pulse/stream/route.ts` send loop).
- **Why it's a problem:** Redis is the lynchpin: rate-limit gating, shared cache L2, SSE snapshot reads, Largo concurrency/budget, telemetry cross-replica, membership sync. The sliding-window keys are correctly short-TTL (`blackout:uw:rps:<sec>` TTL 3s — bounded memory, good). But the **op rate** is high: every UW/Polygon call = 1 EVAL; every SSE client = 4 GET/sec; the warm crons write dozens of cache keys per run.
- **Impact (500 concurrent):** Memory is bounded (short TTLs + `EX` on cache sets, `shared-cache.ts:103`). **Op/connection load** is the risk: 500 SSE pulse clients alone = 2000 Redis GET/sec; add rate-limit EVALs and cache reads. A single small Railway Redis can become the cluster bottleneck, and if it slows, the fail-open cascade (M.1) fires. **Not verified — needs prod Redis sizing + ops/sec.**
- **Recommended fix:** (1) Have SSE streams subscribe to a Redis **pub/sub** fan-out (one subscriber per replica) instead of each connection polling GET every 250ms — collapses 2000 GET/sec to a handful. (2) Size Redis for the EVAL+GET rate, not just memory. (3) Confirm `maxRetriesPerRequest: 1` (`make-redis.ts:49`) is intended — it fails fast (good for not blocking the event loop) but accelerates fail-open under load.

---

## H. WebSocket / real-time pressure

### H.1 — SSE streams hold one 250ms Redis-GET timer each; capped at 500/instance then hard 503
- **Severity:** High
- **File:** `src/app/api/market/spx/pulse/stream/route.ts` (mirrored by `flows/stream`, `admin/apis/stream`)
- **Code reference:** `pulse/stream/route.ts:14-22` — `MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 500)`; beyond it returns `503 Too many active streams`. Each stream's `send` runs on an interval issuing a Redis GET (`getUwCacheRedis().get("spx:pulse:snapshot")`).
- **Why it's a problem:** The cap is **per instance**. 500 concurrent users on the SPX desk/pulse is exactly the target, so a single web replica is at the cap with zero headroom — the 501st SSE connection 503s. Each connection also holds an open fd + a 250ms timer + a Redis round-trip, so 500 streams = 500 fds + 2000 Redis GET/sec on one replica (ties to G.1).
- **Impact (500 concurrent):** If the web service runs a **single replica** (default, A), the SSE pulse stream caps out at exactly the launch target and rejects further users with a 503 — a launch blocker for the live desk. The `LiveMarketPulse` embed polls `spx-merged-pulse` at **3s** (`embeds/LiveMarketPulse.tsx:45`) and the pulse/stream SSE is the live path; both converge on this instance.
- **Recommended fix:** (1) Run ≥2 web replicas (but then re-apply the per-replica fixes in C/D) and/or raise `SSE_MAX_STREAMS` with fd-limit headroom. (2) Replace the per-connection 250ms GET loop with a single Redis pub/sub subscriber per replica that pushes to all local SSE subscribers (G.1 fix). (3) Load-test SSE fan-out at 500+ before launch.

### H.2 — Client poll cadences are aggressive; at 500 users they generate a high request rate to the web tier
- **Severity:** Medium
- **File:** multiple components
- **Code reference (verified cadences):**
  - `embeds/LiveMarketPulse.tsx:45` — `refreshInterval: 3_000` (3s SPX pulse).
  - `desk/GexHeatmap.tsx:2131` — quote `refreshInterval: 1_500` (1.5s).
  - `desk/GexHeatmap.tsx:2117` — GEX heatmap `refreshInterval: 20_000`.
  - `nights-watch/NightsWatchPanel.tsx:31-32` — `POLL_FAST_MS = 5_000` (RTH), `POLL_SLOW_MS = 30_000`.
  - `FlowFeed.tsx:40` — `FLOW_POLL_MS = 30_000`.
  - `DarkPoolPanel.tsx:23` — `POLL_MS = 30_000`; `BenzingaNewsTicker` 60s; `NightHawkFeed` 120s.
- **Why it's a problem:** These are HTTP polls (SWR/`setInterval`), so 500 users on the desk each issue a 1.5s quote + 3s pulse + 5s positions request. The backends are cache-fronted (quote 2s Redis TTL `quote/route.ts:48`; positions a pure cache-reader `enrichment.ts`), so upstream cost is fine — but the **web-tier request rate** is large: 500 users × (1/1.5 + 1/3 + 1/5) ≈ **600 req/s** just from those three, plus Clerk auth on each (D? — auth runs per API request).
- **Impact (500 concurrent):** Each request still pays: middleware Clerk parse + `authorizeMarketDeskApi` + a cache read (often Redis) + JSON serialize. 600 req/s on a single replica with a 5-connection DB pool and shared Redis is tight; the quote/positions paths avoid DB on cache hit but auth + Redis are per-request. This is request-tier throughput pressure, not upstream-provider pressure.
- **Recommended fix:** (1) Prefer the existing SSE pulse stream over the 3s `LiveMarketPulse` poll for the live desk so one connection replaces 0.33 req/s × 500. (2) Consider widening the quote poll to 2-3s (it already has a 2s Redis TTL, so 1.5s polling can't be fresher than the cache). (3) Ensure `revalidateOnFocus:false` everywhere (it's set on quote `GexHeatmap.tsx:2131` but verify across panels) to avoid focus-storm bursts.

### H.3 — Upstream WS managers are correct singletons (per replica) — good, with one replica-multiplication caveat
- **Severity:** Low
- **File:** `src/lib/ws/uw-socket.ts`, `init-data-sockets.ts`, `options-socket.ts`
- **Code reference:** `uw-socket.ts:455` (`export const uwSocket = new UwSocketManager()` — one multiplex socket, all channels); `init-data-sockets.ts:44-66` (`ensureDataSockets` idempotent per process); options socket env-gated + sharded (`options-socket.ts:37` `OPTIONS_WS_ENABLED`, `:45,50` max 1000 symbols × 10 conns).
- **Why it's a problem:** Each is a per-process singleton — 500 users share ONE UW multiplex socket and ONE Polygon indices socket per replica (the correct design). The only caveat: with N web replicas, **each replica opens its own UW socket**. UW WS connection slots may be limited per account, and N replicas each ingesting flow alerts means the dedup/persist runs N times (idempotent via `ON CONFLICT`, `flow-persist`, so no dup rows, but N× the persist attempts).
- **Impact (500 concurrent):** Single replica: ideal. Multiple replicas: N UW sockets (verify UW account allows it) + N× idempotent persist attempts (wasteful but correct). Graceful shutdown releases slots on SIGTERM (`uw-socket.ts:363`, `init-data-sockets.ts:76`), avoiding the 1008 reconnect collision on rolling deploys (good).
- **Recommended fix:** If scaling web replicas, dedicate flow-alert ingestion to ONE process (the cron service already does `flow-ingest`; consider making the WS ingest single-owner too) so persist attempts don't multiply. Confirm UW account WS connection allowance vs replica count.

---

## I. Frontend render pressure

### I.1 — Large flow arrays sorted/rendered each poll on the client
- **Severity:** Medium
- **File:** `src/components/FlowFeed.tsx`
- **Code reference:** `FlowFeed.tsx:157` — `computeFlowStrikeStacks(alerts.slice(0, 500), …)` runs each render; the API can return up to 5000 rows (`db.ts:822`) which are transferred and held client-side; replay timers (`FlowFeed.tsx:385,399`) and a 30s poll (`:40`).
- **Why it's a problem:** Each of 500 users receives and processes a large alerts payload every 30s, recomputing strike stacks in the render path. Not a server scaling issue but a client-CPU/jank one, and the payload size multiplies egress bandwidth.
- **Impact (500 concurrent):** Per-user client cost (jank on low-end devices) + 500× the JSON egress every 30s. The server cache makes the data identical across users, so a CDN/edge cache could serve it once.
- **Recommended fix:** Cap the server `LIMIT` to ~500 (matches the UI slice), memoize `computeFlowStrikeStacks`, and consider an edge/CDN cache on the flows GET (it's already `serverCache`-backed and identical per user).

### I.2 — Admin dashboards poll on tight intervals (1-10s) — bounded to admins
- **Severity:** Low
- **File:** `src/components/admin/*`
- **Code reference:** `AdminCronDashboard.tsx:238` (10s), `AdminApiDashboard.tsx:125` (8s) + `:126` (120s probe), `AdminHealthBanner.tsx:24` (15s), `AdminSpxDashboard.tsx:921`, `AdminOperationsDashboard.tsx`.
- **Why it's a problem:** Several admin panels poll every few seconds and some endpoints do real work (cron health, telemetry aggregation). Bounded because only admins load them, but each tick can be DB-heavy.
- **Impact (500 concurrent):** Negligible vs the 500 end-users (admins are few). Worth noting only because admin endpoints touch the same pool-of-5.
- **Recommended fix:** None required for launch; ensure admin telemetry reads don't run unbounded scans that compete with user traffic during incidents.

---

## J. Backend CPU/mem & unbounded structures

### J.1 — In-memory Maps are bounded (good); residual unbounded growth is low-risk
- **Severity:** Low
- **File:** `src/lib/server-cache.ts`, `uw-socket.ts`
- **Code reference:** `server-cache.ts:31` — `MAX_ENTRIES = 5_000` with insertion-order eviction + opportunistic expired-sweep (`setStoreEntry`, `:39-60`) — a real DoS guard against user-controlled keys (e.g. ticker search). `tradingHaltsStore.halts` Map is pruned by age (`uw-socket.ts:512`, 30m max). `coalescedInflight` Map self-deletes on settle (`uw-rate-limiter.ts:316-318`).
- **Why it's a problem:** Mostly NOT a problem — these are the structures most likely to leak and they're all bounded. The one to watch: `failureCount`/`degradedKeys` Sets in `server-cache.ts:9-11` are only cleaned on successful refresh of that exact key (`:191-192`); a flood of distinct failing keys could accumulate, but they're tied to the same 5000-key universe.
- **Impact (500 concurrent):** Memory is bounded per replica. Per-request CPU (desk merge `spx-desk-loader.ts:24-31`, flow JSONB) is cache-deduped so it runs once per TTL, not per user.
- **Recommended fix:** Cap `failureCount`/`degradedKeys` to the same MAX_ENTRIES universe (delete tracking when the store key is evicted). Otherwise fine.

---

## K. Cron amplification

### K.1 — Cron fan-out is bounded (single-replica services) but has no overlap guard on the warm cron
- **Severity:** Low
- **File:** `railway.*.toml`, `uw-cache-refresh/route.ts`, `flow-ingest/route.ts`
- **Code reference:** all crons `numReplicas = 1`, `restartPolicyType = "never"`. `flow-ingest` HAS an in-flight guard (`flow-ingest/route.ts:13` — `if (ingestInFlight) … skip`). `uw-cache-refresh` does NOT — a slow run (UW backlog) could overlap the next `*/2` trigger.
- **Why it's a problem:** Because crons are single-replica, they do not multiply with web replicas (the key win — cron amplification is structurally bounded). The residual: `uw-cache-refresh`'s ~13s drain (C.2) is normally < 120s cadence, but a UW slowdown could push a run past 2 minutes and overlap, doubling the UW pressure for that window. SPX-evaluate is single-writer-locked (`db.ts:765`).
- **Impact (500 concurrent):** Minor. The single-replica isolation means the worst case is one overlapping warm run, not N×.
- **Recommended fix:** Add the same `inFlight` guard `uw-cache-refresh` that `flow-ingest` already has, so a slow run can't overlap the next trigger.

---

## L. Cold starts & deployment

### L.1 — Lazy schema/pool/socket init means first-request-after-deploy latency + reconnect storms on rolling deploys
- **Severity:** Medium
- **File:** `db.ts`, `init-data-sockets.ts`, `pulse/route.ts`
- **Code reference:** Schema/pool build lazily on first query (`db.ts:112-121,624-635`, F.3). Sockets boot on the first nodejs route that calls `ensureDataSockets()` (`pulse/route.ts` imports it; `init-data-sockets.ts:44`). Reconnect backoff exists (`uw-socket.ts:307` cap 30s; `spx-broadcaster.ts:70` exp backoff).
- **Why it's a problem:** On a Railway rolling deploy, the new replica's first user request pays: pool creation + 30-statement migration (under advisory lock) + WS connect/auth/join. Until sockets warm, WS-backed stores (`tideStore`, `gexStore`) are empty and panels read stale/empty until first data arrives. The graceful SIGTERM shutdown (`init-data-sockets.ts:76`) on the OLD container is what prevents the 1008 indices-reconnect collision — good, but it depends on Railway sending SIGTERM and the handler running.
- **Impact (500 concurrent):** During every deploy, a burst of first-requests hits cold schema/pool/socket init simultaneously across the new replica(s); combined with F.3's pool-nuke-on-error this can amplify. Users mid-session see a brief data gap until WS stores repopulate.
- **Recommended fix:** Warm schema + sockets at boot in `instrumentation.ts` (nodejs-gated) so the first user request is hot; keep the graceful-shutdown handler; add a readiness gate (`/api/ready` exists — `src/app/api/ready/`) that only reports ready once sockets have first data.

---

## M. Logging volume & cost spikes

### M.2 — `console.*` is the only log sink; warn/error volume scales with failures, no rate limiting on log lines
- **Severity:** Low
- **File:** widespread
- **Code reference:** e.g. per-failure logs in `server-cache.ts:202`, `uw-rate-limiter.ts:249,284`, `polygon-rate-limiter.ts:257,289`, telemetry warn `api-telemetry-persist.ts:44`. Rate-limit summaries ARE aggregated to once/60s (`uw-rate-limiter.ts:246-253`) — good.
- **Why it's a problem:** Under a failure cascade (M.1) every replica emits per-key/per-call warns. The rate-limit path is summarized (good), but cache-degradation (`server-cache.ts:202`) and telemetry-persist failures log per occurrence. Railway log ingestion has cost/volume limits.
- **Impact (500 concurrent):** A correlated failure (Redis down, DB slow) can produce a log flood across replicas, raising log-egress cost and making the real signal hard to find. Not a stability risk.
- **Recommended fix:** Route through a leveled logger with per-message rate-limiting; the durable error sink (`error-sink.ts`, fed by `instrumentation.ts:64`) already de-dups to Postgres — prefer it over raw console for high-frequency failures.

### M.3 — Cost-spike summary (the three uncapped-at-cluster-scale levers)
- **Severity:** High (aggregates C.4 + M.1)
- **Evidence:** Anthropic spend tripwire per-replica (`ai-spend.ts:6-9`); Largo concurrency/budget fail-open (`largo/query/route.ts:35,82`); UW breaker fail-open → 429 retries can themselves add cost/latency.
- **Impact (500 concurrent):** The realistic cost-spike scenario is a Redis outage during a premium-user surge: Largo gates open → concurrent Claude tool-loops → unalerted spend (only per-replica tripwire). Each Largo query is internally bounded, so the spike is "many queries," not "one runaway query."
- **Recommended fix:** Cross-replica daily spend counter + hard org kill-switch (C.4). This is the single most important cost-control gap.

---

## N. Quantified breaking-point summary (what fails first, in order)

Assuming the web service runs as deployed and Redis is healthy:

1. **SSE pulse stream cap (H.1)** — at exactly **500 concurrent** SSE clients on one replica the 501st gets a 503 (`SSE_MAX_STREAMS=500`). First hard wall at the launch target itself if single-replica.
2. **Postgres pool of 5 (F.1)** — if PgBouncer is absent, request-tier DB concurrency caps at ~5/replica; held advisory locks cut that to 2-3; bursts queue 15s then 503. **Most likely first systemic failure.**
3. **Telemetry write volume (F.2)** — dominant write load, consumes pool slots user reads need; degrades #2.
4. **Redis op-rate (G.1/H.1)** — 500 SSE clients × 4 GET/s = 2000 GET/s + rate-limit EVALs; a small Redis becomes the bottleneck, and if it slows the fail-open cascade fires.
5. **UW 2-RPS ceiling under Redis-down (C.1)** — only blows if Redis degrades AND web runs >1 replica; then 2×N RPS → 429 → breaker.
6. **Anthropic cost (C.4/M.3)** — not a *stability* break but an unalerted financial one during a Redis outage.

**Deploy/restart storms (F.3, L.1)** sit underneath all of these — they amplify cold-start load on every rolling deploy.

---

## O. Prioritized launch-blocker fixes

| Priority | Fix | Finding |
|---|---|---|
| **P0** | Confirm PgBouncer in Railway topology; if absent, raise `PG_POOL_MAX` (10-20) and move long-lived advisory locks off the request pool | F.1 |
| **P0** | Decide web replica count; if 1, raise `SSE_MAX_STREAMS` + load-test SSE at 500; if >1, apply per-replica `UW_MAX_RPS` and cross-replica AI spend | H.1, C.1, C.4 |
| **P0** | Cross-replica Anthropic daily-spend counter + org kill-switch; make Largo gates fail-closed above a hard ceiling | C.4, M.3 |
| **P1** | Batch + sample telemetry inserts (or dedicated/async pool) | F.2 |
| **P1** | Move migrations to boot; stop nuking the pool on schema error | F.3 |
| **P1** | Replace per-connection 250ms SSE Redis-GET with one pub/sub subscriber per replica | H.1, G.1 |
| **P1** | Lower per-process `UW_MAX_RPS` for Redis-down fallback + alert on fail-open; single "Redis degraded" alert | C.1, M.1 |
| **P2** | Fail-fast pool (`connectionTimeoutMillis` 3-5s) + alert on `waitingCount` | F.4 |
| **P2** | Add in-flight guard to `uw-cache-refresh`; stagger the two `*/2` crons | K.1, C.2 |
| **P2** | Cap flows `LIMIT`/payload; edge-cache the identical flows GET | F.5, I.1 |

---

## P. What is already good (do not regress)

- **Cache-reader rule is genuinely followed** on the hot per-user paths: Night's Watch positions (`enrichment.ts`, O(distinct chains)), quote (2s Redis TTL + coalesce, `quote/route.ts:60-111`), GEX heatmap (per-ticker TTL), SPX desk (3 cached builds, in-flight deduped, `spx-desk-loader.ts`). This is why 500 users on a 2-RPS UW ceiling is feasible.
- **Rate limiters** are well-built: atomic sliding-window Lua, cross-replica breaker pub/sub with poison-clamp (`uw-rate-limiter.ts:49-58`), in-flight coalescing.
- **In-memory caches are bounded** (`server-cache.ts MAX_ENTRIES=5000` with proper LRU-ish eviction) — a real DoS guard.
- **Crons are single-replica isolated** → cron amplification does not multiply with web replicas.
- **WS managers are correct singletons** with graceful SIGTERM shutdown to release upstream slots on rolling deploys.
- **flows route IS cached** (corrects a Phase-1 "not verified").
- **Largo has per-user concurrency (max 2) + daily budget** gates — the right shape; just need fail-closed under Redis loss.

**Net assessment:** The platform is architecturally prepared for 500 concurrent (the cache-reader rule does the heavy lifting). The launch risk is concentrated in **(1) the Postgres pool of 5 if PgBouncer is not real, (2) the SSE 500/instance cap landing exactly at the target, and (3) the correlated fail-open cascade on Redis loss that simultaneously removes the UW ceiling and the AI-spend cap.** None require re-architecture — they are config + a handful of fail-closed/batching changes.
