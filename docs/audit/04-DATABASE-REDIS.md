# 04 — Database & Redis Audit (Deliverable F)

**Scope:** Postgres (schema/migrations/queries/pool) + Redis (key patterns, TTLs, rate-limit/budget keys, invalidation, memory growth) for the BLACKOUT platform scaling from <10 users today to ~500 concurrent.

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Method:** READ-ONLY. Every finding is grounded in real code with `file:line` references. Items needing prod/env to confirm are marked **Not verified — needs X**.

**Stack verified from code:** `pg@8.21.0`, `ioredis@5.11.1`, `next@14.2.35` (`package.json:25-28`). Single shared ioredis factory `src/lib/make-redis.ts`. Pool in `src/lib/db.ts`. Migrations are idempotent `CREATE TABLE IF NOT EXISTS` run under a Postgres advisory lock (`db.ts:127-622`).

---

## A. Inventory

### A.1 Postgres tables (all defined in `src/lib/db.ts` `runMigrations`)

| Table | PK | Key indexes | Write cadence | Growth driver |
|---|---|---|---|---|
| `flow_alerts` | `id BIGSERIAL` | `created_at DESC`; `ticker`; `(ticker, created_at DESC)`; UNIQUE `alert_id` | WS + flow-ingest cron (market hrs) | UW flow firehose; **highest-volume insert table** |
| `platform_meta` | `key TEXT` | PK only | engine/cron writers | tiny KV (cursors, budgets, session state) |
| `spx_signal_log` | `id BIGSERIAL` | `created_at DESC`; UNIQUE `signal_key` | SPX evaluator ~every 30–60s RTH | medium |
| `spx_open_play` | `id BIGSERIAL` | `(session_date,status)`; partial UNIQUE one-open-per-session | per SPX play | low |
| `spx_play_outcomes` | `id BIGSERIAL` | `open_play_id`; partial UNIQUE one-open; `closed_at` partial; `(entry_path,outcome)` | per play close | medium ledger |
| `lotto_plays` | `id BIGSERIAL` | UNIQUE `(session_date,pick_index)` | per lotto pick | low |
| `largo_sessions` | `id TEXT` | `(user_id, updated_at DESC)` | per Largo chat session | **per-user, scales with users** |
| `largo_messages` | `id BIGSERIAL` | `(session_id, created_at ASC)`; FK→sessions CASCADE | per chat turn | **per-user, scales with users** |
| `nighthawk_editions` | `id BIGSERIAL` | UNIQUE `edition_for`; `published_at DESC` | nightly | low |
| `nighthawk_play_outcomes` | `id BIGSERIAL` | partial pending/resolved; UNIQUE `(edition_for,ticker)` | nightly + resolve | low |
| `nighthawk_jobs` | `id BIGSERIAL` | UNIQUE `edition_for`; `(status,updated_at DESC)` | nightly pipeline | low |
| `nighthawk_dossiers_staging` | `id BIGSERIAL` | `edition_for`; UNIQUE `(edition_for,ticker)` | nightly | temp (pruned 2d) |
| `nighthawk_job_log` | `id BIGSERIAL` | `(edition_for, created_at DESC)` | nightly | low |
| `cron_job_runs` | `id BIGSERIAL` | `(job_key, started_at DESC)` | **every cron run, every replica** | medium-high |
| `api_telemetry_events` | `seq_id BIGSERIAL` | `at DESC`; UNIQUE `event_id` | **every external API call** | **highest growth at scale** |
| `admin_audit_log` | `id BIGSERIAL` | `created_at DESC` | admin actions | low |
| `error_events` | `id BIGSERIAL` | `created_at DESC` | on error | self-pruned to 2000 |
| `user_journal` | `id BIGSERIAL` | UNIQUE `(user_id, open_play_id)` | per note | per-user |
| `user_positions` | `id BIGSERIAL` | `(user_id, status)` | per position CRUD | **per-user, scales with users** |

### A.2 Redis key patterns + TTLs

