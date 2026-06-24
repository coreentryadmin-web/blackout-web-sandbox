# 07 — Tools & Integrations (Deliverable I)

**Scope:** Full inventory of every runtime/dev dependency and every external SaaS / SDK / provider used by `blackout-web`, why each is used, what it talks to, and whether it is necessary / replaceable / risky / expensive / underused / misconfigured. Includes a tool-to-tool data-flow map and a per-issue findings list.

**Canonical root audited:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Method:** READ-ONLY. Versions resolved from `package-lock.json` (installed), not just the `^` ranges in `package.json`. Anything that needs prod/env to confirm is flagged "Not verified — needs X".

---

## A. Dependency inventory (from package.json + resolved lockfile)

### Runtime dependencies

| Package | Range (package.json) | Installed (lock) | Why it's here | Talks to | Verdict |
|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | `^0.105.0` | **0.105.0** | LLM calls — Largo chat tool-loop, SPX play commentary, Night Hawk dossier→plays | `api.anthropic.com/v1/messages` | Necessary. Cost-risk (see I-9). Models pinned in code (see I-10). |
| `@clerk/nextjs` | `^5.7.6` | **5.7.6** | Auth (middleware), user identity, tier metadata store (`publicMetadata.tier`) | Clerk Backend API + `clerk.blackouttrades.com` | Necessary, central. Rate-limit-sensitive (see I-4). |
| `@whop/sdk` | `0.0.40` | **0.0.40** | Billing/membership source of truth; webhook signature verify (`webhooks.unwrap`) | Whop API + Whop webhooks | Necessary. **0.0.x exact pin = supply-chain/stability risk (I-3).** |
| `ioredis` | `5.11.1` | **5.11.1** | Cross-replica cache, rate-limiter global ceiling, breaker pub/sub, telemetry fan-out | Redis host (`REDIS_URL`) | Necessary at 500 users (see I-1). Pinned exact — good. |
| `pg` | `8.21.0` | **8.21.0** | Postgres pool: flow alerts, plays, positions, telemetry, push subs, error_events | Postgres (`DATABASE_URL`) | Necessary. Pool sizing per-replica (see I-2). |
| `next` | `14.2.35` | **14.2.35** | Framework (App Router, API routes, instrumentation hook) | — | Necessary. One major behind 15; instrumentationHook still experimental on 14.2 (I-12). |
| `react` / `react-dom` | `^18` | **18.3.1** | UI | — | Necessary. |
| `ws` | `^8.18.0` | **8.21.0** | Server-side WebSocket client for UW multiplex (header auth) + Polygon/Massive indices + options marks + spx-broadcaster | `wss://api.unusualwhales.com/socket`, `wss://socket.massive.com/indices` | **Necessary** (header-bearing ctor needs the package, not the global). Risk: singleton sockets (I-6). |
| `swr` | `^2.2.5` | **2.4.1** | Client data fetching/polling for desk panels | own `/api/*` | Necessary. Polling cadence drives Clerk/cache load (I-4). |
| `recharts` | `^2.12.7` | **2.15.4** | Charts in 8 components | — | Necessary (8 importers). |
| `framer-motion` | `^11.18.2` | **11.18.2** | Animations ("Living Terminal" visual language), 47 importers | — | Necessary but heavy (bundle weight; not strictly a backend risk). |
| `clsx` | `^2.1.1` | (tiny) | className composition, 82 importers | — | Necessary, trivial. |
| `lucide-react` | `^0.395.0` | (installed) | Icon set | — | **UNUSED — 0 importers in `src/` (I-7). Dead dependency.** |
| `sharp` | `^0.35.1` | **0.35.1** | Next/OG image runtime (implicit) + referenced in power-hour engine | — | Keep (Next image pipeline). Verify it's actually invoked — mostly an implicit Next dep. |

### Dev dependencies (build/test only)
`typescript ^5`, `tsx ^4.19.4` (runs the Night Hawk worker + cron workers in prod via `npx tsx` — so tsx is arguably a *runtime* tool for the worker services, see I-11), `eslint`/`eslint-config-next`/`eslint-plugin-tailwindcss`, `stylelint*`, `tailwindcss ^3.4.4`, `postcss`/`autoprefixer`, `docx ^9.7.1` (one script: `generate-spx-playbook-docx.mjs`), `@types/*`.

