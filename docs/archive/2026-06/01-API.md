# BLACKOUT — Deliverable C: Full API Inventory & Audit

**Scope:** Every internal API route (`src/app/api/**/route.ts`, 75 route files) and every external API integration (Polygon/Massive, Unusual Whales, Anthropic, Whop, Clerk, Tavily/Serper/Brave web-search, internal "engine", Discord). Audited for auth, rate limits, retry/timeout/error-handling/caching, failure modes, unused/risky surfaces, and where cost/quota/throttle breaks at **500 concurrent users**.

**Verdict at a glance:** This codebase is unusually well-defended for a launch of this size. The cache-reader discipline is real (almost every UW accessor is wrapped in `uwCacheGet` → Redis), the limiters are cluster-aware (Redis Lua sliding-window + cross-replica breaker pub/sub), and auth is self-guarded per handler with a documented security model. The launch risks are concentrated in a few places: the **UW 2-RPS cluster ceiling vs. per-ticker user-controlled fan-out**, **per-replica concurrency assumptions that break when you scale horizontally**, and **fail-open behaviors that all collapse to "no protection" the moment Redis is down** (a single shared dependency for limiter, cache, budgets, and concurrency gates).

Method note: read-only review of source. Anything requiring prod/runtime to confirm is marked **Not verified — needs X**.

---

## 1. Internal API Route Inventory

Auth helpers (all in `src/lib/market-api-auth.ts` + `src/lib/admin-access.ts`), per the security model documented in `src/middleware.ts`: the middleware enforces auth **only on page routes**; **every `/api/*` route must self-guard**. Gates used:

- `requireTierApi(minTier)` — Clerk session + tier (cache-first via `resolveUserTier`).
- `authorizeMarketDeskApi(req)` = `authorizeCronOrTierApi(req,"premium")` — cron secret OR premium user.
- `isCronAuthorized(req)` — constant-time Bearer `CRON_SECRET` compare.
- `requireAdminApi()` / `resolveAdminApi()` — Clerk role==="admin" OR email allowlist (`ADMIN_EMAILS`).
- `auth()` (raw Clerk) — used by `/account/*`, `/push/subscribe`, `/membership/sync`.

### 1a. Market data routes (`/api/market/**`)

| Path | Method | Auth | Runtime | Upstream | Caching | Notes |
|---|---|---|---|---|---|---|
| `/market/spx/desk` | GET | premium/cron | nodejs (default) dynamic | UW+Polygon via `buildSpxDesk` | `withServerCache("spx-desk", ~10s, swr:false)` | Cache-reader; boots WS sockets |
| `/market/spx/pulse` | GET | premium/cron | dynamic | Polygon/WS store | server-cache 1s/5s | Fast lane |
| `/market/spx/pulse/stream` | GET (SSE) | premium/cron | nodejs | Redis `spx:pulse:snapshot` | 250ms timer per conn | **MAX_STREAMS=500/instance** |
| `/market/spx/flow` | GET | premium/cron | dynamic | UW (cached) | server-cache | |
| `/market/spx/merged` | GET | premium/cron | dynamic | composite | cached | |
| `/market/spx/signals` | GET | premium/cron | dynamic | DB/signal-log | DB read | |
| `/market/spx/outcomes` | GET | premium/cron | nodejs | DB | DB read | |
| `/market/spx/journal` | GET/POST | premium/cron | nodejs | DB (per-user) | DB | user trade journal |
| `/market/spx/play` | GET | premium/cron | dynamic | DB/engine | cached | |
| `/market/spx/commentary` | GET | premium (`requireTierApi`) | dynamic | **Anthropic** | window-keyed cache | AI; cost path |
| `/market/flows` | GET | premium/cron | dynamic | UW `fetchMarketFlowAlerts` / PG | server-cache (DARK_POOL 30s) | |
| `/market/flows/stream` | GET (SSE) | premium/cron | nodejs | flow-events bridge | MAX_STREAMS=500 | backpressure-aware |
| `/market/flow-brief` | GET | premium/cron | dynamic | **Anthropic** + UW/PG | shared 15-min window cache | one Claude call/15min for all |
| `/market/live` | GET (SSE) | premium/cron | nodejs | Polygon WS via `spxBroadcaster` | shared 1 WS | **no MAX_STREAMS cap** (see F-7) |
| `/market/indices` | GET | premium/cron | nodejs | Polygon | server-cache 5s | clean cache-reader |
| `/market/quote` | GET | premium/cron | nodejs | Polygon WS store + REST | L1 mem + L2 Redis ~1.5s, coalesced | exemplary cache-reader |
| `/market/news` | GET | premium/cron | nodejs | Polygon/Benzinga | server-cache 2min | |
| `/market/heatmap` | GET | premium/cron | nodejs | Polygon/engine | cached | |
| `/market/gex-heatmap` | GET | premium/cron | nodejs | Polygon chain + UW overlays | matrix cache + overlay cache 30s | `?force=1` 8s server throttle |
| `/market/gex-heatmap/explain` | GET | premium/cron | nodejs | **Anthropic** | cached | AI |
| `/market/gex-positioning` | GET | premium/cron | nodejs | Polygon GEX | cached | |
| `/market/dark-pool` | GET | premium/cron | dynamic | UW recent (cached) | server-cache 30s | market-wide |
| `/market/dark-pool/ticker` | GET | premium/cron | dynamic | UW `fetchUwDarkPool` | server-cache + uwCacheGet 2min | **user-controlled `symbol`** (F-2) |
| `/market/earnings-calendar` | GET | premium/cron | dynamic | UW/Polygon | cached | |
| `/market/ticker-search` | GET | **free** (`requireTierApi("free")`) | default | Polygon search | server-cache 5min; key validated | good input bounding |
| `/market/lotto/today` | GET | premium/cron | dynamic | DB/engine | cached | |
| `/market/platform/snapshot` | GET | premium/cron | dynamic | composite | cached | |
| `/market/largo/query` | POST (+SSE) | premium (`requireTierApi`) | dynamic, maxDuration 120 | **Anthropic tool-loop** | per-user concurrency(2)+daily budget | highest cost path (F-1, F-9) |
| `/market/largo/session` | GET | premium | dynamic | DB | DB | session history |
| `/market/nighthawk/edition` | GET | premium/cron | dynamic, maxDuration 60 | DB | cached | |
| `/market/nighthawk/hunt` | POST | premium/cron | dynamic, maxDuration 120 | multi-provider scan | per-user concurrency gate | expensive scan (F-9) |
| `/market/nighthawk/play-explain` | POST | premium/cron | dynamic, maxDuration 60 | **Anthropic** | — | AI |
| `/market/health` | GET | **admin** | nodejs | internal stats | — | mislabeled as market (F-11) |