| Key / pattern | TTL | Writer | Purpose | Bound? |
|---|---|---|---|---|
| `blackout:server:<key>` | per-call (5s–1h) | `server-cache.ts` via `shared-cache.ts` | cross-replica market cache | ✅ EX TTL |
| `uw_cache:<key>` | 60–3600s (`UW_CACHE_TTL`) | `uw-shared-cache.ts` | UW market/ticker cache | ✅ setex |
| `blackout:uw:rps:<sec>` / `blackout:polygon:rps:<sec>` | 3s | rate-limiters (Lua INCR/EXPIRE) | cluster RPS window | ✅ 3s |
| `blackout:uw:breaker` / `blackout:polygon:breaker` | n/a (pub/sub channel) | rate-limiters | breaker fan-out | n/a |
| `blackout:flow-events` | n/a (pub/sub channel) | `flow-events.ts` | live flow fan-out | n/a |
| `blackout:telemetry:instance:<id>` | 120s | `api-telemetry-redis.ts` | per-replica telemetry | ✅ EX |
| `blackout:telemetry:instances` (SET) | 240s | `api-telemetry-redis.ts` | replica registry | ✅ expire |
| `spx:pulse:snapshot` | 30s | `ws/polygon-socket.ts` | SPX/VIX index snapshot | ✅ setex |
| `membership-sync:<userId>` | 45s | `membership-sync-limit.ts` | per-user sync cooldown (SET NX EX) | ✅ EX |

Client-side only (browser `sessionStorage`/`localStorage`, not server Redis): `blackout:` session cache (`session-cache.ts`), `blackout:watchlist:v1`, `blackout:onboarding:v`, `blackout:trade-journal:<userId>` (`journal-core.ts`). These are per-browser and irrelevant to server scaling.

---

## B. Findings

### B.1 — `api_telemetry_events` writes one Postgres INSERT on EVERY external API call (no sampling)

- **Severity:** Critical
- **File:** `src/lib/api-telemetry.ts`, `src/lib/api-telemetry-persist.ts`
- **Code reference:**
  - `api-telemetry.ts:240-244` — fires on every recorded call:
    ```ts
    void import("./api-telemetry-persist")
      .then(({ persistApiTelemetryEvent }) => persistApiTelemetryEvent(event))
      .catch(() => { /* best-effort */ });
    ```
  - `api-telemetry-persist.ts:12-18` — one `INSERT ... ON CONFLICT (event_id) DO NOTHING` per event, **and** each call independently does `await ensureSchema()` (line 11) before inserting.
- **Why it's a problem:** Every Polygon/UW/Anthropic/Postgres call records a telemetry event, and every event becomes a DB INSERT with no sampling, batching, or rate gate. The insert also re-enters `ensureSchema()` each time (a promise short-circuit, but still an extra await + branch on the hot path). The cleanup cron's own comment estimates "~30k rows/day" (`db-cleanup/route.ts:98`) at today's <10 users.
- **Impact at 500 concurrent users:** Market panels poll every 5–60s and each poll fans out to multiple upstream calls; the per-process telemetry insert volume scales with upstream-call volume, not directly with users, but desk/GEX/pulse/Night's-Watch warm loops plus 500 users' Largo/tool calls multiply it. Expect **hundreds of thousands to low-millions of INSERTs/day**, each consuming a pooled connection (pool max 5 — see B.3) and competing with read traffic. The 7-day retention (`db-cleanup/route.ts:100`) means the table can hold millions of rows; `INSERT ... ON CONFLICT` must check the `event_id` unique index on every write, and the index itself grows large.
- **Recommended fix:** (1) Sample non-error telemetry persistence (e.g. persist 100% of errors/SLA-breaches, 1–5% of OK events) — the in-memory ring buffer already serves the live dashboard. (2) Batch inserts: buffer events in-process and flush every N seconds with a single multi-row INSERT. (3) Keep the unique-`event_id` guard only if dedup across replicas is required; otherwise drop it to make inserts append-only.
- **Example change** (sampling gate in `record()` before the persist import):
  ```ts
  const persist = !event.ok || event.sla_breach || Math.random() < Number(process.env.TELEMETRY_SAMPLE_RATE ?? 0.05);
  if (persist) {
    void import("./api-telemetry-persist").then(/* ... */);
  }
  ```