### Optional dependencies referenced in code but **NOT installed** (intentional dynamic imports)
- **`@sentry/nextjs`** — referenced in `src/lib/error-sink.ts` via guarded `import("@sentry/nextjs")`. **Not in package.json or lockfile.** Error forwarding to Sentry is therefore dormant; only the DB sink + console work. (I-5)
- **`web-push`** — referenced in `src/lib/push/send-web-push.ts` and `src/app/api/push/send/route.ts` via guarded `import("web-push")`. **Not in package.json or lockfile.** Push notifications are inert by default — VAPID env vars exist but no delivery library is installed. (I-8)

---

## B. External services / providers inventory

| Service | Env var(s) | Client/file | Purpose | Limit / cost posture |
|---|---|---|---|---|
| **Polygon / Massive** (market data primary) | `POLYGON_API_KEY` / `MASSIVE_API_KEY`, `POLYGON_API_BASE` (default `https://api.massive.com`), `POLYGON_WS_INDICES` | `providers/polygon.ts`, `polygon-options-gex.ts`, `polygon-largo.ts`, `ws/polygon-socket.ts`, `ws/options-socket.ts` | Chains, GEX, indices, snapshots, Benzinga news/earnings, real-time index WS | Treated as "unlimited" (40 rps permissive limiter). **The base host is `api.massive.com`, NOT polygon.io** — key must be a Massive key (per memory `project_gex_source.md`). |
| **Unusual Whales (UW)** | `UW_API_KEY`, `UW_API_BASE`, `UW_WS_BASE`, `UW_CLIENT_API_ID` (default `100001`) | `providers/unusual-whales.ts`, `ws/uw-socket.ts`, `uw-rate-limiter.ts`, `uw-shared-cache.ts` | Flow alerts, dark pool, NOPE, tide, GEX exclusives, WS multiplex | **Hard 2 rps cluster-wide** + 120/min plan cap. Most reads are Redis-cache hits. Single most fragile upstream (I-1, I-13). |
| **Anthropic** | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DAILY_AI_SPEND_ALERT_USD` | `providers/anthropic.ts` | Largo agent, commentary, Night Hawk plays | Per-token cost; per-process spend tripwire only (I-9). |
| **Clerk** | (publishable/secret keys; `clerk.blackouttrades.com`) | `middleware.ts`, `membership.ts`, `tier-cache.ts`, `auth-access.ts`, `market-api-auth.ts` | Auth + tier store | Backend API rate-limited; 60s per-user tier cache (I-4). |
| **Whop** | `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_*_PRODUCT_IDS`, `WHOP_*_PLAN_IDS`, `NEXT_PUBLIC_WHOP_*` | `whop.ts`, `membership.ts`, `webhook/whop/route.ts`, `whop-checkout.ts` | Billing → tier; webhook + reconcile cron | Webhook silently drops if secret unset (returns 200, see backend audit). SDK 0.0.x (I-3). |
| **Redis** | `REDIS_URL` | `make-redis.ts` + 6 callers | Shared cache, global rate ceiling, breaker pub/sub, cross-replica telemetry, sync lock | **Single point of contention at 500 users (I-1).** Host/provider not pinned in code — `Not verified — needs prod env`. |
| **Postgres** | `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `PG_POOL_MAX`, `DATABASE_SSL*` | `db.ts` | Durable state | Pool `max` default 5 per replica behind PgBouncer (I-2). |
| **Discord** (webhooks) | `DISCORD_OPS_WEBHOOK_URL`, `DISCORD_PLAY_WEBHOOK_URL`, `DISCORD_FALLBACK_WEBHOOK_URL` | `discord-post.ts`, `spx-play-notify.ts` | Ops alerts + play posts | Free; fire-and-forget; webhook URL = secret (redacted in logs — good). |
| **Web search** (fallback) | `TAVILY_API_KEY` → `SERPER_API_KEY` → `BRAVE_SEARCH_API_KEY` | `providers/web-search.ts` | Catalyst/macro news fallback for Largo/Night Hawk | Three providers, first-configured-wins. Underused/optional. Cost varies. |
| **Sentry** | `SENTRY_DSN` | `error-sink.ts` (dynamic) | Error tracking | **Package not installed → dormant (I-5).** |
| **Web Push (VAPID)** | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `push/send-web-push.ts` | Browser push | **`web-push` not installed → inert (I-8).** |
| **Railway** | `RAILWAY_*`, `CRON_SECRET`, `PORT` | `railway.*.toml`, `cron-registry.ts` | Deploy + cron services | Crons auth via `Bearer CRON_SECRET`. Nixpacks builder. |
| **TradingView** (client embed) | — | CSP in `next.config.mjs` | Chart widget iframe/script | Third-party script (`s.tradingview.com`) allowed in CSP. |