### 1b. Account / membership / push (`auth()` raw Clerk)

| Path | Method | Auth | Notes |
|---|---|---|---|
| `/account/positions` | GET/POST | `auth()` userId | Per-user isolation; user_id from Clerk never client |
| `/account/positions/[id]` | GET/PATCH/DELETE | `auth()` userId | scoped to userId |
| `/account/positions/[id]/detail` | GET | `auth()` userId | aggregator |
| `/account/personal-alerts` | GET/POST/DELETE | `auth()` userId | per-user alerts |
| `/membership/sync` | POST | `auth()` userId | **Whop SDK live calls**, per-user cooldown (F-8) |
| `/push/subscribe` | POST/DELETE | `auth()` userId | web-push subscription store |
| `/push/send` | POST | **admin** | broadcast push |

### 1c. Admin (`requireAdminApi` / `resolveAdminApi`)

`/admin/me`, `/admin/health`, `/admin/cron-health`, `/admin/incidents`, `/admin/errors`, `/admin/audit-log`, `/admin/analytics/spx`, `/admin/spx/dashboard`, `/admin/options-socket`, `/admin/apis/dashboard`, `/admin/apis/stream` (SSE), `/admin/apis/rescan`, `/admin/apis/events/[id]`, `/admin/nighthawk/run` (maxDuration 300), `/admin/nighthawk/analytics`, `/admin/nighthawk/publish-preview`. All gated. `resolveAdminApi` does a single `clerkClient.users.getUser` (good — no double fetch).

### 1d. Cron writers (`isCronAuthorized` — Bearer `CRON_SECRET`)

All 11 use constant-time compare. Schedules from `railway.*.toml` (all `numReplicas = 1`):

| Cron | Schedule (cron) | Auth | Risk |
|---|---|---|---|
| `flow-ingest` | `*/2 11-21 * * 1-5` | cron | UW writer |
| `spx-evaluate` | `*/5 11-21 * * 1-5` | cron | |
| `uw-cache-refresh` | `*/2 11-21 * * 1-5` | cron | the cache-warmer that keeps UW under quota |
| `nights-watch-warm` | `* 11-21 * * 1-5` (**every minute**) | cron | per-position chain warm (F-5) |
| `gex-eod-snapshot` | (toml) | cron | nodejs maxDuration 120 |
| `gex-alerts` | (toml) | cron | nodejs maxDuration 120 |
| `nighthawk-outcomes` | `30 20,21 * * 1-5` | cron | |
| `nighthawk-edition` (worker) | `*/15 21-23 * * 1-5` | cron | maxDuration 300 |
| `membership-reconcile` | `0 * * * *` (hourly) | cron | Whop+Clerk full scan (F-8) |
| `largo-cleanup` | `0 8 * * 0` | cron | |
| `db-cleanup` | `0 7 * * *` | cron | |
| `cron-staleness-watchdog` | `*/20 * * * *` | cron | |

Note: `gex-eod-snapshot` and `gex-alerts` route files exist and self-guard with `isCronAuthorized`, but I did **not** find a matching `railway.gex-*.toml`, and they are **absent from `cron-registry.ts`** (so the staleness watchdog cannot detect them silently never firing). **Not verified — needs Railway dashboard** to confirm whether these are wired via the UI. (F-13)