---

### B.2 — Migrations + every query call gate on `ensureSchema()`; cold-start advisory-lock can serialize boot

- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:**
  - `db.ts:624-635` — `ensureSchema()` memoizes a single `runMigrations()` promise but **resets `schemaReady = null; pool = null; poolInit = null` on any error**, so a transient failure forces the next request to re-run the full migration.
  - `db.ts:133-138` — `runMigrations` takes `pg_advisory_lock(42)` on a dedicated client with `statement_timeout = '30000'`.
  - Every exported query function begins with `await ensureSchema()` (60+ call sites, e.g. `db.ts:802, 922, 961, 1052, ...`).
- **Why it's a problem:** The whole migration body (≈30 `CREATE TABLE/INDEX/ALTER` statements plus a `LOCK TABLE spx_signal_log` + dedup DELETE at `db.ts:199-218`) runs inside a serialized advisory lock. Multiple Railway replicas booting simultaneously each block on lock 42; the first runs all DDL, the rest wait up to 30s. On any migration error the cached promise is nulled and the **pool is discarded**, so the next request rebuilds the pool and retries the entire migration — a thundering-herd under load if the DB is briefly slow.
- **Impact at 500 concurrent users:** During a deploy/restart (Railway rolling deploy is normal), N replicas contend on the advisory lock; requests arriving during the 30s window queue on `ensureSchema()`. If the DB is momentarily slow and one migration statement errors, the pool-nuke path (`db.ts:630-632`) can cascade: every in-flight request re-triggers migration + pool recreation, amplifying load exactly when the DB is stressed.
- **Recommended fix:** (1) Run migrations once at boot (in instrumentation/an init hook) rather than lazily on first query, and make query functions assume schema is ready. (2) On `ensureSchema` failure, do **not** nuke the pool — only reset `schemaReady` so DDL retries, but keep the working connection pool. (3) Add `LOCK TABLE`/dedup steps behind a `platform_meta` "migration version" guard so they run once ever, not on every cold start.

---

### B.3 — Postgres pool `max` defaults to 5; no per-replica budget for 500-user read load

- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:91-97`
  ```ts
  return new Pool({
    connectionString: candidate.url,
    max: parseInt(process.env.PG_POOL_MAX ?? "5", 10),
    idleTimeoutMillis: 30_000,
    ssl: poolSsl(candidate.url),
    connectionTimeoutMillis: 15_000,
  });
  ```
- **Why it's a problem:** Default pool size is 5 connections per replica. The comment (`db.ts:88-90`) asserts "PgBouncer sits in front of Postgres on Railway… it handles real connection pooling," but **nothing in the repo provisions PgBouncer** — that is an infra assumption. If PgBouncer is NOT present, 5 connections per replica is the hard concurrency ceiling against Postgres directly. Several code paths also **check out a dedicated client** that is held across multiple round-trips: `runMigrations` holds one for the whole migration (`db.ts:133`), `insertOpenSpxPlay` holds one for a BEGIN…COMMIT txn (`db.ts:1106-1152`), and `heldLockClients` (`db.ts:693`) pins one connection per held advisory lock (`spx-eval`, plus any `gen:` lock) for the lock's entire lifetime. Each pinned/held client subtracts from the pool of 5.
- **Impact at 500 concurrent users:** With the SPX-eval lock held (`db.ts:767`) plus a migration or a play-open txn in flight, a replica can be down to 2–3 usable connections. Telemetry inserts (B.1), `cron_job_runs` inserts, and user reads (`user_positions`, `largo_messages`, journal) then queue on `pool.connect()` and time out after 15s (`connectionTimeoutMillis`), surfacing as 503/slow requests. `getDatabasePoolStats` exposes `waitingCount` (`db.ts:682`) — **Not verified — needs prod metrics** to confirm queue depth, but the math is tight.
- **Recommended fix:** (1) Confirm whether PgBouncer is actually in the Railway topology; if not, set `PG_POOL_MAX` deliberately (e.g. 10–20) sized against Postgres `max_connections` ÷ replica count. (2) Avoid holding pooled clients for long-lived advisory locks — the held-lock pattern (`db.ts:693-721`) should use a **separate dedicated connection outside the request pool**, so SPX-eval/migration locks never starve request traffic. (3) Document the PgBouncer assumption as a hard infra requirement.

---

### B.4 — `fetchRecentFlows` does an unbounded (LIMIT 5000) full-text-ish JSONB scan with `ORDER BY total_premium`, no covering index

- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:796-866`
  ```ts
  const limit = params.limit ?? 5000;
  // ...
  FROM flow_alerts
  ${where}                       // COALESCE(created_at, inserted_at) >= NOW() - $1h  (+ optional ticker/min_premium)
  ORDER BY COALESCE(total_premium, 0) DESC NULLS LAST
  LIMIT $i
  ```
  The SELECT also evaluates ~10 `raw_payload->>'...'::numeric` / `jsonb_typeof(...)` expressions **per row** (`db.ts:842-859`).
