# 17 — SCALE TIERS: 500 / 1,000 / 5,000 Concurrent-User Simulation

**Auditor pass:** Pass-3 scalability simulation. Extends `09-SCALABILITY.md` (which targets a single 500-user tier) into a three-tier load model — **500 → 1,000 → 5,000 concurrent active users** — across every subsystem: frontend render, backend CPU/event-loop, Postgres (pool/connections/query load), Redis (op-rate/memory), upstream WebSockets, SSE, crons, Polygon/Massive, Unusual Whales (2 RPS!), Anthropic/Claude, Clerk, and Railway replicas.

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web` — same files). **READ-ONLY** on the codebase. The only file this pass writes is this one.

**Method:** Every load number is `users × cadence` arithmetic with the cadence read from a file:line, or a capacity number read from a file:line. Where a number depends on prod/an invoice/a plan tier, it is tagged **NOT VERIFIED — needs X** and the evidence required is stated. No invented figures; every estimate shows its formula + inputs. This section *simulates* — it does not re-derive the root-cause findings already exhausted in 09/11/12/13/14; it cites them and predicts, per tier, **what fails first, what gets expensive, what gets unreliable, and the mitigation that buys the next tier.**

**Definition of "concurrent active user" used throughout:** a user with the live SPX desk / pulse open (the heaviest steady surface), polling on the cadences in §A.1, holding (at the higher tiers) an SSE pulse stream. This is the worst-case steady-state mix; a user merely logged in but idle costs far less. Where a surface scales on a *different* population (e.g. Largo = daily-active premium; NW chains = distinct open positions) that is called out.

---

## A. Verified load-bearing constants (the simulation inputs)

Re-read these before any tier conclusion. Every value was read from the file:line shown (verified this pass, 2026-06-24).

### A.1 — Client poll cadences (per active desk user)

| Surface | Cadence | File:line | Requests/user/sec |
|---|---|---|---|
| SPX merged pulse (embed) | **3,000 ms** | `embeds/LiveMarketPulse.tsx:45` | 0.333 |
| Quote (GEX panel) | **1,500 ms** | `desk/GexHeatmap.tsx:2131` | 0.667 |
| GEX heatmap | **20,000 ms** | `desk/GexHeatmap.tsx:2117` | 0.050 |
| Night's Watch positions (RTH) | **5,000 ms** | `nights-watch/NightsWatchPanel.tsx:31` | 0.200 |
| Flow feed | **30,000 ms** | `FlowFeed.tsx:40` | 0.033 |
| Dark pool panel | **30,000 ms** | `DarkPoolPanel.tsx` (POLL_MS 30s, per 09 H.2) | 0.033 |
| **SSE pulse stream** | persistent conn, **250 ms** server send loop | `spx/pulse/stream/route.ts:78` | n/a (1 conn; 4 Redis GET/s) |

A user who has the **desk + GEX panel + NW + flow** open simultaneously issues, very roughly, `0.333 + 0.667 + 0.050 + 0.200 + 0.033 + 0.033 ≈ 1.32 HTTP req/s`. Not every user has every panel open; a conservative **blended ~0.8–1.3 req/s/active-user** is used below and the range is shown.

### A.2 — Server capacity / safety limits

| Limit | Value | File:line | Scope |
|---|---|---|---|
| SSE max streams | **500** (env `SSE_MAX_STREAMS`) | `spx/pulse/stream/route.ts:15,21` | **per instance** |
| SSE send loop | **250 ms** (4 Redis GET/s/conn) | `spx/pulse/stream/route.ts:78` | per connection |
| Postgres pool max | **5** (env `PG_POOL_MAX`) | `db.ts:93` | **per replica** |
| PG connect timeout | **15,000 ms** | `db.ts:96` | per acquire |
| Web `numReplicas` | **unset = 1** | `railway.toml` (no key) | cluster |
| UW local pacing | **2 RPS** (`UW_MAX_RPS`) | `uw-rate-limiter.ts:12` | **per replica** |
| UW global ceiling | **2 RPS** (`UW_GLOBAL_MAX_RPS`), Redis Lua | `uw-rate-limiter.ts:14,151-166` | cluster (fails OPEN) |
| UW concurrency | **3** (`UW_MAX_CONCURRENCY`) | `uw-rate-limiter.ts:15` | per replica |
| UW breaker | **8×429 / 60s → 45s pause** | `uw-rate-limiter.ts:17-18,277` | per replica + pub/sub broadcast |
| Polygon local + global | **40 RPS**, concurrency **24** | `polygon-rate-limiter.ts:32,34,35` | per replica / cluster (fails OPEN) |
| Polygon breaker | **5×429 → 60s pause** | `polygon-rate-limiter.ts:39,40` | per replica |
| Options WS shard | **≤1000 contracts/conn × ≤10 conns** | `options-socket.ts:45,50` | per replica, env-gated `OPTIONS_WS_ENABLED` |
| GEX in-mem map cap | **200 keys → full `clear()`** | `polygon-options-gex.ts:815` | per replica |
| `fetchRecentFlows` default LIMIT | **5000 rows** | `db.ts:822` | per query |

### A.3 — Background (user-count-independent) load

| Job | Cadence | Work | File:line |
|---|---|---|---|
| `uw-cache-refresh` | `*/2 11-21 * * 1-5` (every 2 min RTH) | **23 UW REST tasks** + 1 Polygon (movers) = 24 total, `Promise.allSettled` → serialize behind 2 RPS ≈ **11.5 s drain/run** | `uw-cache-refresh/route.ts:42-102`; counts: 1 tide + 5 sectors + 1 darkpool-recent + 1 top-net-impact + 1 congress + (4 idx × 3) + 2 flow-strike = 23 UW |
| `flow-ingest` | `*/2 11-21 * * 1-5` (same window) | WS-primary; REST fallback. Has in-flight guard | `flow-ingest/route.ts:13`; `railway.flow-ingest.toml:10` |
| `nights-watch-warm` | `* 11-21 * * 1-5` (**every minute** RTH) | warms shared NW option chains for all open positions | `railway.nights-watch-warm.toml:16` |
| `spx-evaluate` | `*/5` RTH | engine tick + ≤40/day Claude veto | `cron-registry` |
| AI spend ledger | per AI call | cross-replica Redis `INCRBYFLOAT` (verified this pass) | `ai-spend-ledger.ts:52-53` |

**Two corrections to the inherited 09/13 framing, verified this pass:**
1. **AI spend is now cross-replica, not per-replica.** `recordOrgSpend` (`anthropic.ts:60`) → the `AI_SPEND_INCR_LUA` ledger in **shared Redis** (`ai-spend-ledger.ts:52-53`), written by `trackSpend` from *every* Anthropic path (`anthropic.ts:283` text, `:364/:372/:439` tool loop). The old per-replica `SpendTracker` (`ai-spend.ts`) is now an *alerting* tripwire, not the budget source of truth. 09 C.4's "per-replica spend, N×threshold before paging" is partially **outdated**.
2. **The org kill-switch CHECK is Largo-only.** `isLargoKillSwitchTripped()` is consulted only in `largo/query/route.ts:182`. The non-Largo `anthropicText` surfaces (NH synthesis/critic/explainer, commentary, GEX/flow/NW narrative, SPX play-gate) **write** to the ledger but never **read** the ceiling — so they can keep spending after the switch trips. This is the live version of 13 C-6, narrowed.

---

## B. Per-tier request-rate model (frontend → web tier)

Formula: `web req/s = active_users × blended_req_per_user`. Range uses 0.8 (light panel mix) to 1.3 (full desk) req/s/user from §A.1.

| Tier | Web HTTP req/s (0.8–1.3/user) | SSE streams if 100% on pulse | Redis GET/s from SSE (4/conn) | Clerk auth checks/s (1 per API req) |
|---|---|---|---|---|
| **500** | **400 – 650** | 500 | 2,000 | 400 – 650 |
| **1,000** | **800 – 1,300** | 1,000 | 4,000 | 800 – 1,300 |
| **5,000** | **4,000 – 6,500** | 5,000 | 20,000 | 4,000 – 6,500 |

Every API request also pays a **Clerk middleware auth parse** (`authorizeMarketDeskApi`, per 09 H.2) — so the Clerk column equals the HTTP column. Clerk is a per-request CPU + occasional network cost, not a per-user upstream; see §J for the Clerk-specific verdict.

**Key structural fact (verified):** the SSE cap is **500 per instance** (`spx/pulse/stream/route.ts:15`) and web `numReplicas` is **unset = 1** (`railway.toml`). So a single replica hard-caps at 500 SSE streams — the 501st user on the live pulse gets `503 Too many active streams`. **The launch target lands exactly on the cap.**

---

## C. THE TIER-1 SIMULATION — 500 concurrent users

**Replica assumption:** 1 web replica (default, unverified — **NOT VERIFIED — needs Railway dashboard `numReplicas`**). At 500 users on one replica, the per-replica invariants (UW bucket, in-mem caches, sockets) are all intact — *that is why a single replica is the safest topology at this tier.*

### C.1 — What fails FIRST at 500

**Ordered breaks-first → survives:**

| Rank | Subsystem | Trigger | Quantified | Severity | Finding |
|---|---|---|---|---|---|
| 1 | **SSE pulse cap** | 501st concurrent pulse stream | Cap = 500/instance (`stream/route.ts:15`); **target == cap, zero headroom** | **Critical (launch)** | S-1, 09 H.1 |
| 2 | **Postgres pool-of-5** | >5 concurrent queries/replica; advisory-lock holders cut usable to 2-3 | 15 s queue (`db.ts:96`) then 503; **if PgBouncer absent** | **Critical** | 09 F.1, 14 G.2 |
| 3 | **Redis op-rate** | 500 SSE × 4 GET/s = **2,000 GET/s** + rate-limit EVALs + cache reads | single small Railway Redis becomes hot; slow Redis → fail-open cascade | **High** | S-2, 09 G.1 |
| 4 | **SPX-play 502 storm** | any `api.massive.com` connect blip | flagship route hard-502s, no stale-serve | **High** | RT-2, 15 |
| 5 | **Telemetry write volume** | 1 INSERT/upstream call competes for the pool-of-5 | hundreds-of-K to low-M rows/day | **High** | 09 F.2 |
| 6 | UW 2-RPS | only if Redis degrades (single replica = local bucket still 2 RPS, so cluster cap *holds* at 1 replica) | dormant at 1 replica | Low here | 09 C.1 |

### C.2 — What becomes EXPENSIVE at 500

- **Anthropic / Largo.** Per 13's model: **~$1,910/mo typical**, up to **~$13,700/mo heavy-Largo**. Shared surfaces (~$275/mo) are flat regardless of user count (cache-reader rule); only Largo scales with daily-active premium users. The 7× typical→heavy spread is the budgeting risk. **Launch blocker: arm `DAILY_AI_SPEND_KILL_USD`** (13 C-6) — verified opt-in (`ai-spend-ledger.ts:42-46`), and verified the check is Largo-only.
- **Postgres telemetry table.** One un-batched INSERT per upstream call (09 F.2), ≥90-day retention → millions of rows; index bloat on the `event_id` UNIQUE check (`db.ts:478-481`).
- **GEX explain on sonnet** (~$213/mo, ~75% of shared AI spend) — flat at every tier; move to haiku (13 C-2) for −$142/mo.

### C.3 — What becomes UNRELIABLE / SLOW / DANGEROUS at 500

- **Cold-start per deploy.** Sockets + schema + pool boot lazily on first request (`instrumentation.ts:28` deliberately does NOT boot sockets; verified). Healthcheck is liveness-only (`/api/health`), `/api/ready` not wired (14 E.1). One cold replica per deploy = a short window of empty WS panels + first-request migration latency. **Tolerable at 1 replica.**
- **UW cron drain.** 23 UW tasks ÷ 2 RPS ≈ **11.5 s of UW saturation every 2 min** (`uw-cache-refresh`), overlapping `flow-ingest` on the same `*/2` cadence. A per-request UW read (non-pre-warmed ticker) landing in that window sees multi-second latency. Bounded (single-replica cron), Medium (09 C.2).
- **Redis fail-open cascade (M.1).** A single Redis slowdown simultaneously removes the UW ceiling + drops the AI-spend ledger to best-effort + opens the Largo concurrency/budget gates. At 500, a 2,000 GET/s Redis is the most likely thing to slow under a spike — making this the correlated-failure danger even at tier 1.

### C.4 — Tier-1 verdict + mitigations to be "500-safe"

**Feasible on one well-sized replica IF:** (a) PgBouncer is real (transaction mode), (b) Redis is healthy and sized for 2,000+ GET/s, (c) `SSE_MAX_STREAMS` is raised above 500 OR a 2nd replica is added (which then activates §D fixes). The cache-reader rule does the heavy lifting (verified across quote/GEX/desk/NW/flows). **Launch blockers at this tier:** S-1 (SSE cap == target), 09 F.1 (pool/PgBouncer), RT-2 (SPX-play stale-serve), 13 C-6 (arm kill-switch). None require re-architecture — config + a handful of fail-closed/stale-serve changes.

---

## D. THE TIER-2 SIMULATION — 1,000 concurrent users

**Replica assumption:** the natural move to absorb 1,000 is **≥2 web replicas** — because one replica cannot hold 1,000 SSE streams (cap 500/instance) and the single event loop is contended by WS + SSE + requests. **The instant `numReplicas > 1`, a cluster of per-replica invariants breaks** — this is the defining risk of tier 2, and the reason "just add replicas" is dangerous without the fixes below.

### D.1 — What fails FIRST at 1,000

| Rank | Subsystem | Trigger | Quantified | Severity | Finding |
|---|---|---|---|---|---|
| 1 | **UW 2-RPS cluster cap silently doubles** | replicas>1 + any Redis blip → each replica paces at its OWN 2 RPS local bucket (`uw-rate-limiter.ts:12`); global ceiling fails OPEN (`:192`) | **2 × N RPS** to UW (2 replicas = 4 RPS = 2× the hard cap) → sustained 429s → breaker 45s → **platform-wide stale desk** | **Critical** | S-3, 09 C.1, 14 C.2 |
| 2 | **Per-replica UW WebSockets multiply** | `ensureDataSockets()` is per-process (`init-data-sockets.ts:44`), invoked per-request → **each replica opens its own UW multiplex socket** | N UW sockets (verify account WS allowance); N× idempotent flow-persist attempts | **High** | S-4, 09 H.3, 11 §1 |
| 3 | **SSE cap per instance** | 1,000 pulse streams ÷ 500/instance | needs ≥2 replicas *just for SSE headroom*; each replica still 4 GET/s × its share | **High** | S-1, 09 H.1 |
| 4 | **Redis becomes the cluster bottleneck** | **4,000 GET/s** from SSE alone + EVALs from 2× rate-limit buckets + cross-replica AI ledger + telemetry rollup | a single Railway Redis box at 4k+ GET/s; its slowdown triggers the fail-open cascade for ALL replicas at once | **High** | S-2, 09 G.1, 14 G.1 |
| 5 | **Postgres pool = 5 × N** | 2 replicas = 10 connections; telemetry INSERTs + advisory-lock holders + 1,000-user reads | PgBouncer `default_pool_size=20` (14 G.2) now the real ceiling — must be sized vs `max_connections` | **High** | 09 F.1/F.2, 14 G.2 |
| 6 | **Cross-replica AI spend now correct, but kill-switch still Largo-only** | NH/commentary/explain spend after the ceiling trips | bounded by their own caches (low volume) but uncapped in principle | Medium | S-5, 13 C-6 |

### D.2 — What becomes EXPENSIVE at 1,000

- **Anthropic / Largo.** **~$3,555/mo typical → ~$27,200/mo heavy** (13 §5). Doubles vs 500 (Largo is linear in daily-active premium). Shared stays ~$278/mo.
- **Redis.** Op-rate, not memory, is the cost — 4,000 GET/s from SSE alone. Mitigated only by the SSE pub/sub fan-out (NOT yet implemented — verified `stream/route.ts:78` still per-connection 250ms GET). A managed/HA Redis tier becomes a real line item.
- **Polygon distinct-ticker fan-out.** If users spread across ~50–100 GEX tickers: `100 tickers × ~6 pages / 20s ≈ 30 chain-calls/s` ≈ **75% of the 40-RPS ceiling** before desk/pulse (12 HIGH-3). Within the 200-key in-mem cap but climbing.

### D.3 — What becomes UNRELIABLE / SLOW / DANGEROUS at 1,000

- **Rolling deploy under load.** Each new replica cold-starts independently (lazy pool + 30-statement migration + fresh UW socket connect). A market-hours deploy = a *wave* of replicas each opening a UW socket (amplifying §D.1 rank 2) and each running the lazy migration check — amplifying load exactly during the deploy (14 E.1).
- **`net-prem-ticks` mid-cycle refetch.** 60 s Redis TTL vs 120 s cron cadence (`uw-shared-cache.ts:21`) guarantees a mid-cycle expiry for 4 index tickers → near-continuous on-demand UW calls during the ~11.5 s cron-drain window (11 UW-5). At 1,000 with more desk traffic, this measurably eats the 2-RPS budget.
- **flow-alerts 3-call burst.** Cold market-wide miss paginates 3× (limit 200 each) via raw `uwGet` (`unusual-whales.ts:563-615`). If the WS auth-fails (5-min backoff), every replica's REST fallback can fire the burst → compounds the C.1 fail-open ceiling breach (11 UW-4).

### D.4 — Tier-2 verdict + mitigations to reach 1,000

**Requires ≥2 web replicas, which activates per-replica fixes — do NOT scale replicas without them, in this order:**
1. **`UW_MAX_RPS = ceil(2 / replicas)`** (e.g. `=1` for 2 replicas) + treat `REDIS_URL` as **required** (fail-closed if unset while replicas>1) so the Redis-down fallback still respects the 2-RPS cluster cap (09 C.1, 14 C.2). **The single most important tier-2 fix.**
2. **Decouple WS ingestion to ONE owner** (a dedicated socket/ingest service publishing to Redis pub/sub) so N replicas don't open N UW sockets (09 C.1/H.3, 14 C.1, 11 §7 Kafka note). **NOT VERIFIED — needs UW account WS connection allowance.**
3. **SSE pub/sub fan-out** — one Redis subscriber/replica pushing to local SSE clients, replacing the per-connection 250ms GET (collapses 4,000 GET/s to a handful). NOT yet implemented (verified).
4. **Add the kill-switch check to non-Largo `anthropicText`** (13 C-6) — the ledger write is already cross-replica (verified); just gate the reads.
5. **Redis HA + PgBouncer sized for replicas × load**; **readiness-gated rolling deploys** (`/api/ready` wired to healthcheck, 14 E.1).
6. **Polygon: LRU-evict the GEX in-mem map** (not `clear()`), **curated ticker allow-list**, **global force throttle** (12 HIGH-3) + page-count telemetry (12 MED-3).

---

## E. THE TIER-3 SIMULATION — 5,000 concurrent users

**Replica assumption:** horizontal scale-out is unavoidable — at minimum **10 web replicas just for SSE** (5,000 ÷ 500/instance), realistically more for the event-loop + DB-pool budget. At this tier the single-process-does-everything model (web + all WS + all SSE + all Largo loops + all cron work, CPU implicitly capped to `cores−1` via `next.config.mjs:48`) is the **structural ceiling** — 5,000 is not reachable without re-architecting the real-time tier.

### E.1 — What fails FIRST at 5,000

| Rank | Subsystem | Trigger | Quantified | Severity | Finding |
|---|---|---|---|---|---|
| 1 | **UW 2-RPS is physically impossible to share across ~10 replicas via REST polling** | the cluster cap is 2 RPS *total*; 10 replicas each want a slice; Redis-global ceiling is the ONLY enforcement and it fails open | with `UW_MAX_RPS=ceil(2/10)=1` (min 1 due to integer floor), 10 replicas can still emit 10 RPS on a Redis blip = **5× the hard cap** → permanent breaker | **Critical** | S-3, 09 C.1, 11 UW-1 |
| 2 | **Per-replica UW sockets = ~10 multiplex sockets** | one per replica (`init-data-sockets.ts:44`) | likely exceeds UW account WS allowance; 10× flow-persist work | **Critical** | S-4, 11 §7 |
| 3 | **Redis SSE op-rate = 20,000 GET/s** | 5,000 SSE × 4 GET/s (`stream/route.ts:78`) | a single Redis cannot serve 20k GET/s + EVALs + ledger + telemetry; **pub/sub fan-out becomes mandatory, not optional** | **Critical** | S-2, 09 G.1 |
| 4 | **Polygon chain-snapshot ceiling breached by background work alone** | distinct-ticker GEX fan-out (>200 tickers → `clear()` storms wipe hot SPY/SPX) + NW warm with WS off (300 distinct combos × ~3 pages/60s = **900 calls/burst = 22.5 s solid chain traffic/min**) | exceeds 40 RPS before any user traffic | **Critical** | 12 HIGH-1, HIGH-3 |
| 5 | **Postgres pool = 5 × 10 = 50 connections** + telemetry write storm | must be sized vs `max_connections`; telemetry INSERT volume scales with upstream-call volume × replicas | PgBouncer + telemetry batching/sampling now non-negotiable | **High** | 09 F.1/F.2, 14 G.2 |
| 6 | **Massive connect-blip → cluster-wide 10s-timeout pile-up** | connect errors don't feed the breaker (only 429s do); each request pays full 10s undici timeout | thousands of in-flight requests each block 10s → thread/connection exhaustion; breaker never trips | **High** | 12 MED-2, RT-2 |
| 7 | **Anthropic cost (financial, not stability)** | 1,500 daily-active Largo users | **~$16,680/mo typical → ~$134,700/mo heavy** | **High (cost)** | 13 §5 |

### E.2 — What becomes EXPENSIVE at 5,000

- **Anthropic.** ~$16.7k/mo typical, up to ~$134.7k/mo heavy (13). The kill-switch (`DAILY_AI_SPEND_KILL_USD`) is the *only* hard backstop and a single bad day under the heavy curve is **$4,000–6,000/day** with no stop if unarmed (13 C-6). **Largo prompt caching (13 C-1) becomes a ~$5,000–8,000/mo lever** — currently caching saves ~nothing because the intent-filtered tool list invalidates the prefix every turn.
- **Polygon.** A plan-tier bump or a dedicated chain-snapshot micro-cache service (one process owns the chain fetch for a curated universe; everything else reads Redis) becomes likely (12 §8). **NOT VERIFIED — needs the Massive plan's real RPS ceiling** (40 is the limiter setting, not a confirmed invoice number).
- **Redis + Postgres.** Managed HA tiers; telemetry batching/sampling to stop the INSERT-per-call storm consuming the (now 50-conn) pool.

### E.3 — What becomes UNRELIABLE / SLOW / DANGEROUS at 5,000

- **Correlated fail-open is catastrophic.** A single Redis incident at 20k GET/s removes the UW ceiling (→ 10× cap → permanent breaker), drops the AI ledger to best-effort, and opens the Largo gates — across all 10 replicas simultaneously, while the in-memory cache fallback *masks* the outage from users (09 M.1). At 5,000 this is the defining systemic danger.
- **Cold-start storms.** A market-hours rolling deploy = ~10 replicas each cold-starting (pool + migration + fresh UW socket) → a load spike *during* the deploy, amplifying every per-replica multiplication (14 E.1/E.2). Without warm-on-boot + readiness gating this is an availability risk.
- **Alerting blindness.** Single Discord webhook, no independent dead-man's-switch, Sentry not installed (`@sentry/nextjs` absent — 14 F.1/F.2). At 5,000 the blast radius of an unseen incident (Redis degraded, pool saturated, a cron dead) is the entire paying base, and the 2,000-row `error_events` buffer is minutes of history under a cascade.

### E.4 — Tier-3 verdict + mitigations to reach 5,000

**Not reachable with the current single-process model. Requires re-architecture of the real-time tier:**
1. **Dedicated upstream-ingest worker** (UW flow + Polygon indices + options marks) → Redis pub/sub; web replicas become **pure stateless cache-readers** with one Redis subscriber each. Eliminates the N-UW-socket multiplication AND the per-replica rate-limit bucket problem in one move. **If UW Kafka is entitled** (`uw-docs-index.md:16`), it is the cleanest version of this — single Kafka consumer → Redis, zero per-replica fan-out (11 §7). **NOT VERIFIED — needs UW account Kafka entitlement.**
2. **Stream the tape over the already-open UW socket** — join `option_trades` + `lit_trades` + `price` channels (11 UW-1) and retire `net-prem-ticks`/`flow-per-strike` REST polling for index tickers. At 5,000, WS scales per-replica not per-user — this is the *only* architecturally-correct way to serve live flow without REST fan-out against the 2-RPS budget.
3. **SSE pub/sub fan-out** (mandatory at 20k GET/s) + managed HA Redis sized for the op-rate.
4. **Polygon:** curated GEX ticker universe, single-contract endpoint for NW marks (`/v3/snapshot/options/{underlying}/{contract}` — 12 §5, already a TODO at `polygon-options-gex.ts:46`), connect-level breaker + stale-serve (12 MED-2 / RT-2), chain micro-cache or plan bump.
5. **Postgres:** PgBouncer (transaction) + telemetry batching/sampling + connection budget vs `max_connections` × replicas.
6. **External APM + error aggregation + multi-channel alerting + DR runbook/IaC** (14 F, G.3).

---

## F. Subsystem-by-subsystem tier matrix (breaks-first → survives)

Status legend: ✅ holds · ⚠️ stressed, needs the listed fix · ❌ fails without re-architecture.

| Subsystem | 500 | 1,000 | 5,000 | Binding constraint & fix |
|---|---|---|---|---|
| **Frontend render** | ✅ | ✅ | ⚠️ | `FlowFeed` re-sorts up to 5000 rows/poll client-side (`db.ts:822`, 09 I.1); cap LIMIT to ~500 + edge-cache the identical flows GET. Per-user CPU, not server. |
| **Backend event loop / CPU** | ✅ (1 replica) | ⚠️ (≥2 replicas; loop contended by WS+SSE+req) | ❌ (single-process model is the ceiling) | `next.config.mjs:48` cores−1 build-only; runtime is one loop/replica. Fix: dedicated socket worker (14 C.1). |
| **Postgres pool** | ⚠️ (pool-of-5; PgBouncer unverified) | ⚠️ (5×N; PgBouncer `default_pool_size` is the real ceiling) | ❌→⚠️ (50 conns + telemetry storm) | `db.ts:93`; confirm PgBouncer (14 G.2), batch/sample telemetry (09 F.2). |
| **Redis op-rate** | ⚠️ (2,000 GET/s) | ⚠️ (4,000 GET/s) | ❌ (20,000 GET/s) | `stream/route.ts:78`; **SSE pub/sub fan-out** + HA Redis. |
| **Redis memory** | ✅ | ✅ | ✅ | Short TTLs + `EX` sets + bounded sliding-window keys (09 G.1, J.1). Op-rate is the risk, not memory. |
| **Upstream WS (UW/Polygon)** | ✅ (1 socket/replica) | ⚠️ (N sockets) | ❌ (~10 sockets, likely > account allowance) | `init-data-sockets.ts:44`; single-owner ingest. **NOT VERIFIED — UW WS allowance.** |
| **SSE** | ⚠️ (cap == target) | ⚠️ (needs ≥2 replicas for headroom) | ❌ (needs ~10 + pub/sub) | `stream/route.ts:15` 500/instance; raise cap + pub/sub fan-out. |
| **Crons** | ✅ (single-replica, isolated) | ✅ (don't multiply with web replicas) | ✅ (bounded) | `numReplicas=1` on all crons (14 J); UW cron-drain contention is the only residual (09 C.2). |
| **Polygon REST** | ✅ (concentrated SPX/SPY) | ⚠️ (distinct-ticker fan-out ~75% of 40 RPS) | ❌ (background work alone breaches 40 RPS) | 12 HIGH-1/HIGH-3; LRU + curated tickers + single-contract NW marks. **NOT VERIFIED — 40-RPS plan ceiling.** |
| **UW REST (2 RPS!)** | ✅ (1 replica = cluster cap holds) | ❌ (2×N on Redis blip) | ❌ (≈10× on Redis blip) | `uw-rate-limiter.ts:12,192`; `UW_MAX_RPS=ceil(2/replicas)` + stream the tape. |
| **Anthropic / Claude** | ✅ cost-bounded if kill-switch armed | ✅ (cross-replica ledger verified) | ⚠️ (heavy curve ~$135k/mo; non-Largo uncapped) | `ai-spend-ledger.ts:52`; arm `DAILY_AI_SPEND_KILL_USD`, gate non-Largo, cache Largo prompt. |
| **Clerk** | ✅ | ✅ | ⚠️ (per-request auth at 4–6k req/s) | per-request middleware parse (09 H.2); see §J. **NOT VERIFIED — Clerk plan MAU/rate limits.** |
| **Railway replicas** | ✅ (1) | ⚠️ (≥2 activates per-replica fixes) | ❌ (~10 + re-architecture) | `railway.toml` no `numReplicas`; pin it + document replica-coupled env (14 C.2). |

---

## G. Per-tier "breaks-first" ordering (one-line summary)

- **@500 (1 replica):** SSE cap (== target) → PG pool-of-5 (if no PgBouncer) → Redis 2k GET/s → SPX-play 502 storm → telemetry write volume. *UW cap holds at 1 replica.*
- **@1,000 (≥2 replicas):** UW 2-RPS doubles on any Redis blip → N UW sockets → SSE cap/instance → Redis 4k GET/s → PG pool 5×N. *Adding replicas is the trigger for the top 3.*
- **@5,000 (~10 replicas):** UW 2-RPS impossible via REST → ~10 UW sockets > allowance → Redis 20k GET/s → Polygon chain ceiling breached by background warming alone → Massive-blip 10s-timeout pile-up → Anthropic heavy-curve cost. *Real-time tier must be re-architected.*

---

## H. Mitigation roadmap (what to build, in order, to reach each tier)

| To reach | Build / change | Unblocks | Finding | Effort | NOT VERIFIED gate |
|---|---|---|---|---|---|
| **500** | Confirm PgBouncer (transaction mode) + Postgres backups/PITR; log active DB target at boot | PG pool | 09 F.1, 14 G.2 | config | PgBouncer presence/mode, `max_connections` |
| **500** | Raise `SSE_MAX_STREAMS` above 500 **or** add a 2nd replica + apply §D fixes; load-test SSE fan-out | SSE cap | 09 H.1 | config + test | — |
| **500** | SPX-play stale-serve on Massive blip (last-good + `degraded:true`, 200 not 502) | flagship reliability | RT-2, 15 | small code | — |
| **500** | Arm `DAILY_AI_SPEND_KILL_USD` in prod; verify cross-replica ledger writing | AI cost backstop | 13 C-6 | config | env set in prod? |
| **500** | Set `DISCORD_OPS_WEBHOOK_URL`; add EXTERNAL uptime monitor on `/api/ready`; install `@sentry/nextjs` | observability | 14 F.1/F.2 | config + dep | ops webhook set? |
| **1,000** | `UW_MAX_RPS=ceil(2/replicas)`; make `REDIS_URL` required (fail-closed) when replicas>1; pin web `numReplicas` | UW cluster cap | 09 C.1, 14 C.2 | config | replica count |
| **1,000** | Decouple WS ingestion to ONE owner (ingest worker → Redis pub/sub) | N-socket multiplication | 09 H.3, 14 C.1, 11 §7 | **service** | UW WS allowance |
| **1,000** | SSE pub/sub fan-out (1 subscriber/replica) replacing 250ms per-conn GET | Redis op-rate | 09 G.1/H.1 | code | — |
| **1,000** | Gate non-Largo `anthropicText` on the kill-switch ceiling | AI cost | 13 C-6 | small code | — |
| **1,000** | Polygon: LRU-evict GEX map (not `clear()`), curated ticker allow-list, global force throttle, page telemetry | Polygon fan-out | 12 HIGH-3, MED-3 | code | 40-RPS ceiling |
| **1,000** | Readiness-gated rolling deploys (`/api/ready` → healthcheck); warm-on-boot | cold-start storms | 14 E.1 | config + code | — |
| **5,000** | Dedicated socket/ingest worker (or **UW Kafka** consumer) → web replicas pure stateless cache-readers | real-time tier | 11 §7, 14 C.1 | **re-arch** | UW Kafka entitlement |
| **5,000** | Stream the UW tape (`option_trades`/`lit_trades`/`price`); retire index-ticker REST polling | UW budget | 11 UW-1 | code | UW WS allowance |
| **5,000** | Polygon single-contract NW marks + connect-breaker + stale-serve + chain micro-cache / plan bump | Polygon ceiling | 12 §8, MED-2 | re-arch | Massive plan |
| **5,000** | Managed HA Redis (sized for 20k GET/s) + PgBouncer + telemetry batching/sampling | data tier | 09 F.2, 14 G | infra | Redis/PG plans |
| **5,000** | External APM + error aggregation + multi-channel alerting + DR runbook/IaC | ops | 14 F, G.3 | infra + code | region/DR posture |

---

## I. New simulation findings (per-issue blocks)

These are the scaling findings this pass surfaces or sharpens beyond 09/11/12/13/14. Each: Title · Severity · File:line + snippet · Why · Impact@500/1k/5k · Fix · Example.

### S-1 · SSE pulse cap (500/instance) lands EXACTLY on the launch target with zero headroom · **Critical**
- **File:** `src/app/api/market/spx/pulse/stream/route.ts:15,21`
  ```ts
  const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 500);
  if (activeStreams >= MAX_STREAMS) { /* 503 Too many active streams */ }
  ```
- **Why:** The cap is **per instance** and the default is exactly 500. Web `numReplicas` is unset = 1 (`railway.toml`). So a single replica rejects the 501st concurrent pulse SSE with a 503 — the cap is the launch target itself.
- **Impact:** **@500:** the 501st live-desk user 503s — a hard wall AT the target. **@1,000:** needs ≥2 replicas purely for SSE headroom (then §D per-replica fixes bite). **@5,000:** needs ~10 replicas + pub/sub fan-out or the GET op-rate (E.1 rank 3) makes per-connection SSE infeasible regardless of cap.
- **Fix:** Raise `SSE_MAX_STREAMS` with fd-limit headroom AND replace the per-connection 250ms GET with a single Redis pub/sub subscriber/replica (collapses op-rate; lets one replica hold many more streams). Load-test SSE fan-out at target before launch.
- **Example:** `SSE_MAX_STREAMS=1500` per replica + pub/sub fan-out so 1 replica serves 1,500 streams off one subscriber instead of 1,500 × 4 GET/s.

### S-2 · SSE Redis-GET op-rate scales 4×users and has no pub/sub fan-out — Redis is the first cluster bottleneck · **High**
- **File:** `src/app/api/market/spx/pulse/stream/route.ts:78` (`setInterval(() => { void send(); }, 250)`), each `send` does `redis.get("spx:pulse:snapshot")` (`:49-51`).
- **Why:** Every SSE connection polls Redis every 250ms = **4 GET/s/connection**. The snapshot is identical for all users (one shared key) yet each connection reads it independently — there is no per-replica subscriber that reads once and fans out.
- **Impact (formula `users × 4 GET/s`):** **@500 = 2,000 GET/s**; **@1,000 = 4,000 GET/s**; **@5,000 = 20,000 GET/s** — plus rate-limit EVALs (1/upstream call), cross-replica AI-ledger INCRBYFLOATs, telemetry rollup, and cache reads on the SAME Redis. A single Railway Redis is the cluster bottleneck by 1,000 and infeasible at 5,000; its slowdown triggers the fail-open cascade (M.1) for every replica at once.
- **Fix:** One Redis **pub/sub** subscriber per replica on a `spx:pulse` channel; the snapshot writer `PUBLISH`es on change; each SSE connection reads from an in-memory local copy. Collapses 20,000 GET/s → a handful of SUBSCRIBE channels + N local pushes.
- **Example:** publisher `redis.publish("spx:pulse", json)` on snapshot update; per-replica `sub.subscribe("spx:pulse")` → `latest = msg`; SSE `send()` reads `latest` (no Redis round-trip).

### S-3 · UW 2-RPS cluster cap is enforced ONLY by Redis, which fails open — multi-replica turns the hard cap into 2×N RPS · **Critical (at replicas>1)**
- **File:** `src/lib/providers/uw-rate-limiter.ts:12` (`MAX_RPS = envNumber("UW_MAX_RPS", 2)` — per replica), `:168-195` `acquireGlobalRedisSlot` returns `true` on `!client` or any Redis error (fail-open).
- **Why:** The cluster-wide 2-RPS ceiling lives only in the Redis sliding-window Lua. When Redis is unset/unreachable/throws, each replica falls back to its OWN local 2-RPS bucket. With N replicas that is **2 × N RPS** to a provider whose documented hard cap is 2 RPS cluster-wide.
- **Impact:** **@500 (1 replica):** dormant — local bucket == cluster cap, so it holds even with Redis down. **@1,000 (2 replicas):** a Redis blip → 4 RPS → sustained 429s → breaker 45s (`:277`) → platform-wide stale UW desk. **@5,000 (~10 replicas):** `ceil(2/10)` floors to 1 RPS local, so 10 replicas can still emit 10 RPS on a Redis blip = 5× cap → permanent breaker. REST polling cannot share 2 RPS across 10 replicas — the tape must move to WS (11 UW-1).
- **Fix:** Set `UW_MAX_RPS=ceil(2/replicas)` AND treat `REDIS_URL` as required (fail-closed: if Redis is down and replicas>1, pause UW rather than fall open). Emit a metric from the `acquireGlobalRedisSlot` catch (`:192`) so a fail-open window is visible (11 UW-9). Ultimately: stream the tape so steady-state UW REST → ~0.
- **Example:** 2 replicas → `UW_MAX_RPS=1`; alarm when fail-open count > 0 during market hours.

### S-4 · Per-request `ensureDataSockets()` opens one UW multiplex socket PER REPLICA — sockets multiply with horizontal scale · **High**
- **File:** `src/lib/ws/init-data-sockets.ts:44` (idempotent per process), invoked from per-request handlers (`quote/route.ts`, `spx/desk/route.ts`, `spx/pulse/stream/route.ts`, …, verified list this pass). `instrumentation.ts:28` deliberately does NOT boot sockets.
- **Why:** The socket singleton is per-process, so each replica opens its own UW multiplex + Polygon indices + (optional) options sockets on its first request. This is correct for 1 replica but multiplies with N.
- **Impact:** **@500 (1 replica):** ideal — one socket, all 500 users share it. **@1,000 (2 replicas):** 2 UW sockets, 2× idempotent flow-persist (correct via `ON CONFLICT` but wasteful). **@5,000 (~10 replicas):** ~10 UW sockets — likely exceeds the UW account WS connection allowance, and 10× the persist work; a market-hours rolling deploy briefly doubles that.
- **Fix:** Move upstream WS ingestion to a single dedicated worker service that publishes to Redis pub/sub; web replicas subscribe (one consumer each), never open upstream sockets. If UW Kafka is entitled, consume Kafka instead. **NOT VERIFIED — needs UW account WS connection allowance + Kafka entitlement.**
- **Example:** new `ingest-worker` Railway service runs `ensureDataSockets()`; web replicas drop the per-request call and read `tideStore`/`gexStore`/flow from Redis pub/sub.

### S-5 · Cross-replica AI ledger is correct, but only the Largo route reads the kill-switch ceiling · **Medium**
- **File:** `src/app/api/market/largo/query/route.ts:182` (`if (await isLargoKillSwitchTripped())`), ledger `src/lib/ai-spend-ledger.ts:52-53` (`AI_SPEND_INCR_LUA`), writers `src/lib/providers/anthropic.ts:283,364,372,439` (`trackSpend` from every path).
- **Why:** Verified: every Anthropic call (Largo loop AND every `anthropicText` surface) **writes** to the shared-Redis ledger via `trackSpend`. But the ceiling **check** (`isLargoKillSwitchTripped`) is consulted only by Largo. NH synthesis/critic/explainer, SPX commentary, GEX/flow/NW narrative, and the SPX play-gate write to the ledger but never read it — they keep spending after the org switch trips.
- **Impact:** **@500/1,000:** low — the non-Largo surfaces are shared-cache readers with bounded volume (NH 1/day, commentary 78/day, GEX ~1,300/day). **@5,000:** if a non-Largo batch caller (e.g. a Night Hawk synthesis loop bug, or GEX-explain stampede after a Redis flush) runs away, it is uncapped by the kill-switch — the one absolute backstop doesn't cover it.
- **Fix:** Lift the `isLargoKillSwitchTripped` (or `isOverAiSpendCeiling(currentTotal, aiSpendKillSwitchUsd())`) check into `anthropicConfigured()`/the `anthropic.ts` helpers themselves, so ALL surfaces short-circuit when the org ceiling trips — not just Largo.
- **Example:** in `anthropicText`/`anthropicToolLoop`, before the API call: `if (await isOverAiSpendCeiling(await getOrgSpendToday(), aiSpendKillSwitchUsd())) throw new AiCeilingError()` (best-effort, fail-open on Redis down to avoid blocking on a blip).

### S-6 · `nights-watch-warm` runs every MINUTE and, with options WS off, warms paginated chains for ALL open positions — background load scales with distinct positions, not concurrent users · **High (at 1k+ with WS off)**
- **File:** `railway.nights-watch-warm.toml:16` (`cronSchedule = "* 11-21 * * 1-5"` — every minute RTH); chain fetch `polygon-options-gex.ts:47-65` (`fetchNwOptionChain`), gated by `OPTIONS_WS_ENABLED` (`options-socket.ts:37`).
- **Why:** If `OPTIONS_WS_ENABLED` is off (**NOT VERIFIED — needs Railway env**), Night's Watch live marks come from paginated chain snapshots per (underlying, expiry). The warm cron fires **every 60s** for every distinct open-position chain. The shared cache collapses users on the SAME chain but not DISTINCT chains — so this scales with the *distinct-open-positions* population, which grows with the user base.
- **Impact:** **@500:** positions cluster on SPX/SPY 0DTE → a handful of keys → fine; with WS on, zero cost. **@1,000:** ~50–150 distinct (underlying, expiry) keys × ~3 pages / 60s. **@5,000:** hundreds of distinct combos → `300 × ~3 pages / 60s = 900 calls/burst = 22.5 s of solid chain traffic every minute` just to warm (12 HIGH-1), blocking the desk/GEX lanes and saturating the 40-RPS Polygon ceiling from background work alone.
- **Fix:** (1) Confirm `OPTIONS_WS_ENABLED=true` in prod (turns this into zero marginal cost — the WS union covers all held contracts). (2) Migrate warming to the single-contract endpoint (`/v3/snapshot/options/{underlying}/{contract}`, TODO at `polygon-options-gex.ts:46`) — N tiny calls instead of M paginated band scans. (3) Cap warm-cron chain fetches per run cluster-wide.
- **Example:** at 5,000 users, a per-run cap of e.g. 200 chain fetches with priority to most-recently-viewed positions; the rest age out to the 30s NW cache + WS.

### S-7 · Largo prompt caching saves ~nothing today — the dominant per-user cost is un-mitigated and grows linearly to 5,000 · **High (cost)**
- **File:** `src/lib/providers/anthropic.ts:344` (system+tools+messages passed straight through), tool filtering `src/lib/largo/tool-defs.ts:483-527`, single cache breakpoint `src/lib/largo-terminal.ts:74-81`.
- **Why:** The only `cache_control` breakpoint is on `LARGO_SYSTEM_PROMPT` (~1,270 tok), but tools render *before* system in the prefix and the tool set is **intent-filtered per question**, so a changed tool list invalidates the entire cached prefix. The ~32K input tok/typical-turn (history + accumulated tool results re-sent every round) is never cached (13 C-1).
- **Impact:** Largo is the ONLY surface that scales linearly with users. **@500 ≈ −$500–800/mo** avoidable, **@1,000 ≈ −$1,000–1,600/mo**, **@5,000 ≈ −$5,000–8,000/mo** of avoidable input billing. The lever grows exactly as the user base grows.
- **Fix:** Send the **full, name-sorted** tool set every turn (stable prefix) instead of intent-filtering; add a 2nd `cache_control` breakpoint on the last tool def (caches tools+system together) and a 3rd on the prior turn's last message (multi-turn history reuse). Verify with `usage.cache_read_input_tokens`.
- **Example:** `const tools = [...LARGO_TOOL_DEFS].sort((a,b)=>a.name.localeCompare(b.name)); tools.at(-1).cache_control = { type: "ephemeral" };`

### S-8 · Telemetry INSERT-per-upstream-call competes with user reads for the pool-of-5 and scales with replicas · **High**
- **File:** `src/lib/api-telemetry-persist.ts:12-42` (1 INSERT/event via pooled connection), `src/lib/api-telemetry.ts:241` (no sampling gate on persist).
- **Why:** Every Polygon/UW/Anthropic fetch writes one row. Volume scales with upstream-call volume × replicas, and each INSERT consumes a slot from the 5-connection pool (`db.ts:93`) that user reads also need.
- **Impact:** **@500 (1 replica):** hundreds-of-K to low-M rows/day, competing with reads. **@1,000 (2 replicas):** 2× the INSERT load against a 10-connection cluster pool. **@5,000 (~10 replicas):** the write storm against a 50-connection budget makes batching/sampling non-negotiable; the `event_id` UNIQUE index (`db.ts:478-481`) bloats and slows the ON-CONFLICT check.
- **Fix:** Buffer telemetry in-process and flush as a multi-row INSERT every N rows / M ms; sample non-error events (persist all errors/SLA-breaches, 1-in-K successes); consider a dedicated low-priority pool so telemetry never competes with user reads.
- **Example:** `flushBuffer()` every 2s or 100 rows → `INSERT … VALUES (…),(…),…` one round-trip; `if (!isError && Math.random() > 0.1) return;` to sample.

---

## J. Clerk (auth) tier note

- **Mechanism:** every market-desk API request pays a Clerk middleware auth parse (`authorizeMarketDeskApi`, per 09 H.2). There is no per-user upstream Clerk call on the hot path (session is verified from the request), so Clerk is a **per-request CPU + occasional token-refresh** cost, not a per-user provider fan-out.
- **Impact:** **@500:** 400–650 auth parses/s — fine. **@1,000:** 800–1,300/s. **@5,000:** 4,000–6,500/s — the parse cost is on the same single event loop as everything else (§F backend row), so it compounds the event-loop ceiling, and Clerk's plan may have its own MAU / API rate limits at this tier.
- **NOT VERIFIED — needs the Clerk plan's MAU ceiling + backend API rate limits.** Also `.env.local` holds `sk_test_`/`pk_test_` keys (14 D.1); **confirm prod runs `pk_live_`/`sk_live_`** — a launch correctness blocker independent of scale.

---

## K. Cost trajectory across tiers (from 13, anchored here)

| Tier | Anthropic typical $/mo | Anthropic heavy $/mo | Redis | Postgres | Polygon | Notes |
|---|---|---|---|---|---|---|
| **500** | ~$1,910 | ~$13,700 | small box OK (2k GET/s) | pool-5 + PgBouncer | well under 40 RPS | shared AI ~$275 flat |
| **1,000** | ~$3,555 | ~$27,200 | HA tier (4k GET/s) | 5×N + PgBouncer sized | ~75% of 40 RPS on fan-out | Largo doubles |
| **5,000** | ~$16,680 | ~$134,700 | managed HA (20k GET/s) | 50 conn + batching | plan bump likely | kill-switch is the only backstop |

All $ from 13 (list prices, **NOT VERIFIED** vs contract; token counts char-derived, **NOT VERIFIED** vs prod telemetry). The 7–8× typical→heavy Largo spread is the dominant budgeting risk at every tier; arming `DAILY_AI_SPEND_KILL_USD` (13 C-6) is the launch blocker.

---

## L. Severity roll-up (this section)

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 | S-1 (SSE cap == target), S-3 (UW 2×N on multi-replica) |
| High | 4 | S-2 (SSE Redis op-rate), S-4 (N UW sockets), S-6 (NW-warm chain load), S-7 (Largo caching), S-8 (telemetry write storm) |
| Medium | 1 | S-5 (kill-switch Largo-only) |
| Low | 0 | — |

(7 distinct findings; S-7 and S-8 are High-cost/High-load respectively. These EXTEND, not duplicate, the 09/11/12/13/14 findings cited inline.)

---

## M. Evidence still required (NOT VERIFIED — needs prod/dashboard/invoice)

1. **Web `numReplicas`** (Railway dashboard) — gates whether §D/§E per-replica risks are already live. The single biggest unknown for the whole simulation.
2. **PgBouncer presence + `pool_mode`** + Postgres `max_connections` — gates the pool-of-5 verdict at every tier.
3. **Redis plan: size, HA, persistence, ops/sec headroom** — gates 1,000+ (op-rate is the binding constraint).
4. **`OPTIONS_WS_ENABLED` in prod** — if off, S-6 turns NW warming into per-position REST pressure that breaches Polygon at 5,000.
5. **UW account WebSocket connection allowance + Kafka entitlement** — gates S-4 (N sockets) and the 5,000 re-architecture path.
6. **Massive/Polygon real RPS ceiling** (40 is the limiter setting, not a confirmed invoice number) — every Polygon RPS verdict depends on it.
7. **`DAILY_AI_SPEND_KILL_USD` armed in prod** — the only hard AI-cost backstop.
8. **Clerk plan MAU + backend API rate limits**, and **prod uses `pk_live_`/`sk_live_`** (not the `sk_test_` in `.env.local`).
9. **Container vCPU/RAM** for the web service — gates single-replica throughput and how many replicas each tier truly needs.

---

## N. Bottom line

The cache-reader rule (verified across quote/GEX/desk/NW/flows) makes **500 concurrent feasible on a single replica** — the only hard wall at that tier is the SSE cap landing exactly on the target (S-1) and the pool-of-5/PgBouncer question (09 F.1). **1,000 is reachable but only with the per-replica fixes applied in lockstep with adding replicas** — naively scaling replicas silently doubles the UW load past its 2-RPS hard cap (S-3) and multiplies UW sockets (S-4). **5,000 requires re-architecting the real-time tier:** a single upstream-ingest worker (or UW Kafka) feeding Redis pub/sub, streamed UW tape instead of REST polling, SSE pub/sub fan-out, and a Polygon chain-snapshot strategy that survives distinct-ticker fan-out. The financial backstop (`DAILY_AI_SPEND_KILL_USD`) and the observability gap (single Discord webhook, no Sentry, no external dead-man's-switch) are launch blockers at *every* tier because their blast radius scales with the user base.