### 1e. Public / infra (intentionally unauthenticated)

| Path | Auth | Why public |
|---|---|---|
| `/health` | none | Railway liveness (`healthcheckPath=/api/health`) — minimal, no DB dependency |
| `/ready` | none | readiness |
| `/engine/health` | none | engine liveness |
| `/public/track-record` | none **by design** | sanitized aggregate social proof; `revalidate=300` + `s-maxage=300` |
| `/webhook/whop` | **HMAC** (`whop.webhooks.unwrap`) | Whop billing webhook (F-6) |

The unauthenticated set is small, deliberate, and documented. `/public/track-record` calls `buildPublicTrackRecord()` — confirm it is genuinely PII-free (it claims to be). **Not verified — needs reading `track-record-public.ts`** (out of this section's depth but flag for the data/security section).

`/engine/[...path]` is an allowlisted (`nighthawk/plays`, `heatmap`) read-only proxy to the internal engine, gated premium/cron, with traversal guards and POST disabled — a clean SSRF-resistant design.

---

## 2. External API Integration Inventory

| Provider | Client file | What it does | How called | Limiter / cache | Key env |
|---|---|---|---|---|---|
| **Polygon/Massive** (REST) | `providers/polygon.ts`, `polygon-options-gex.ts`, `polygon-largo.ts`, `gap-proxy.ts` | snapshots, chains, GEX, indices, news, search | `polygonTrackedFetch` → `acquirePolygonSlot` | token bucket 40rps + Redis global 40 + 5-consec-429 breaker; permissive/fail-open | `POLYGON_API_KEY`, `polygon-base-env` (default `market-data-api-host`) |
| **Polygon/Massive** (WS) | `ws/polygon-socket.ts`, `ws/options-socket.ts` | live index aggregates + options marks | singleton per process | `spxBroadcaster` fan-out | `POLYGON_WS_INDICES` (`wss://socket.massive.com/indices`), `OPTIONS_WS_ENABLED` |
| **Unusual Whales** (REST) | `providers/unusual-whales.ts` | flow alerts, GEX, dark pool, tide, NOPE, congress, etc. | `uwGet`→`throttleUwCoalesced`; accessors wrapped in `uwCacheGet` | **2 rps local + 2 rps Redis global** + 8-429-in-60s breaker; coalesced + Redis L2 | `UW_API_KEY`, `UW_API_BASE`, `UW_CLIENT_API_ID` |
| **Unusual Whales** (WS) | `ws/uw-socket.ts` | flow_alerts, off_lit, multiplex channels | singleton per process | reconnect/backoff; auth-fail backoff | `UW_WS_BASE` (`wss://api.unusualwhales.com/socket`) |
| **Anthropic** | `providers/anthropic.ts` | Largo tool-loop, commentary, explains, hunt narration | SDK `messages.create/stream`, `maxRetries:3`, `timeout:20s` | per-process daily $ tripwire (`DAILY_AI_SPEND_ALERT_USD`) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| **Whop** | `lib/whop.ts`, `lib/membership.ts`, `webhook/whop` | billing → tier; webhook + reconcile | `@whop/sdk` paginated `.list()` | per-user cooldown on manual sync | `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, product IDs |
| **Clerk** | `@clerk/nextjs` + `tier-cache.ts`, `admin-access.ts` | auth + tier metadata | `clerkClient.users.getUser/getUserList` | **60s per-user tier cache** | Clerk keys |
| **Web search** | `providers/web-search.ts` | Largo catalyst fallback | `trackedFetch`, first configured provider wins | none (no cache, no retry) | `TAVILY_API_KEY` / `SERPER_API_KEY` / `BRAVE_SEARCH_API_KEY` |
| **Internal engine** | `lib/engine.ts` | optional intel overlay | `fetchEngine` allowlisted prefixes | trackedFetch | `API_BASE`, `DASHBOARD_API_SECRET` |
| **Discord** | `lib/discord-post.ts`, `spx-play-notify.ts` | ops alerts | `fetch`, fire-and-forget | self-guards on missing URL | webhook URL env |

**Shared instrumentation:** all REST goes through `trackedFetch` (`lib/api-tracked-fetch.ts`) which records telemetry, sanitizes URLs/headers/snippets (strips `Authorization`/API keys before persistence — good), and retries on 429/5xx with linear backoff (`delayMs*attempt`) only when `maxRetries` is passed.

**Available-but-unused external surfaces:** `src/lib/uw-docs-catalog.ts` enumerates the **entire UW OpenAPI** (hundreds of endpoints — greeks, ETF exposure/holdings/weights, FTDs, seasonality, FDA calendar, short screener, crypto/forex/commodities, congress detail, earnings transcripts). Many have wired fetchers in `unusual-whales.ts` (`fetchUwEtfTide`, `fetchUwFtds`, `fetchUwSeasonality`, `fetchUwShortScreener`, `fetchUwFdaCalendar`, `fetchUwUnusualTrades`, `fetchUwLitFlow`, `fetchUwScreenerStocks/Contracts`) but **no route or cron reads them** — they're dormant. **Recommendation: AVOID adopting more UW endpoints at launch** — every new UW pull competes for the same 2-RPS cluster budget. `web-search.ts` supports 3 providers but only one is used at a time. Crypto/forex/commodities UW endpoints are catalogued but irrelevant to an SPX-options product — do not adopt.

---

## 3. The UW 2-RPS Ceiling — the central scaling constraint

`UW_MAX_RPS=2`, `UW_GLOBAL_MAX_RPS=2` (Redis Lua sliding window, cluster-wide), breaker at 8×429/60s. The architecture's answer is correct: **per-user features are cache-readers**. `uw-cache-refresh` cron pre-warms market-wide + 4 index tickers every 2 min; nearly every UW accessor is `uwCacheGet`-wrapped (Redis L2 + in-flight dedup); `fetchUwFlowPerStrikeRows` is coalesced AND cached; the SPX desk reads cached lanes. At 500 users hammering the **warm set** (SPX/SPY/QQQ/IWM, market tide, dark-pool recent), UW live-call rate stays near the cron rate, not the user rate. This is the single best thing about the system.

The residual exposure is **off-warm-set, user-controlled tickers** (see F-2) and **fail-open when Redis dies** (see F-3).

---

## 4. Findings

### F-1 · Largo/AI cost & concurrency controls are PER-PROCESS for spend and FAIL-OPEN for budget — org spend is unbounded on a Redis outage
**Severity:** High
**File:** `src/lib/providers/anthropic.ts`, `src/app/api/market/largo/query/route.ts`
**Code reference:**
`anthropic.ts:17` — `const spendTracker = new SpendTracker({ thresholdUsd: Number(process.env.DAILY_AI_SPEND_ALERT_USD) || 50 });` with the comment "per-process daily AI-spend tripwire … the org-wide total is the SUM across replicas."
`largo/query/route.ts:35` — `if (!redis) return { acquired: true, redis: null }; // fail-open: no Redis → no gate` and `:76` `if (!redis) return false; // fail-open: no Redis → no budget gate`.
**Why it's a problem:** The $50 spend alert is per replica and is an **alert, not a cap** — nothing actually stops spending. The per-user concurrency limit (2) and the daily query budget both **fail open** when Redis is unavailable: on a Redis blip every premium user can run unlimited concurrent Largo tool-loops, each up to `maxRounds:12 × maxTokens:4096` plus 16KB tool-results re-sent each round.
**Impact at 500 users:** A Redis outage during market hours removes ALL Largo cost governance simultaneously. 500 premium users × multiple concurrent 12-round tool-loops on Sonnet = a four-figure-per-hour Anthropic bill with no hard stop, only a (per-replica, easily-missed) Discord warning. This is the most expensive uncapped path in the system.
**Recommended fix:** (1) Add a **cluster-wide hard cap** (Redis counter) on concurrent Anthropic calls and a daily org token/$ ceiling that **rejects** (429) rather than alerts. (2) When Redis is down, **fail CLOSED for Largo specifically** (return 503 "AI temporarily unavailable") — the cost asymmetry justifies it, unlike market reads. (3) Make `DAILY_AI_SPEND_ALERT_USD` cross-replica via Redis so the threshold reflects org spend.
**Example:**
```ts
// in acquireLargoSlot — fail CLOSED on no Redis for the AI path
if (!redis) return { acquired: false, redis: null };
```

### F-2 · User-controlled ticker on UW-backed routes can bypass the warm cache and pressure the 2-RPS ceiling
**Severity:** High
**File:** `src/app/api/market/dark-pool/ticker/route.ts`, `src/app/api/market/gex-heatmap/route.ts`
**Code reference:**
`dark-pool/ticker/route.ts:11` — `const symbol = (req.nextUrl.searchParams.get("symbol") ?? "SPY").toUpperCase().slice(0, 6);` → `fetchUwDarkPool(symbol,…)`.
`gex-heatmap/route.ts:50` — `fetchUwFlowPerStrikeRows(ticker, 250)` and `:96` `fetchUwDarkPool(ticker,…)` where `ticker = searchParams.get("ticker")`.
**Why it's a problem:** Caching collapses concurrent/staggered requests **for the same ticker** (per-ticker `uwCacheGet` + route `serverCache`). But the **first** request for any cold, off-warm-set ticker triggers a live UW call. The warm set is only SPX/SPY/QQQ/IWM (+SPX/SPY flow-per-strike). Any other symbol is a cold miss → 1 UW call, and N distinct symbols requested in the same window = N UW calls against a **2-per-second cluster-wide** budget shared by the desk, Largo, Night Hawk, and flow-ingest.
**Impact at 500 users:** If even a few dozen users each pull dark-pool/GEX overlays for different mid-cap tickers within a 2-minute TTL window, you queue dozens of UW calls behind a 2-RPS gate. They serialize (≥0.5s each via `MIN_SPACING_MS=300` + bucket), latency balloons, and a burst trips the 8×429/60s breaker — which then **opens for 45s for the whole cluster**, starving the SPX desk that paying users actually watch. The breaker protects UW, but the collateral damage is the core product going stale.
**Recommended fix:** (1) **Allowlist** the tickers these routes accept to the supported product universe (you already do `resolveOptionsRoot`; reject unknown roots with 400). (2) Add an off-warm-set per-ticker rate budget (e.g. max M new tickers warmed per minute, LRU). (3) Consider serving off-warm-set tickers from Polygon (40 RPS, the comment in `gex-heatmap` already notes the chain is Polygon) and only using UW for the warm set.
**Example:**
```ts
const { optionsRoot, supported } = resolveOptionsRoot(symbol);
if (!supported) return NextResponse.json({ snapshot: null, symbol }, { status: 200 });
```

### F-3 · Every limiter, cache, budget, and concurrency gate FAILS OPEN on Redis loss — single point of correlated failure
**Severity:** High
**File:** `src/lib/providers/uw-rate-limiter.ts`, `polygon-rate-limiter.ts`, `shared-cache.ts`, `uw-shared-cache.ts`, `largo/query/route.ts`, `nighthawk/hunt/route.ts`
**Code reference:**
`uw-rate-limiter.ts:169` — `if (!client) return true;` (no Redis → global slot always granted) and `:192` `catch { return true; }`.
`polygon-rate-limiter.ts:174` — `if (!client) return true; // FAIL-OPEN`.
`server-cache.ts:78` — Redis read returns null on error → falls to upstream.
**Why it's a problem:** Each fail-open is individually defensible (you don't want Redis to take down market reads). But they are **all the same dependency**. When Redis is down: the cluster-wide UW ceiling reverts to **per-replica** 2 RPS (so 3 replicas = 6 RPS to UW, over plan), the Polygon global ceiling vanishes, the shared response caches stop collapsing concurrent users to one upstream call (each replica/process re-fetches), AND the Largo/hunt cost gates open. The exact moment Redis fails is when you have the **least** protection against the upstream-quota and cost blowups, and it's correlated across every subsystem at once.
**Impact at 500 users:** A Redis outage during market hours simultaneously (a) multiplies UW call rate by replica count → sustained 429s + breaker thrash, (b) multiplies Polygon load, (c) removes AI cost caps, (d) drops cache hit-rate so every poll hits upstream. The blast radius is the whole platform, and the per-replica UW pacing means you can silently exceed the UW plan and get the **API key throttled/banned** cluster-wide.
**Recommended fix:** (1) Treat Redis as a **launch-critical dependency** with HA + alerting, not an optional accelerator. (2) For the UW limiter specifically, when Redis is unavailable, **divide the local `UW_MAX_RPS` by an env-configured replica count** (e.g. `UW_MAX_RPS=0.6` per replica when running 3) so degraded mode still respects the cluster plan. (3) Surface a single "Redis degraded" health signal so ops sees the correlated risk immediately. (4) Fail-closed the AI cost gates (F-1).