---

## C. Tool-to-tool data-flow map

```
                                  ┌──────────────────────────────────────────┐
   Browser (SWR poll 1–60s) ───▶  │  Next.js API routes (/api/market, /desk)  │
   Clerk session cookie           └──────────────┬───────────────────────────┘
                                                  │ requireTierApi()
                                                  ▼
                                       tier-cache.ts (60s per-user)
                                                  │ miss
                                                  ▼
                                          Clerk Backend API ◀── Whop webhook / reconcile cron
                                                                   (membership.ts → updateUserMetadata)

   Live market data (server, ONE per replica):
     UW WebSocket  ─┐
     Polygon WS    ─┼─▶ in-process stores + Redis sticky keys ─▶ desk/GEX endpoints (cache-readers)
     Options WS    ─┘        (shared-cache.ts / uw-shared-cache.ts)

   On-demand REST (server):
     route ─▶ withServerCache / uwCacheGet (Redis L2 + memory L1)
            └─ miss ─▶ uw-rate-limiter (local bucket + Redis global 2rps + breaker pub/sub) ─▶ UW REST
            └─ miss ─▶ polygon-rate-limiter (local 40rps + Redis global + breaker) ─▶ Massive REST
                          │ both via api-tracked-fetch ─▶ recordApiCall ─▶ api-telemetry(-redis) flush ─▶ Redis

   AI path:
     Largo / commentary / Night Hawk ─▶ anthropic.ts (tool-loop)
            ├─ runTool ─▶ market/flow/GEX cache-readers (+ get_my_positions ─▶ pg)
            ├─ web-search.ts (Tavily/Serper/Brave) on catalyst miss
            └─ trackSpend ─▶ ai-spend ─▶ Discord ops alert on threshold

   Rate-limiter breaker coordination (cross-replica):
     replica trips 429 breaker ─▶ redis-pubsub publish (blackout:uw|polygon:breaker) ─▶ peers Math.max-merge pause

   Alerts/outbound:
     spx-play-notify / instrumentation unhandledRejection / whop webhook failures ─▶ discord-post (primary + fallback)
     gex-alerts cron + push ─▶ send-web-push (web-push pkg, currently absent) ─▶ browser
     error-sink ─▶ pg error_events  (+ Sentry if installed — currently absent)
```

**Key architectural observation (good):** per-user features are cache-readers. The live WS feeds and the cron warmers (`uw-cache-refresh`, `nights-watch-warm`) populate Redis; user requests read Redis. This is the only way the 2 rps UW ceiling survives 500 concurrent users. The integration risk is therefore **not** per-user upstream calls — it is **(a) Redis being a hard dependency for the global ceiling, and (b) the singleton WS sockets being a per-replica single point of failure.**

---

## D. Findings

### I-1 · Redis is a hard scaling dependency but every limiter fails OPEN when it's down
- **Severity:** High
- **File:** `src/lib/providers/uw-rate-limiter.ts`, `src/lib/providers/polygon-rate-limiter.ts`
- **Code reference:**
  - `uw-rate-limiter.ts:168` `async function acquireGlobalRedisSlot(): Promise<boolean> { const client = await getSharedRedis(); if (!client) return true;`
  - `uw-rate-limiter.ts:192` `} catch { return true; }`