- **Why it's a problem:** The default window is 48h (`db.ts:808`) and the default `LIMIT` is **5000 rows**. The `WHERE` filters on `COALESCE(created_at, inserted_at)` — a wrapped expression that the `idx_flow_alerts_created_at` index (on bare `created_at`) **cannot use** — so this is a sequential scan / bitmap heap scan over 48h of the highest-volume table, then a sort by `total_premium` (no index on `total_premium`), then per-row JSONB extraction for up to 5000 rows. There is no index supporting `ORDER BY total_premium`, and the `COALESCE` defeats the timestamp index.
- **Impact at 500 concurrent users:** The flows page/tape calls this on load and likely on poll. At 500 users each pulling a 48h × 5000-row JSONB-heavy result set, this is the most expensive read in the app and runs against the table that is simultaneously receiving the highest insert volume (B.1-adjacent). Sort + heap fetch + JSONB parse for thousands of rows × hundreds of concurrent callers will saturate CPU and the 5-connection pool (B.3). `serverCache`/Redis fronting helps only if the route actually wraps it — **Not verified — needs the flows route** to confirm caching; the DB function itself is uncached.
- **Recommended fix:** (1) Add an index that matches the predicate+sort, e.g. `CREATE INDEX ON flow_alerts (inserted_at DESC, total_premium DESC)` and have the query filter on a bare indexed timestamp (store a single canonical `event_ts` rather than `COALESCE`). (2) Drop the default LIMIT from 5000 to a UI-sized page (e.g. 200–500) and paginate. (3) Precompute the extracted JSONB fields into real columns at insert time so the read path does not parse JSONB per row. (4) Ensure the flows API route wraps this in `serverCache` with a short TTL so 500 users share one query per window.

---

### B.5 — Rate-limiter sliding-window Redis keys never explicitly deleted; rely solely on 3s TTL, and breaker pub/sub is fire-and-forget

- **Severity:** Medium
- **File:** `src/lib/providers/uw-rate-limiter.ts`, `src/lib/providers/polygon-rate-limiter.ts`
- **Code reference:**
  - `uw-rate-limiter.ts:161-164` / `polygon-rate-limiter.ts:165-168` — `INCR` then `EXPIRE` only when `new_count == 1` inside the Lua script.
  - `uw-rate-limiter.ts:175-176` — keys are per-second buckets `blackout:uw:rps:<sec>`.