### F-4 · Per-instance SSE stream cap + per-process concurrency counters assume a replica count the config doesn't pin
**Severity:** High
**File:** `src/app/api/market/spx/pulse/stream/route.ts`, `src/app/api/market/flows/stream/route.ts`, `src/app/api/market/live/route.ts`
**Code reference:**
`pulse/stream/route.ts:14` — `let activeStreams = 0; const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 500);` with a 250ms Redis-GET timer per connection.
`live/route.ts` — **no MAX_STREAMS cap at all** on the Polygon-WS SSE.
**Why it's a problem:** Two coupled issues. (a) The pulse stream issues **one Redis GET every 250ms per open connection**. At the 500-cap that's **2,000 Redis GETs/second per instance** just for pulse heartbeating — plus the flows stream and any others. (b) The cap and the F-9 concurrency counters are **per-process integers**; horizontal scaling multiplies them. 500 concurrent users is exactly the single-instance cap, so you'll run ≥2 instances — at which point `MAX_STREAMS=500` per instance means up to 1000 streams (fine) but the **Redis-GET amplification** (2k/s × instances) and the per-process `activeStreams` give no cluster-wide view. `/market/live` has no cap and can exhaust container FDs.
**Impact at 500 users:** Pulse + flows SSE at scale put thousands of GET/s on the same Redis that the limiters and caches depend on (ties into F-3). If Redis latency rises under that load, every limiter slows and the cache hit path degrades — a self-reinforcing spiral. Uncapped `/market/live` adds unbounded FD/connection growth.
**Recommended fix:** (1) Replace the per-connection 250ms Redis poll with a **single per-instance poller** that reads `spx:pulse:snapshot` once per tick and fans out to all local subscribers (you already have `spxBroadcaster` as the model for `/market/live`). This collapses 2,000 GET/s → ~4 GET/s per instance. (2) Add a `MAX_STREAMS` cap to `/market/live`. (3) Right-size `SSE_MAX_STREAMS` to actual per-instance memory/FD limits and document the intended replica count.