- **Why it's a problem:** The cluster-wide 2 rps UW ceiling is enforced *only* through Redis (the `RATE_LIMIT_LUA` sliding window). If `REDIS_URL` is unset, or Redis blips (30s backoff window in `getSharedRedis`), `acquireGlobalRedisSlot` returns `true` and each replica falls back to its **local** bucket (`UW_MAX_RPS` default 2 *per replica*). With N replicas serving 500 users, the effective UW rate becomes N×2 rps with no global coordination — straight past the documented 2 rps cluster cap.
- **Impact at 500 concurrent users:** Almost certainly multiple replicas. A Redis hiccup during market hours silently multiplies UW load → 429 storm → breaker trips → desk/flow data goes stale for all users at once. Fail-open is the correct *availability* choice but it removes the only thing keeping you under the hard UW limit.
- **Recommended fix:** Treat Redis as a tier-0 dependency: alert immediately when `redisGlobal` is false during market hours (the stat already exists in `uwRateLimiterStats()`); lower the per-replica `UW_MAX_RPS` to `ceil(2 / expected_replicas)` as a fail-open floor; and add a managed/HA Redis (not a single Railway Redis box). Confirm replica count — *Not verified — needs Railway service config.*
- **Example:** set `UW_MAX_RPS=1` (or `0.5` with fractional handling) in the web service so two replicas fail-open to ~2 rps total instead of 4.

### I-2 · Postgres pool `max=5` per replica + PgBouncer assumption is unverified for 500-user concurrency
- **Severity:** High
- **File:** `src/lib/db.ts`
- **Code reference:** `db.ts:91-97`
  ```
  return new Pool({
    connectionString: candidate.url,
    max: parseInt(process.env.PG_POOL_MAX ?? "5", 10),
    idleTimeoutMillis: 30_000,
    ...
  ```
  Comment at `db.ts:88`: *"PgBouncer sits in front of Postgres on Railway. … We keep our own pool small (default 5)."*
- **Why it's a problem:** The small pool is only safe **if** PgBouncer is actually in front in transaction-pooling mode. If it is not (Railway Postgres does not deploy PgBouncer by default — it must be added explicitly), 5 connections × N replicas is the real ceiling, and bursts (positions enrichment, telemetry persist, error sink, push subscription reads) will queue behind 5 connections per replica. Conversely if PgBouncer *is* present but in session mode, advisory locks / `SET statement_timeout` (used by `runMigrations`) interact badly with pooling.
- **Impact at 500 concurrent users:** Position-detail, journal, watchlist, and telemetry queries all hit pg. Under load, `connectionTimeoutMillis: 15_000` means requests can hang up to 15s waiting for a connection, then 503. The migration advisory-lock path (`pg_advisory_lock(42)` held on a dedicated client) is correct, but only one cold-start instance can migrate at a time — fine, but a slow migration blocks boot of every replica.
- **Recommended fix:** Confirm PgBouncer presence + mode in Railway (*Not verified — needs prod env*). If absent, add it (transaction mode) or raise `PG_POOL_MAX` deliberately and size against the Postgres `max_connections`. Add a pool-saturation metric.

### I-3 · `@whop/sdk` pinned to a `0.0.40` pre-release — billing depends on a 0.0.x package
- **Severity:** High
- **File:** `package.json`, `src/lib/whop.ts`, `src/app/api/webhook/whop/route.ts`
- **Code reference:** `package.json:22` `"@whop/sdk": "0.0.40"`; webhook verify `webhook/whop/route.ts:75` `event = whop.webhooks.unwrap(body, { headers });`
- **Why it's a problem:** Your entire revenue gate — webhook signature verification, membership resolution, tier assignment — runs through a `0.0.x` SDK. Pre-1.0 packages make no API-stability promises; a future `0.0.x` can change `webhooks.unwrap`, the `MembershipListResponse` shape (already cast with `as unknown as { created_at?: string }` in `membership.ts:111`), or the pagination iterator. The exact pin is good for reproducibility but means you are frozen on an unsupported snapshot and any patch (security or otherwise) is a manual breaking-change review.
- **Impact at 500 concurrent users:** A bad SDK bump silently downgrades paying users to `free` (revenue leak) or rejects valid webhooks (lockouts). The code already defends heavily against the "all empty → free" case (`whop.ts:55-68`), which signals the team knows this is fragile.
- **Recommended fix:** Pin + monitor for a 1.0; add a contract test that exercises `webhooks.unwrap` against a known-good signed fixture and `resolveTierFromMembership` against a fixed membership JSON, so an SDK shape change fails CI rather than prod. Keep the existing reconcile cron as the self-heal safety net (it is the right design).