- **Why it's a problem:** This is actually the **correct** pattern (TTL 3s on a per-second key auto-expires), so memory growth is bounded — good. The residual risk: the global gate **FAILS OPEN** on any Redis error (`uw-rate-limiter.ts:192-194`, `polygon-rate-limiter.ts:193-195` return `true`). If Redis is degraded under load, the cluster-wide UW 2-RPS ceiling silently disappears and every replica falls back to local-only pacing (`MAX_RPS=2` per process). With multiple replicas that means **2 RPS × replica count** hitting UW — blowing the hard 2-RPS cluster cap and triggering 429s → circuit breaker.
- **Impact at 500 concurrent users:** A Redis blip during peak (when 500 users drive the most upstream demand) removes the only cluster-wide UW ceiling. N replicas each pace at 2 RPS locally → UW sees 2N RPS → sustained 429s → UW circuit breaker opens cluster-wide (`uw-rate-limiter.ts:276`) → market data stalls for all users. The fail-open is a deliberate availability choice but converts a Redis problem into a UW-ban problem at exactly the wrong time.
- **Recommended fix:** (1) Keep fail-open but **lower the per-process `UW_MAX_RPS` to `ceil(2 / expected_replica_count)`** via env so local-only fallback still respects the cluster cap. (2) Add a metric/alert when `acquireGlobalRedisSlot` has been failing-open (the catch at line 192) so ops sees the ceiling is off. (3) Consider a short local cooldown when Redis is unavailable rather than unbounded local pacing.

---

### B.6 — `insertManyNighthawkOutcomes` is an N+1 insert loop (await per row)