### F-5 · `nights-watch-warm` cron runs every minute and warms one chain PER distinct open-position chain — unbounded UW/Polygon work as users grow
**Severity:** Medium
**File:** `railway.nights-watch-warm.toml`, `src/app/api/cron/nights-watch-warm/route.ts`, `cron-registry.ts:80`
**Code reference:** `railway.nights-watch-warm.toml` — `cronSchedule = "* 11-21 * * 1-5"` (minute field `*` = every minute). Registry desc: "Pre-warm shared option-chain cache for all open user positions."
**Why it's a problem:** The warm job iterates **every distinct open-position chain across all users** every minute. That set is small today (<10 users) but grows with the user base and with how many distinct contracts 500 users hold. Each distinct chain is a Polygon (and possibly UW) pull. The job has `maxDuration=120`, so if the distinct-chain count × per-chain latency exceeds 120s the warm pass is **truncated**, leaving some users' positions cold → their Night's Watch GETs become live upstream calls (defeating the cache-reader design) or stale.
**Impact at 500 users:** Distinct option chains could reach hundreds. At Polygon 40 RPS that's borderline-OK, but any UW component competes for 2 RPS and won't finish in 120s. Worst case: the warm job partially completes, users with cold chains fall back to live calls, and you get exactly the per-user upstream fan-out the architecture forbids.
**Recommended fix:** (1) Cap distinct chains warmed per pass (LRU by recency/position size) and page across passes. (2) Add a metric for "chains warmed vs. chains needed" and alert when truncated. (3) Confirm the warm path is **Polygon-only** (40 RPS) and never UW for per-user chains.
**Not verified — needs:** reading `nights-watch-warm/route.ts` body + `position-context.ts` to confirm Polygon-only and the distinct-chain query bound.