### I-4 · Tier resolution depends on Clerk Backend API on every cache miss; poll cadence × users can still spike Clerk
- **Severity:** Medium
- **File:** `src/lib/tier-cache.ts`
- **Code reference:** `tier-cache.ts:40-48`
  ```
  const cached = tierCache.get(userId);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) return cached.tier;
  ...
  const user = await clerkClient.users.getUser(userId);
  ```
- **Why it's a problem:** The 60s per-replica `Map` cache collapses most calls to ~1 Clerk `getUser` per user per minute *per replica*. With N replicas and 500 users that is up to 500×N Clerk Backend calls/min at steady state, plus a thundering-herd every 60s when entries expire together (no jitter on TTL). The doc-comment itself notes this cache was added *because* the prior pattern "hit Clerk's Backend API rate limit (surfacing as intermittent 502s)."
- **Impact at 500 concurrent users:** Clerk Backend API limits are per-instance/secret-key; a synchronized 60s expiry wave across replicas can re-trigger the exact 502s this cache was built to fix. Tier is on the hot path of every protected page render and every market API poll.
- **Recommended fix:** Move the tier cache to Redis (shared across replicas, one Clerk call per user per minute *cluster-wide* instead of per-replica), add ±10s TTL jitter to de-synchronize expiry, and treat `publicMetadata.tier` written by the Whop webhook as the primary source so most reads never need a live Clerk fetch.

### I-5 · Sentry forwarding is dead code — `@sentry/nextjs` referenced but never installed
- **Severity:** Medium
- **File:** `src/lib/error-sink.ts`; absence in `package.json` / `package-lock.json`
- **Code reference:** `error-sink.ts:77-78`
  ```
  const spec = "@sentry/nextjs";
  const mod = (await import(/* webpackIgnore: true */ spec)) as unknown as MinimalSentry;
  ```
  Lock check: `grep -c "@sentry" package.json package-lock.json` → `0` and `0`.
- **Why it's a problem:** The "external error tracking" P1 the comment claims to resolve is only half-built. With `SENTRY_DSN` set but the package absent, `getSentry()` silently returns null and **all** errors go to Postgres `error_events` + console only. There is no real-time alerting/grouping/stacktrace UI. At launch this is the difference between seeing a regression in minutes vs. discovering it from `error_events` queries.
- **Impact at 500 concurrent users:** A spike of 500s/unhandled rejections is invisible except as Discord ops pings (only for `unhandledRejection`) and rows in a pruned 2000-row table. No aggregation, no alert thresholds.
- **Recommended fix:** Either (a) install `@sentry/nextjs` and wire the standard Next config, or (b) delete the dormant Sentry branch and document that Postgres + Discord is the error strategy. Do not ship a launch with a half-configured error pipeline that *looks* like Sentry is active.

### I-6 · Singleton per-replica WebSocket managers are a single point of failure for live data
- **Severity:** Medium
- **File:** `src/lib/ws/uw-socket.ts`, `src/lib/ws/polygon-socket.ts`, `src/lib/ws/init-data-sockets.ts`
- **Code reference:** `init-data-sockets.ts:44` `export function ensureDataSockets() { if (initialized) return; initialized = true; ... initUwSocket(); initPolygonSocket(); }`; module-level singletons `let indicesWs: WebSocket | null = null;` (`polygon-socket.ts:39`), `class UwSocketManager` single instance.
- **Why it's a problem:** Each replica holds one UW multiplex socket + one Polygon indices socket + optional options socket. All live desk/GEX/tape data for *every user on that replica* flows through that one socket. If it enters `auth_failed` (5-min backoff, `uw-socket.ts:39`) or stalls, every user on the replica sees stale data until reconnect. Sockets are booted lazily on "first nodejs request" (`instrumentation.ts` comment) — so a replica that has only served static/page traffic may have cold/just-connecting sockets when its first market request lands.
- **Impact at 500 concurrent users:** Uneven freshness across replicas (users on a healthy replica see live data; users on a degraded one see stale), and a `code=1008` reconnect collision is explicitly called out in `init-data-sockets.ts:71` during deploy rollovers. Hard to diagnose because it's per-replica.
- **Recommended fix:** Consider moving the WS feeds into a **dedicated single ingest worker service** (you already have worker services for crons) that writes to Redis, and make all web replicas pure Redis cache-readers — eliminating per-replica socket fan-out entirely. This matches the project's own "cache-reader" scaling rule and removes the deploy-time reconnect collision. *Not verified — needs to confirm whether web replicas currently each open their own UW socket in prod; if so this is a real upstream-connection multiplier too.*