- **Severity:** Medium
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:2206-2241`
  ```ts
  for (const row of rows) {
    await pool.query(`INSERT INTO nighthawk_play_outcomes (...) VALUES (...) ON CONFLICT ...`, [...]);
  }
  ```
- **Why it's a problem:** Each row is a separate awaited round-trip; for a Night Hawk edition of ~15–30 plays that is 15–30 serial round-trips, each acquiring a pooled connection. Same pattern risk in the per-row `nighthawk` staging writes.
- **Impact at 500 concurrent users:** Low direct user impact (nightly worker, not request path), but it holds a pool connection for the full serial loop, and during the 5:30 PM ET edition build this competes with end-of-day user traffic. Not a launch blocker but wasteful.
- **Recommended fix:** Build a single multi-row `INSERT ... VALUES (...),(...),... ON CONFLICT` (or `UNNEST` arrays), one round-trip. Same for any other per-row insert loops.

---

### B.7 — `cron_job_runs` is written on every cron tick by every replica, unbounded between nightly prunes

- **Severity:** Medium
- **File:** `src/lib/db.ts`, `src/lib/cron-run.ts`
- **Code reference:** `db.ts:2546-2567` `recordCronJobRun` INSERT; pruned only nightly to 30d (`db-cleanup/route.ts:108`).
- **Why it's a problem:** `flow-ingest` runs ~every 2 min, `nights-watch-warm` ~every 60s (market hrs), `spx-evaluate` ~every 5 min, plus watchdog/reconcile. Each run inserts a row, and the cron HTTP routes can be hit by **every replica** unless de-duplicated upstream. `fetchCronJobLastRuns` uses `DISTINCT ON (job_key) ORDER BY job_key, started_at DESC` (`db.ts:2573-2577`) — a sort over the whole table each call.
- **Impact at 500 concurrent users:** Indirect — table growth and the `DISTINCT ON` full sort on the admin cron-health dashboard. The `(job_key, started_at DESC)` index (`db.ts:474`) supports the DISTINCT ON, so it's index-ordered, but volume across replicas + a 60s cron makes this thousands of rows/day. Manageable but watch it.
- **Recommended fix:** Keep nightly prune; optionally cap to last K runs per job_key (a `DELETE … WHERE id NOT IN (last K per job_key)`), and ensure only one replica records each cron run (the cron auth/lock should already gate this — **Not verified — needs the cron dispatch path**).

---

### B.8 — Per-user tables (`user_positions`, `largo_*`, `user_journal`) use `SELECT *` and `created_at` ordering without a time index

- **Severity:** Medium
- **File:** `src/lib/db.ts`
- **Code reference:**
  - `db.ts:1459-1466` — `SELECT * FROM user_positions WHERE user_id = $1 [AND status=$2] ORDER BY created_at DESC`. Index is `(user_id, status)` (`db.ts:614`) — it filters by user but the **`ORDER BY created_at DESC` requires a sort** (no `created_at` in the index).
  - `db.ts:1453-1467`, `1549`, `1460/1464` — `SELECT *` returns every column (incl. `notes` TEXT) rather than a projection.
  - `largo-store.ts:92` `fetchLargoMessagesPublic` reads messages by session.
- **Why it's a problem:** `SELECT *` couples the read to schema shape and pulls unbounded `notes`/`content` TEXT even when the caller (e.g. the Night's-Watch warm cron `listDistinctOpenPositionChains`) needs few columns. The `created_at DESC` sort on `user_positions` is cheap per-user but is a sort nonetheless. There is **no `LIMIT`** on `listUserPositions` — a user with many positions returns all of them.
- **Impact at 500 concurrent users:** Per-user queries are correctly user-scoped (good — no cross-user scans), so impact is bounded per request. The risk is cumulative: 500 users × frequent Night's-Watch/positions polls × unbounded `SELECT *` with a sort, each taking a pool slot. Low individual cost, but it adds to the pool-5 pressure (B.3).
- **Recommended fix:** (1) Replace `SELECT *` with explicit column lists. (2) Add `LIMIT` + pagination to `listUserPositions`. (3) If positions lists are polled, add `(user_id, status, created_at DESC)` so the sort is index-covered.

---

### B.9 — No connection-pool `max`/saturation alerting; `getDatabasePoolStats` is exposed but no backpressure

- **Severity:** Medium
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:667-687` returns `{ total, idle, waiting }` but nothing acts on `waiting > 0`. `dbQuery` (`db.ts:637-643`) just awaits `pool.query`, which queues on `connectionTimeoutMillis = 15_000` (`db.ts:96`) before throwing.
- **Why it's a problem:** When the pool saturates (B.3), requests silently queue up to 15s then fail. There is no fast-fail, no shedding, and no alert tied to `waitingCount`.
- **Impact at 500 concurrent users:** A burst that exceeds 5 connections per replica produces a wave of 15s-latency requests then timeouts, with no early signal. Users see hangs, not clean errors.
- **Recommended fix:** Wire `getDatabasePoolStats().waiting` into the admin cron-health/critical-alerts path and/or lower `connectionTimeoutMillis` to fail fast (e.g. 3–5s) so a saturated pool sheds load instead of stacking 15s waits.

---

### B.10 — `shared-cache` / `server-cache` in-memory fallback is per-replica; on Redis loss, 500 users hit upstream per replica

- **Severity:** Medium
- **File:** `src/lib/shared-cache.ts`, `src/lib/server-cache.ts`
- **Code reference:**
  - `shared-cache.ts:21-46` — `getRedis()` returns `null` on failure with a 30s backoff; all gets/sets then fall back to the per-process `memory` Map (`shared-cache.ts:59-63, 97`).
  - `server-cache.ts:31` — in-memory store hard-capped at `MAX_ENTRIES = 5_000` with insertion-order eviction (good DoS guard).
- **Why it's a problem:** The cross-replica cache (`blackout:server:*`, `uw_cache:*`) collapses to per-replica memory when Redis is down. The in-flight dedup (`server-cache.ts:23`, `uw-shared-cache.ts:45`) still collapses concurrent cold misses **within one replica**, but **across replicas there is no coordination** without Redis — so N replicas each make their own upstream call per TTL window. Combined with the rate-limiter fail-open (B.5), a Redis outage means N× upstream load AND no cluster RPS ceiling.
- **Impact at 500 concurrent users:** Redis loss during peak → each replica independently re-warms every market key → multiplied UW/Polygon calls → 429 storm → breaker. The per-replica memory cache keeps the app *up* (good), but the upstream amplification is the real risk.
- **Recommended fix:** Accept per-replica fallback for availability, but pair it with B.5's lowered per-process RPS so the amplified miss traffic still can't exceed provider caps. Add an alert when `shared-cache`/`uw-shared-cache` has been in `lastFailedAt` backoff for >1 window.