### F-6 · Whop webhook drops membership changes (HTTP 200) when secret unset OR `user.email` is null — billing/lockout correctness gap
**Severity:** Medium
**File:** `src/app/api/webhook/whop/route.ts`
**Code reference:**
`:31` — when `WHOP_WEBHOOK_SECRET` unset: "Return 200 so Whop does not retry-loop … REQUEST DROPPED".
`:95` — `const email = event.data.user?.email; if (email) {…sync…} else {…log + alert, no sync…}` (no id-based heal path).
**Why it's a problem:** Both branches **acknowledge (200) but do not process** a real membership change. The missing-secret case is loud (startup error + Discord critical) and self-heals via the hourly reconcile. The null-email case is the sharper one: if the Whop app lacks `member:email:read`, **every** webhook silently can't sync, and the reconcile cron also keys on email so it can't heal either. The code documents this honestly but the failure is real.
**Impact at 500 users:** Paid users stuck on `free` (support load, churn) or churned users keeping `premium` (revenue leak). At 500 users the hourly reconcile (F-8) becomes the only safety net, and it shares the same email-keyed blind spot.
**Recommended fix:** (1) Make missing `WHOP_WEBHOOK_SECRET` a **hard deploy gate** (refuse to boot, or fail healthcheck) rather than a runtime warning — it's a single env var. (2) Grant `member:email:read` on the Whop app (operational, not code). (3) Add an **id-based** heal path so reconcile can fix users whose webhooks lacked email.

### F-7 · `trackedFetch` retries are opt-in (`maxRetries` defaults to 0) — provider clients mostly don't pass it, so transient 5xx/429 surface as immediate failures
**Severity:** Medium
**File:** `src/lib/api-tracked-fetch.ts`, callers in `polygon.ts`, `unusual-whales.ts`, `engine.ts`, `web-search.ts`
**Code reference:** `api-tracked-fetch.ts:67` — `const maxAttempts = Math.max(1, (maxRetries ?? 0) + 1);` (default 1 attempt = no retry). `polygon.ts:20` / `unusual-whales.ts:98` call `trackedFetch`/`polygonTrackedFetch` **without** `maxRetries`, so a single 429/503 from the provider throws straight to the caller's catch.
**Why it's a problem:** The retry/backoff machinery exists but is dormant on the hot paths. Polygon/Massive and UW both occasionally 429/5xx under load; without retry, a one-off blip becomes a desk-build failure (`502`), an empty overlay, or a dropped flow page. The breaker handles **sustained** 429 storms, but not the common single transient.
**Impact at 500 users:** Higher request volume → more frequent transient 5xx/429 → more user-visible 502s and empty panels even when the upstream is basically healthy. The system looks flakier than it is.
**Recommended fix:** Pass a small `maxRetries` (1–2) with jittered backoff on the read paths that already tolerate latency (news, indices, dark-pool, GEX matrix). **Do NOT** add retries on the UW hot path that would multiply calls against the 2-RPS budget — gate UW retries behind the breaker/coalescer. Be deliberate per provider.