### I-7 · `lucide-react` is an unused dependency
- **Severity:** Low
- **File:** `package.json`
- **Code reference:** `package.json:26` `"lucide-react": "^0.395.0"`; `grep -rl "lucide" src/` → no matches (exit 1).
- **Why it's a problem:** Dead dependency: install/build weight, an extra package in the supply-chain surface, and `^0.395.0` is far behind current lucide-react. Zero importers means it ships nothing useful.
- **Impact at 500 concurrent users:** None at runtime (tree-shaken if truly unimported), but it's audit noise and supply-chain surface. `^0.395` is also pre-1.0 churn-prone.
- **Recommended fix:** Remove it: `npm uninstall lucide-react`. If icons are wanted later, re-add at a current version.

### I-8 · Web Push is inert — VAPID env wired, but `web-push` package not installed
- **Severity:** Medium
- **File:** `src/lib/push/send-web-push.ts`, `src/app/api/push/send/route.ts`; absence in lockfile
- **Code reference:** `send-web-push.ts:36-44` guarded `import("web-push")` returning null on absence; `grep -c '"web-push"' package.json package-lock.json` → `0` and `0`. Gate `vapidConfigured()` checks keys but `loadWebPush()` will always return null.
- **Why it's a problem:** The push subscription endpoint (`/api/push/subscribe`) stores subscriptions in `push_subscriptions`, the `gex-alerts` cron + `/api/push/send` call `sendWebPush`, but **no notification is ever delivered** because the send library is missing. Users can subscribe to alerts that will never fire. This is a silently-broken user-facing feature (personalized GEX alerts), not just dead infra.
- **Impact at 500 concurrent users:** Users opt into push alerts, see nothing, lose trust. Subscriptions accumulate in Postgres with no consumer.
- **Recommended fix:** Install `web-push` and verify an end-to-end delivery, or gate the subscribe UI behind a feature flag until it works. The send code is already written defensively (inert, prune-on-404/410) — it just needs the dependency.

### I-9 · Anthropic spend tripwire is per-process only; no hard cap → unbounded cost at scale
- **Severity:** Medium
- **File:** `src/lib/providers/anthropic.ts`, `src/lib/ai-spend.ts`
- **Code reference:** `anthropic.ts:17-19`
  ```
  const spendTracker = new SpendTracker({
    thresholdUsd: Number(process.env.DAILY_AI_SPEND_ALERT_USD) || 50,
  });
  ```
  Comment `anthropic.ts:15`: *"each replica tracks its own slice, so the org-wide total is the SUM across replicas."* `trackSpend` only **alerts** (Discord warning) once crossed — it never blocks.
- **Why it's a problem:** The tripwire (a) is per-replica, so the org-wide spend is `threshold × replicas` before all replicas have alerted, and (b) is alert-only — there is no kill-switch. Largo is an interactive tool-loop (up to 12 rounds, `anthropic.ts:248`) that any premium user can drive. A handful of heavy concurrent Largo sessions, or a prompt-injection/loop bug, can run cost up with only a lagging Discord ping.
- **Impact at 500 concurrent users:** With more premium users hammering Largo, daily Anthropic spend scales with usage and is bounded only by an advisory alert. No per-user or global daily cap.
- **Recommended fix:** Track spend in Redis (cluster-wide, like the rate limiters already do) and add a hard daily ceiling that degrades Largo to a "budget exhausted" message instead of calling Anthropic. Add per-user round/cost caps. Keep the Discord alert as the early warning.

### I-10 · Anthropic model IDs are hard-coded constants — verify they are current/available
- **Severity:** Low
- **File:** `src/lib/providers/anthropic.ts`
- **Code reference:** `anthropic.ts:50-52`
  ```
  const DEFAULT_MODEL = "claude-sonnet-4-6";
  export const LARGO_MODEL = "claude-sonnet-4-6";
  export const COMMENTARY_MODEL = "claude-haiku-4-5";
  ```