---

### B.11 — Daily Claude budget counter is read-modify-write on `platform_meta` (non-atomic), correct only because of the SPX advisory lock

- **Severity:** Low
- **File:** `src/lib/spx-play-claude.ts`, `src/lib/db.ts`
- **Code reference:** `spx-play-claude.ts:64-71` `incrementDailyBudget` does `readDailyBudget()` → `+1` → `setMeta(...)`. `setMeta` (`db.ts:747-759`) is an upsert with no compare-and-set.
- **Why it's a problem:** Two concurrent writers would lose increments (classic read-modify-write race). It is safe **today** only because the SPX evaluator holds a cluster-wide advisory lock (`tryAcquireSpxEvaluateLock`, `db.ts:765-767`) so there is exactly one writer. This is an implicit invariant — if any other code path ever calls the Claude budget outside that lock, the cap silently leaks.
- **Impact at 500 concurrent users:** None today (single-writer). The risk is future regression: the budget protects a paid Anthropic spend cap, and a lost-update race would over-spend.
- **Recommended fix:** Move the daily budget counter to a Redis `INCR` with a date-scoped key + EXPIRE (atomic, cluster-safe), mirroring the rate-limiter pattern, so correctness no longer depends on the advisory-lock invariant.

---

### B.12 — `largo_messages` retention / Largo session growth has no cleanup target despite per-user growth

- **Severity:** Low
- **File:** `src/lib/db-cleanup-targets.ts`, `src/lib/cron-registry.ts`
- **Code reference:** `CLEANUP_TARGETS` (`db-cleanup-targets.ts:6-19`) covers telemetry/flow/cron/signal/nighthawk/audit/outcomes but **not `largo_sessions`/`largo_messages` or `user_journal`/`user_positions`**. A separate `largo-cleanup` cron exists (`cron-registry.ts:39-46`, "Purge stale Largo chat sessions") — **Not verified — needs `/api/cron/largo-cleanup/route.ts`** to confirm it actually prunes messages.
- **Why it's a problem:** Largo chat is per-user and unbounded; at 500 users with active chat, `largo_messages` grows continuously. If `largo-cleanup` only touches sessions (not CASCADE-bound messages) or runs weekly with a long window, the table grows without a retention floor in the central cleanup.
- **Impact at 500 concurrent users:** Slow, steady table growth; reads are session-scoped (`(session_id, created_at)` index) so query cost stays bounded, but storage and the `largo_sessions (user_id, updated_at)` listing grow. Not a launch blocker.
- **Recommended fix:** Verify `largo-cleanup` prunes messages (FK CASCADE means deleting sessions removes messages). Add an explicit retention window and confirm it's exercised; consider adding to `CLEANUP_TARGETS` for uniformity.

---

### B.13 — `spx_play_outcomes` JSONB blobs (`factors`, `confirmations`, `mtf`, `claude`, `option_ticket`) stored inline, read back via `fetchClosedPlayOutcomes(LIMIT 500)`

- **Severity:** Low
- **File:** `src/lib/db.ts`
- **Code reference:** table def `db.ts:254-282` (5 JSONB columns); `fetchClosedPlayOutcomes` (`db.ts:1595-1611`) selects up to 500 rows but **omits** the JSONB blobs (good — projection excludes them). `fetchRecentPlayOutcomeRows` (`db.ts:1614-1629`) similarly omits them.
- **Why it's a problem:** Mostly a *non*-issue worth noting: the read paths correctly avoid the heavy JSONB columns, so reads stay light. The only residual cost is TOAST storage and write size per outcome. No index on JSONB (none needed given reads don't filter on it).
- **Impact at 500 concurrent users:** Negligible for reads. Listed for completeness so the projection discipline is preserved if these functions are edited.
- **Recommended fix:** None required; keep the column-projection discipline (do not switch these to `SELECT *`).