### F-8 · Membership reconcile + manual sync make live paginated Whop + full Clerk user-list scans — O(users) work that grows with the base
**Severity:** Medium
**File:** `src/lib/membership.ts`, `src/app/api/cron/membership-reconcile/route.ts`, `src/app/api/membership/sync/route.ts`
**Code reference:** `membership.ts:168` — `for await (const membership of whop.memberships.list(params))` then `:177` paginate **all** Clerk users 100 at a time, then `:202` `for (const email of slice) { await syncWhopMembershipForEmail(email) }` — each call itself does Whop member-list + membership-list + Clerk getUserList + per-user metadata update, **sequentially**, capped at `maxEmails=5000`.
**Why it's a problem:** Reconcile is hourly and serial: per email it issues multiple Whop + Clerk API calls. At 500 premium users that's ~500 × (several API calls) sequentially every hour — minutes of runtime, and Whop/Clerk Backend API rate limits become the bottleneck. `maxDuration=300` could truncate it as the base grows.
**Impact at 500 users:** Reconcile may not finish within 300s, leaving tier drift unfixed (re-introducing F-6's leak/lockout). Manual `/membership/sync` is per-user cooldown-gated (good) but still triggers the full multi-call resolve per click.
**Recommended fix:** (1) Bound + page reconcile across runs (cursor) rather than one 5000-email sweep. (2) Add bounded concurrency (e.g. 5–10) to the per-email loop, respecting Clerk/Whop limits. (3) Track reconcile completion/truncation as a cron-health metric.

### F-9 · Per-user concurrency gates (Largo=2, hunt=N) are Redis-keyed but fail open and have no cluster-wide cost cap
**Severity:** Medium
**File:** `src/app/api/market/largo/query/route.ts`, `src/app/api/market/nighthawk/hunt/route.ts`
**Code reference:** `largo/query/route.ts:22` `MAX_LARGO_CONCURRENT = 2`; `hunt/route.ts:40` `shouldRejectHunt(count, maxConcurrentHunts())`. Both `acquire*Slot` return `{ acquired: true }` when `!redis`.
**Why it's a problem:** These correctly bound a **single user's** parallelism, but there is no **global** bound on how many expensive scans/tool-loops run cluster-wide. 500 users × 2 Largo + N hunts each = a large simultaneous fan-out of multi-provider scans and Anthropic calls, all competing for the same UW 2-RPS budget and Anthropic quota. And on Redis loss they all open (F-3).
**Impact at 500 users:** A coordinated burst (e.g. right after a market open or a Night Hawk drop) can launch hundreds of concurrent hunts/Largo sessions, each pulling platform context (UW/Polygon) and Claude — saturating UW (breaker trip → desk stale) and spiking Anthropic spend.
**Recommended fix:** Add a **global** concurrency semaphore (Redis) for the expensive AI/scan endpoints (e.g. cluster max 20 in-flight hunts, 30 Largo loops), returning 429 with Retry-After when exceeded. Pair with F-1's hard cost cap.

### F-10 · Web-search provider calls have no cache and no timeout override — a slow Tavily/Brave call stalls Largo within its 120s budget
**Severity:** Low
**File:** `src/lib/providers/web-search.ts`
**Code reference:** `:24` `trackedFetch("web_search", "/search", "https://api.tavily.com/search", { method:"POST", … cache:"no-store" })` — no `maxRetries`, no per-call timeout, no result caching; called inside the Largo tool-loop.
**Why it's a problem:** No timeout means a hung search provider ties up a Largo tool-round (and a `maxDuration:120` serverless slot). No caching means repeated identical catalyst queries each hit the paid search API.
**Impact at 500 users:** Modest — web-search is a fallback tool, not every query uses it. But concurrent Largo sessions all reaching a slow provider can pile up and eat the AI concurrency budget.
**Recommended fix:** Add an `AbortController` timeout (e.g. 8s) and a short shared cache (5–10 min) keyed by normalized query. Consider a per-day search budget like Largo's.

### F-11 · `/api/market/health` is admin-gated but lives under `/market/*`, and `/admin/options-socket` exposes WS internals — minor namespace/clarity risks
**Severity:** Low
**File:** `src/app/api/market/health/route.ts`, `src/app/api/admin/options-socket/route.ts`
**Code reference:** `market/health/route.ts` imports `requireAdminApi` (correct gate) but the `/market/` prefix implies premium-user data; a future dev pattern-matching "market routes use `authorizeMarketDeskApi`" could mis-gate a sibling. `admin/options-socket` is admin-gated (fine).
**Why it's a problem:** Purely organizational — the auth is correct, but the location invites a future mistake. The security model in `middleware.ts` explicitly warns that "not listed here is NOT a security boundary," so consistency matters.
**Impact at 500 users:** None directly; risk is a future regression mis-gating a `/market/*` route.
**Recommended fix:** Move admin-only health to `/api/admin/market-health` (or add a comment block at the top mirroring the `track-record` "PUBLIC by design" note, but stating "ADMIN by design").

### F-12 · `engine` proxy and `fetchEngine` are solid, but the catch-all allowlist is only 2 paths while `fetchEngine` allows 4 prefixes — drift risk
**Severity:** Low
**File:** `src/app/api/engine/[...path]/route.ts`, `src/lib/engine.ts`
**Code reference:** `engine/[...path]/route.ts:12` `ALLOWED_ENGINE_PATHS = new Set(["nighthawk/plays", "heatmap"])`; `engine.ts:28` `ALLOWED_PREFIXES = ["spx","nighthawk","largo","health"]`.
**Why it's a problem:** Two allowlists with different scopes. The route is the stricter, public-facing gate (good), but the divergence means a reader can't tell at a glance what's actually reachable. Not a vulnerability today (route wins), just maintainability.
**Impact at 500 users:** None.
**Recommended fix:** Document that the route allowlist is the authoritative external surface; keep `fetchEngine`'s broader prefixes for internal server-to-server use only.

### F-13 · `gex-eod-snapshot` and `gex-alerts` crons are not in `cron-registry.ts` — the staleness watchdog is blind to them
**Severity:** Low
**File:** `src/lib/cron-registry.ts`, `src/app/api/cron/gex-eod-snapshot/route.ts`, `src/app/api/cron/gex-alerts/route.ts`
**Code reference:** `cron-registry.ts:16` `CRON_JOBS` lists 11 jobs; neither `gex-eod-snapshot` nor `gex-alerts` appears. Both route files exist with `isCronAuthorized` + `maxDuration=120`.
**Why it's a problem:** `cron-staleness-watchdog` alerts on jobs in the registry. Unregistered crons can **silently never fire** (the exact class of bug the watchdog exists to catch — and the memory note records this happened before with empty editions). No `railway.gex-*.toml` was found in the repo either.
**Impact at 500 users:** If GEX EOD snapshots / alerts silently stop, GEX-dependent features degrade with no alert.
**Recommended fix:** Add both to `CRON_JOBS` (with `stale_after_min`) and confirm a Railway cron service is wired. **Not verified — needs Railway dashboard** to confirm scheduling.

### F-14 · Anthropic 20s default client timeout is tight for tool-loop rounds; final-synthesis pass is guarded but mid-loop rounds rely on SDK retry stacking
**Severity:** Low
**File:** `src/lib/providers/anthropic.ts`
**Code reference:** `:74` `new Anthropic({ apiKey, maxRetries: 3, timeout: 20_000 })`; `anthropicText` allows per-call `timeoutMs`/`maxRetries` overrides but `anthropicToolLoop` does **not** thread them — every round uses the 20s default with `maxRetries:3`.
**Why it's a problem:** A heavy tool-loop round (large GEX/flow tool-results re-sent each round, up to 16KB each) can exceed 20s; the SDK then retries up to 3×, stacking toward ~60–80s before the round resolves or fails. Across 12 rounds this compounds latency unpredictably.
**Impact at 500 users:** Largo responses feel slow/timeout-prone under load; combined with `maxDuration:120` a long loop can be killed mid-synthesis.
**Recommended fix:** Thread a per-loop `timeout` (e.g. 40–60s) and lower `maxRetries` to 1 inside `anthropicToolLoop` rounds so a slow round fails fast rather than stacking; the loop already has a guarded final-synthesis fallback.

---

## 5. Strengths (keep these)

- **Cache-reader discipline is genuine** — `withServerCache`/`serverCache` (in-flight dedup + Redis L2 + SWR + max-stale + bounded Map), `uwCacheGet` on nearly every UW accessor, `/market/quote` as a textbook example (WS-first → L1 → L2 → coalesced upstream).
- **Limiters are cluster-aware** — Redis Lua atomic sliding-window, cross-replica breaker pub/sub with poison-clamp, request coalescing. The UW limiter is the right shape for a 2-RPS plan.
- **Auth is self-guarded and documented** — the `middleware.ts` security contract is explicit; only health/readiness/track-record/webhook are public, each intentionally. `isCronAuthorized` uses constant-time compare. Per-user position/journal/alert routes scope `user_id` from Clerk, never the client.
- **Telemetry sanitizes secrets** — `trackedFetch` strips `Authorization`/keys from URLs/headers/snippets before persistence.
- **SSE hardening** — idempotent teardown, heartbeats, backpressure drop (`sseBackpressureExceeded`), per-instance caps (except `/market/live`).
- **Engine proxy is SSRF-resistant** — allowlist + traversal guard + POST disabled + header-not-querystring secret.

---

## 6. Launch-blocker shortlist (must address before 500-user ramp)

1. **F-1 / F-9** — hard, cluster-wide cost & concurrency cap on Anthropic/Largo/hunt (fail CLOSED for AI on Redis loss).
2. **F-3** — Redis is a launch-critical correlated dependency; HA + degraded-mode replica-aware UW pacing + alerting.
3. **F-2** — allowlist user-controlled tickers on UW-backed routes so off-warm-set fan-out can't trip the cluster breaker and starve the desk.
4. **F-4** — fix the pulse-stream per-connection 250ms Redis poll (single per-instance poller) and cap `/market/live`.

These four are the difference between "scales smoothly" and "Redis hiccup or a few odd tickers takes the desk down and spikes the AI bill."