- **Why it's a problem:** Model availability/deprecation is an external dependency. If a model ID is retired or renamed, every AI call 404s/400s and Largo + commentary + Night Hawk all break at once. `ANTHROPIC_MODEL` overrides the default but `LARGO_MODEL`/`COMMENTARY_MODEL` are exported constants used directly, so they cannot be env-overridden without a code change. *Not verified — needs to confirm `claude-sonnet-4-6` / `claude-haiku-4-5` are valid current IDs in your Anthropic account.*
- **Impact at 500 concurrent users:** A model deprecation is a total AI outage requiring a redeploy, not a config change.
- **Recommended fix:** Drive all three from env vars with the current ID as fallback; add a startup probe (one cheap `messages` call) that alerts if the model is rejected; subscribe to Anthropic deprecation notices.

### I-11 · `tsx` runs production worker/cron services but is a devDependency
- **Severity:** Low
- **File:** `package.json`, `railway.nighthawk-playbook.toml` + worker startCommands
- **Code reference:** `package.json:17` `"nighthawk:run": "npx tsx scripts/nighthawk-worker.ts"`; `tsx ^4.19.4` sits under `devDependencies`.
- **Why it's a problem:** If the worker Railway services run `npx tsx ...` and are built with `NODE_ENV=production` / `npm ci --omit=dev`, `tsx` won't be installed and the worker fails to boot. Whether this bites depends on each service's build flags (*Not verified — needs Railway per-service build config*). The Night Hawk Edition pipeline (a launch-critical evening product) depends on it.
- **Impact at 500 concurrent users:** Night Hawk plays silently stop publishing if the worker can't start — exactly the "empty editions" class of failure noted in project memory.
- **Recommended fix:** Either move `tsx` to `dependencies`, precompile the worker to JS in the build, or ensure worker services install dev deps. Add a cron-staleness alert (you already have `cron-staleness-watchdog`) covering the worker job key.

### I-12 · Next.js 14.2 with experimental `instrumentationHook` — one major behind, error-handling relies on an experimental flag
- **Severity:** Low
- **File:** `next.config.mjs`, `src/instrumentation.ts`
- **Code reference:** `next.config.mjs` `experimental: { instrumentationHook: true }`; `instrumentation.ts:19` `export async function register()`.
- **Why it's a problem:** The process-level `unhandledRejection` capture + ops alerting hinges on `instrumentationHook`, which is experimental on 14.2 (stable/default in Next 15). A patch within 14.2.x or a future upgrade could change its semantics. Next 14 is also a major version behind 15; staying on it accrues security/patch lag. (14.2.35 is recent within the 14.2 line — good — but the line itself is EOL-track.)
- **Impact at 500 concurrent users:** Low immediate risk; medium long-term. If the hook regresses, you lose your only process-crash alerting silently.
- **Recommended fix:** Plan a Next 15 upgrade post-launch (instrumentation becomes stable); pin and watch 14.2.x patch releases for security fixes until then. Add a smoke test that asserts `register()` actually installs the listener.

### I-13 · Three web-search providers wired, but it's an optional/underused fallback with divergent cost & no breaker
- **Severity:** Low
- **File:** `src/lib/providers/web-search.ts`
- **Code reference:** `web-search.ts:9-15` (`webSearchConfigured`) + first-wins chain Tavily → Serper → Brave (`:22`, `:50`, `:75`).
- **Why it's a problem:** Three SaaS providers are coded for the same job; only the first configured one is ever used (the others are dead unless the first key is unset). Each has different pricing and rate limits, none is rate-limited/breaker-protected here (unlike UW/Polygon) — it goes straight through `trackedFetch`. Largo/Night Hawk can call this in a loop during a news-heavy session.
- **Impact at 500 concurrent users:** If many Largo sessions trigger catalyst searches concurrently, the chosen search provider can be rate-limited or run up cost with no local throttle/breaker. Maintaining three integrations triples the surface for one rarely-used capability.
- **Recommended fix:** Pick one provider, delete the other two branches (and their env vars from docs), and run it through the same tracked-fetch + simple rate cap as other upstreams. If multi-provider failover is genuinely wanted, make it explicit failover (try next on 429/5xx) rather than first-configured-wins.