---

## C. What breaks first as load climbs to 500 concurrent

1. **Postgres connection pool (max 5/replica)** saturates first if PgBouncer is not actually deployed — held advisory-lock clients (SPX-eval, migration) + telemetry/cron inserts + user reads exceed 5, requests queue to 15s then 503 (**B.3, B.9**).
2. **`api_telemetry_events` insert volume** (one INSERT per upstream call, no sampling) becomes the dominant write load and the largest table, consuming pool slots that user traffic needs (**B.1**).
3. **`fetchRecentFlows`** (48h × 5000-row JSONB-heavy, COALESCE-defeated index, sort by un-indexed `total_premium`) is the heaviest read and runs against the busiest write table (**B.4**).
4. **Redis outage cascade:** rate-limiter fail-open (**B.5**) removes the UW 2-RPS cluster ceiling while shared-cache fallback (**B.10**) makes every replica re-warm independently → UW 429 storm → cluster breaker opens → market data stalls for all 500 users.
5. **Deploy/restart storms:** lazy `ensureSchema()` advisory lock + pool-nuke-on-error (**B.2**) serialize and amplify cold-start load across replicas during Railway rolling deploys.

---

## D. Launch blockers (must fix before 500 concurrent)

- **B.1** — Add sampling/batching to `api_telemetry_events` inserts (Critical).
- **B.3** — Confirm PgBouncer or raise `PG_POOL_MAX` deliberately; stop holding pooled clients for long-lived advisory locks (High).
- **B.4** — Index + bound `fetchRecentFlows` (default LIMIT 5000 → paginated; fix COALESCE/index mismatch) and ensure the flows route is `serverCache`-fronted (High).
- **B.2** — Move migrations to boot-time, stop nuking the pool on schema error (High).

## E. Strong recommendations (do soon after launch)

- **B.5 / B.10** — Lower per-process `UW_MAX_RPS` so Redis-down fallback still respects the cluster 2-RPS cap; alert on fail-open.
- **B.9** — Fail-fast on pool saturation + alert on `waitingCount`.
- **B.6** — Batch the Night Hawk outcome insert loop.
- **B.11** — Move the Claude daily budget to atomic Redis `INCR` to remove the advisory-lock dependency.
- **B.8** — Explicit column lists + `LIMIT` on per-user reads.

## F. Confirmed-healthy (no change needed)

- Cluster RPS limiters use atomic Lua `INCR`+`EXPIRE` with 3s TTL — bounded, race-free (`uw/polygon-rate-limiter.ts`).
- Single ioredis factory always wires an `error` listener — prevents the EventEmitter crash (`make-redis.ts:53-57`).
- All Redis caches have explicit TTLs (no unbounded keys); in-memory `server-cache` is hard-capped at 5000 with eviction (`server-cache.ts:31-60`).
- Per-user DB queries are correctly `user_id`-scoped (no cross-user scans); FK CASCADE on `largo_messages`; partial unique indexes enforce one-open-play invariants.
- DB cleanup is batched (5000/stmt) with status guards so open/pending rows are never pruned (`db-cleanup/route.ts:39-76`).
- Migration advisory lock is held on a dedicated client with a 30s statement timeout (`db.ts:133-138`).

---

*Deliverable F — Database & Redis. All findings grounded in `src/lib/db.ts`, `src/lib/server-cache.ts`, `src/lib/shared-cache.ts`, `src/lib/make-redis.ts`, `src/lib/providers/{uw,polygon}-rate-limiter.ts`, `src/lib/uw-shared-cache.ts`, `src/lib/api-telemetry*.ts`, `src/lib/error-sink.ts`, `src/app/api/cron/db-cleanup/route.ts`, and the cron registry. Items marked "Not verified" require prod metrics or files outside this area.*