### I-14 · `UW_CLIENT_API_ID` defaults to a hard-coded `"100001"` in two places
- **Severity:** Low
- **File:** `src/lib/providers/unusual-whales.ts`, `src/lib/ws/uw-socket.ts`
- **Code reference:** `unusual-whales.ts:24` and `uw-socket.ts:42`: `process.env.UW_CLIENT_API_ID ?? "100001"`.
- **Why it's a problem:** A magic default client-id is duplicated. If UW ties rate accounting or entitlements to the client-api-id, a wrong/shared default could mis-attribute usage or get throttled differently than intended. Duplication means an env change must be remembered in two files (though both read the same env, the fallback constant is copy-pasted).
- **Impact at 500 concurrent users:** Low, but if `100001` is a placeholder it could affect how UW meters your 2 rps / 120-min budget. *Not verified — needs UW account confirmation of what this id should be.*
- **Recommended fix:** Centralize the constant, confirm the correct value with UW, and fail loudly (or warn) if it's left at the placeholder in production.

### I-15 · WS UW constructor cast `as unknown as string[]` papers over a real type mismatch
- **Severity:** Low
- **File:** `src/lib/ws/uw-socket.ts`
- **Code reference:** `uw-socket.ts:259-264`
  ```
  const ws = new WebSocket(buildSocketUrl(), {
    headers: { Accept: "application/json", "UW-CLIENT-API-ID": UW_CLIENT_ID },
  } as unknown as string[]);
  ```
- **Why it's a problem:** The header-bearing 2nd argument is the **Node `ws` package** options object, but it's cast to `string[]` (the WHATWG `protocols` argument) to satisfy the DOM `WebSocket` typing in scope. This works at runtime only because `ws` replaces the global, but the cast means TypeScript is no longer checking that call — a future `ws` major that changes the options shape won't be caught, and a runtime where the global is the WHATWG WebSocket (no header support) would silently drop the auth headers.
- **Impact at 500 concurrent users:** Low directly, but UW auth is via the `token` query param *and* `UW-CLIENT-API-ID` header; if headers are silently dropped on a runtime change, all UW WS auth fails cluster-wide.
- **Recommended fix:** Import `WebSocket` explicitly from `ws` in the server-only socket modules and type the options properly, instead of casting. Removes the global-vs-package ambiguity (also relevant to the `ws` dependency being genuinely required).

---

## E. Version-risk summary

- **Pre-1.0 / churn-prone:** `@whop/sdk 0.0.40` (billing — High, I-3), `lucide-react ^0.395` (unused — remove, I-7).
- **One major behind:** `next 14.2.35` (Next 15 is current; instrumentation still experimental here — I-12).
- **Referenced-but-absent (dynamic optional):** `@sentry/nextjs` (I-5), `web-push` (I-8) — both make a wired feature silently dormant.
- **Exact-pinned (good):** `ioredis 5.11.1`, `pg 8.21.0`, `next 14.2.35`, `@clerk/nextjs 5.7.6`, `@anthropic-ai/sdk 0.105.0`, `@whop/sdk 0.0.40`.
- **Healthy ranges:** `ws`, `swr`, `recharts`, `framer-motion` resolved to recent patches.
- **Build/runtime boundary risk:** `tsx` is a devDependency but runs prod workers (I-11); `docx` correctly dev-only (one script).

## F. Launch blockers (Tools & Integrations)

1. **Redis fail-open removes the only cluster-wide UW 2 rps ceiling (I-1)** — with multiple replicas this can blow the hard UW limit during a Redis blip. Need HA Redis + per-replica floor + market-hours alert before 500 users.
2. **Web Push is a shipped-but-inert feature (I-8)** — users can subscribe to alerts that never deliver because `web-push` isn't installed. Install or hide the feature.
3. **Confirm Postgres pooling reality (I-2)** — `max=5` per replica is only safe behind PgBouncer; verify in Railway or it caps DB concurrency hard at launch.
4. **Whop billing on a `0.0.x` SDK with no contract test (I-3)** — add a signed-fixture verification + tier-resolution test so an SDK bump can't silently downgrade/lock-out paying users.

(Strong recommendation, not strictly a blocker: decide Sentry in/out (I-5), and add a cluster-wide Anthropic hard cap (I-9), before opening the funnel.)
