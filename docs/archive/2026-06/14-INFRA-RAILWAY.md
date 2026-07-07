# 14 — INFRASTRUCTURE / RAILWAY DEPLOYMENT AUDIT

**Scope:** Deployment topology + infrastructure on Railway. Services (web, crons), build config, start command, healthcheck, replica config, env-var inventory, networking, cold-start behavior, resource sizing, monitoring/logging/alerting, backups + disaster recovery. Answers: will Railway support 500 / 1,000 / 5,000 concurrent users, and what must change before launch at each tier.

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web` — same files). **READ-ONLY** on the codebase.

**Method:** Every finding is grounded in a file:line I read. Where a fact depends on the Railway dashboard, a Postgres/Redis plan tier, or an invoice that is not in the repo, it is labelled **NOT VERIFIED — needs X** and states the evidence required. No numbers are invented; estimates show the formula + inputs.

**Cross-references:** This section deliberately does **not** re-litigate the per-replica rate-limiter / pool / SSE findings already exhausted in `09-SCALABILITY.md` and `05-CRON-JOBS.md`; it builds on them from the *deployment/infra* angle (topology, build pipeline, env inventory, networking, cold start, sizing, monitoring, DR). Where a finding is shared, it is cited, not duplicated.

---

## A. Deployment topology — the load-bearing facts

Re-read these before any conclusion below. All are verified from `railway.toml` / `railway.*.toml` / `package.json` / `next.config.mjs` / `src/`.

| Fact | Evidence | Why it matters |
|---|---|---|
| **There is exactly ONE long-running application service** (the Next web server). Everything else is a short-lived cron trigger. | `railway.toml` is the only toml with a real `startCommand` (`next start`) + `healthcheckPath`. | All user traffic, all WebSockets, all SSE, all Largo Claude loops, and all `/api/cron/*` work execute **inside this one service**. There is no separate socket worker, no queue worker, no API gateway. |
| **The web service replica count is NOT pinned in code.** Only the 10 cron services set `numReplicas = 1`. `railway.toml` has no `numReplicas`. | `railway.toml:1-9` (no replica key); `grep numReplicas railway.toml` → NONE; all `railway.*.toml` crons → `numReplicas = 1`. | Replica count is **dashboard-controlled and unknown from the repo**. Single replica today (default). The instant it goes >1, several per-process invariants break (see 09-SCALABILITY C.1/C.4/H.1). **NOT VERIFIED — needs Railway dashboard web-service replica count.** |
| **Crons run the app code over HTTP, not as their own app.** Each cron service builds with `buildCommand = "echo 'cron trigger service: no app build needed'"` and runs `node scripts/hit-cron.mjs /api/cron/<name>`, which `fetch`es the deployed web app with `Bearer CRON_SECRET`, then exits. | every `railway.*.toml` `[build]`/`[deploy]`; `scripts/hit-cron.mjs:1-44`. | The actual cron WORK runs inside the web service process pool — so cron load lands on the same replica(s) and the same Postgres pool-of-5 + Redis that serve users (09-SCALABILITY F.1, C.2). The cron services themselves are near-zero-cost (no node_modules, no build). |
| **No Dockerfile.** Build is Nixpacks with Node 20 pinned. | `nixpacks.toml` = `[phases.setup] nixPkgs = ["nodejs_20"]`; `railway.toml:2` `builder = "nixpacks"`. No `Dockerfile`/`docker-compose`/`Procfile` exist (`ls` → none). | Build is reproducible-ish but image contents are Nixpacks-default; no multi-stage trimming, no `output: "standalone"` (see C.3). |
| **The build runs against the PUBLIC Postgres URL.** | `railway.toml:3` `buildCommand = "DATABASE_URL=$DATABASE_PUBLIC_URL npm run build"`. | Next collects page data at build; routes that touch the DB during build resolve over the **public** endpoint (TLS, slower, billable egress) instead of the private VPC. Functional but a build-time coupling to the DB being reachable (B.4). |
| **Sockets + schema + pool all boot LAZILY on first request, not at process start.** | `instrumentation.ts:28-36` explicitly does NOT boot sockets; `ensureDataSockets()` is called only from nodejs route handlers (`quote/route.ts:134`, `spx/desk/route.ts:14`, `pulse/route.ts:14`, …); schema via lazy `ensureSchema()` (`db.ts:123,624`). | Every rolling deploy ships a **cold** replica: the first user request pays pool-create + ~30-statement migration + WS connect/auth/subscribe before any data exists (cold-start, see E). |
| **Healthcheck is liveness-only and DB-independent.** | `railway.toml:5` `healthcheckPath = "/api/health"`, `healthcheckTimeout = 60`; `health/route.ts:7-16` returns `ok:true` even when Postgres is `"skipped"`/slow. A real readiness probe exists at `/api/ready` (`ready/route.ts:11-15`, 503 on DB unreachable) but **is not wired** to the Railway healthcheck. | Railway will route traffic to a replica whose DB/sockets are not yet warm. Deliberate (liveness must not fail deploy on slow PG) but means "healthy" ≠ "ready to serve data" (E.1). |
| **Single ioredis client per (module,label) per replica; all cross-replica state funnels through one Redis.** | `make-redis.ts:41-60`; callers in shared-cache, rate-limiters, pub/sub, telemetry, Largo gate, membership-sync. | Redis is a tier-0 single point of failure: rate-limit ceiling, AI-spend gate, SSE snapshots, cross-replica telemetry, membership sync all depend on it. Its sizing/HA is **NOT VERIFIED — needs Railway Redis plan** (G). |
| **Postgres pool `max` defaults to 5 per replica; PgBouncer is documented as a manual step, not provisioned in-repo.** | `db.ts:91-96` (`PG_POOL_MAX ?? "5"`); `db.ts:88-90` comment asserts PgBouncer "sits in front"; `PGBOUNCER-SETUP.md` is a **manual runbook** ("click Postgres → Plugins → Add PgBouncer"), i.e. an infra assumption. | If PgBouncer is absent, 5 is the hard concurrent-query ceiling per replica (09-SCALABILITY F.1, the single most likely first hard failure). **NOT VERIFIED — needs prod: is PgBouncer actually in the topology + pool_mode.** |

---

## B. Service & build inventory

### Services (one app + ten crons; two routes orphaned)

| Service | Type | Build | Start / trigger | Replicas | Restart | Healthcheck |
|---|---|---|---|---|---|---|
| **blackout-web** | Long-running Next server | `nixpacks` → `DATABASE_URL=$DATABASE_PUBLIC_URL npm run build` | `next start -H 0.0.0.0 -p $PORT` | **unset (=1 default)** | `on_failure` | `/api/health` (60s) |
| flow-ingest | cron trigger | `echo` (no build) | `hit-cron /api/cron/flow-ingest` `*/2 11-21 * * 1-5` | 1 | never | — |
| spx-evaluate | cron trigger | `echo` | `/api/cron/spx-evaluate` `*/5 11-21 * * 1-5` | 1 | never | — |
| uw-cache-refresh | cron trigger | `echo` | `/api/cron/uw-cache-refresh` `*/2 11-21 * * 1-5` | 1 | never | — |
| nights-watch-warm | cron trigger | `echo` | `/api/cron/nights-watch-warm` `* 11-21 * * 1-5` | 1 | never | — |
| nighthawk-playbook | cron trigger | `echo` | `/api/cron/nighthawk-edition` `*/15 21-23 * * 1-5` | 1 | never | — |
| nighthawk-outcomes | cron trigger | `echo` | `/api/cron/nighthawk-outcomes` `30 20,21 * * 1-5` | 1 | never | — |
| membership-reconcile | cron trigger | `echo` | `/api/cron/membership-reconcile` `0 * * * *` | 1 | never | — |
| db-cleanup | cron trigger | `echo` | `/api/cron/db-cleanup` `0 7 * * *` | 1 | never | — |
| largo-cleanup | cron trigger | `echo` | `/api/cron/largo-cleanup` `0 8 * * 0` | 1 | never | — |
| cron-staleness-watchdog | cron trigger | `echo` | `/api/cron/cron-staleness-watchdog` `*/20 * * * *` | 1 | never | — |
| **gex-eod-snapshot** | route exists, **NO toml, NO registry** | — | **never fires** (B.1) | — | — | — |
| **gex-alerts** | route exists, **NO toml, NO registry** | — | **never fires** (B.1) | — | — | — |

13 `/api/cron/*` routes exist; only 10 have a `railway.*.toml` trigger. See B.1. (This corroborates `05-CRON-JOBS.md` Finding C1 from the infra/toml side.)

### npm scripts that matter to deploy

`build` = `next build`; `start` = `next start -H 0.0.0.0 -p ${PORT:-3000}`. `nighthawk:run` = `npx tsx scripts/nighthawk-worker.ts` exists but is **deliberately not used** by the cron — `railway.nighthawk-playbook.toml` runs the HTTP route instead, because the tsx worker crashes on `server-only` (the toml header documents this). The worker script (`scripts/nighthawk-worker.ts`) is therefore dead in production; only admin/manual invocation could use it.

---

### B.1 — Two GEX cron routes are deployed but have NO Railway trigger and NO watchdog coverage (silently dead writers)
- **Severity:** High
- **File:** `src/app/api/cron/gex-eod-snapshot/route.ts`, `src/app/api/cron/gex-alerts/route.ts`; absence in `railway.*.toml` and `src/lib/cron-registry.ts`.
- **Code reference:**
  - `gex-eod-snapshot/route.ts:10-16` (header): *"the schedule REGISTRATION needs a per-service `railway.gex-eod-snapshot.toml` … Registering that schedule is infra-owned and intentionally NOT done in this PR."* No such toml exists (`ls railway.*.toml` = 11 files, none for gex).
  - `gex-alerts/route.ts:18-24` — same admission.
  - `cron-registry.ts:16-114` — `CRON_JOBS` has 10 entries; neither gex route is present, so `cron-staleness-watchdog` (which iterates `CRON_JOBS`, `cron-staleness-watchdog/route.ts:30`) can never flag them.
- **Why it's a problem (infra angle):** A route with no toml and no registry entry is, from the deployment's point of view, **invisible dead code**. `gex-eod-snapshot` is the *writer* for the day-over-day "vs prior close" GEX history; with no schedule it never runs, so the heatmap's `history_context` stays empty and `gex-alerts` (even if activated via `GEX_ALERTS_PUSH`) has no prior snapshot to diff. The watchdog cannot catch this because there is no *expectation* of a run.
- **Impact (500 / 1,000 / 5,000):** Identical at every tier — a feature silently never works, and the gap scales with the number of users who expect day-over-day heatmap context. No stability impact, but a launch-quality gap that is invisible to monitoring.
- **Recommended fix:** Add `railway.gex-eod-snapshot.toml` (`cronSchedule = "10 20,21 * * 1-5"` ≈ 4:10 PM ET dual-band, mirroring the DST convention used by spx-evaluate/nighthawk-outcomes) and `railway.gex-alerts.toml` (`*/5 11-21 * * 1-5`), and add both keys to `CRON_JOBS` so the watchdog covers them.
- **Example:**
  ```toml
  # railway.gex-eod-snapshot.toml
  [build]
  builder = "nixpacks"
  buildCommand = "echo 'cron trigger service: no app build needed'"
  [deploy]
  startCommand = "node scripts/hit-cron.mjs /api/cron/gex-eod-snapshot"
  cronSchedule = "10 20,21 * * 1-5"
  restartPolicyType = "never"
  numReplicas = 1
  ```

### B.2 — Cron schedule (TOML) is the source of truth, but the dashboard silently overrides it; several tomls document this footgun, none enforce it
- **Severity:** Medium
- **File:** `railway.nighthawk-outcomes.toml`, `railway.nights-watch-warm.toml` (header comments), all `railway.*.toml`.
- **Code reference:** `railway.nighthawk-outcomes.toml` header: *"if cronSchedule was set in the Railway dashboard UI, the dashboard value overrides this TOML — update it there too."* Same warning in `railway.nights-watch-warm.toml`.
- **Why it's a problem:** Config-as-code is only authoritative if no human ever edits the schedule in the dashboard. Railway's precedence (dashboard > toml) means the repo can show one cadence while production runs another, with no drift detection. This is exactly the failure mode that produced the empty-editions incident in project memory (halt fail-closed-on-stale overnight) — a schedule/behavior mismatch invisible from the repo.
- **Impact (500 / 1,000 / 5,000):** A drifted `uw-cache-refresh` or `nights-watch-warm` cadence directly changes cache-warm coverage; at higher user counts a too-slow warm cron means more per-request cache misses hitting upstream (UW 2 RPS), amplifying the rate-limit contention in 09-SCALABILITY C.2.
- **Recommended fix:** Treat the dashboard cron field as forbidden; set every cron schedule ONLY via toml + "Config-as-code" path (the tomls already instruct this). Add a tiny startup assert (or admin panel row) that surfaces each cron's *observed* last-run cadence vs its registry `schedule_label`, so drift is visible (the watchdog already has the data via `buildCronHealthSnapshot`).

### B.3 — `membership-reconcile` runs HOURLY (`0 * * * *`) but its registry label + stale threshold assume 6h; a revenue cron over-runs the full user base 6× more than intended
- **Severity:** Medium
- **File:** `railway.membership-reconcile.toml`, `src/lib/cron-registry.ts:96-104`.
- **Code reference:** toml `cronSchedule = "0 * * * *"` (hourly); registry `schedule_label: "Every 6h"`, `stale_after_min: 13 * 60` (13h). The reconcile paginates the entire Clerk user base + full Whop membership list every run (cross-ref `05-CRON-JOBS.md` Finding C2, `membership.ts:177-211`).
- **Why it's a problem (infra angle):** A full-base reconcile that fans out per-email Whop+Clerk calls is the heaviest non-market cron, and it's firing 6× more often than the design intent. The `stale_after_min=13h` means the watchdog won't alert until ~13h of silence, so an hourly job that quietly starts failing has a huge blind window. This is a config/registry mismatch, not a code bug — the kind of drift the infra owner must reconcile before launch.
- **Impact (500 / 1,000 / 5,000):** Reconcile cost scales with **total registered users**, not concurrent — at 5,000 users an hourly full-base paginate of Clerk + Whop multiplies external-API spend and Postgres writes 24×/day instead of 4×/day, competing with user traffic for the pool-of-5 each run.
- **Recommended fix:** Decide the real cadence. If 6h is intended, set `cronSchedule = "0 */6 * * *"` and keep `stale_after_min` ~13h. If hourly is intended, fix the registry label to "Hourly" and lower `stale_after_min` to ~150 min so a dead hourly job alerts within ~2 runs.

### B.4 — Build couples to the PUBLIC Postgres endpoint; a DB-touching page during `next build` makes deploys depend on public-network DB reachability
- **Severity:** Low
- **File:** `railway.toml:3`, `src/lib/db.ts:49-62`.
- **Code reference:** `buildCommand = "DATABASE_URL=$DATABASE_PUBLIC_URL npm run build"`; `db.ts:52-54` — during `NEXT_PHASE=phase-production-build`, `connectionCandidates()` returns ONLY the public URL.
- **Why it's a problem:** Static generation / route data collection at build time will reach Postgres over the public TLS endpoint. If `DATABASE_PUBLIC_URL` is unset, throttled, or the public endpoint is paused, the **build** (hence the deploy) can fail or hang even though the running app would be fine over the private VPC. It also incurs billable public egress at build time.
- **Impact (500 / 1,000 / 5,000):** No runtime user impact; the risk is deploy reliability, which matters more as you ship fixes under load. Constant across tiers.
- **Recommended fix:** Prefer fully static/`force-dynamic` routes so the build does not need the DB at all (most API routes are already `dynamic = "force-dynamic"`). If a build-time DB read is genuinely required, keep the public-URL override but add a fast-fail timeout so a paused public endpoint doesn't hang the deploy.

---

## C. Resource sizing, build image, and process model

### C.1 — Single process serves web + all WebSockets + all SSE + all Largo Claude loops + all cron work; CPU is implicitly capped to (cores−1) by Next config
- **Severity:** Medium
- **File:** `next.config.mjs:48-52`, `init-data-sockets.ts:44-66`.
- **Code reference:** `next.config.mjs:48` `const cpuCount = os.cpus()?.length || 1;` then `experimental.cpus: Math.max(1, cpuCount - 1)`; one UW multiplex socket + one Polygon indices socket + the env-gated options socket all live in this process (`init-data-sockets.ts:56-65`).
- **Why it's a problem:** Next's server is single-threaded for request handling per process; `experimental.cpus` only parallelizes the *build*, not runtime request handling. So one replica's request throughput is bounded by one event loop that is *also* pumping the UW/Polygon WS message handlers, the SSE 250ms GET timers (09-SCALABILITY H.1), the per-request desk merge, and any Largo tool-loop JSON work. Container vCPU/RAM sizing is **NOT VERIFIED — needs Railway plan**.
- **Impact (500 / 1,000 / 5,000):**
  - **500:** Feasible on one well-sized replica IF Redis/PG are healthy (the cache-reader rule keeps upstream flat) — but the SSE 500/instance cap (09 H.1) lands exactly here, so this is the throughput ceiling for a single replica.
  - **1,000:** One replica is over the SSE cap and the event loop is contended by WS+SSE+requests; needs ≥2 replicas → which then triggers every per-replica fix in 09-SCALABILITY (UW_MAX_RPS, cross-replica AI spend, N WS sockets) plus the WS-owner decoupling in C.2 below.
  - **5,000:** Requires horizontal scale-out *and* decoupling sockets/SSE from the request tier (a dedicated socket/fan-out worker), Redis HA, and PgBouncer. The current single-process-does-everything model does not reach 5,000 without re-architecture of the real-time tier.
- **Recommended fix:** Before 1,000: split the **upstream WS ingestion** (UW flow alerts, Polygon indices, options marks) into a single dedicated Railway worker service that publishes to Redis pub/sub; let web replicas be pure consumers (one Redis subscriber each) and stateless for HTTP. This makes web replicas horizontally scalable without multiplying UW sockets or the local rate-limit buckets, and lets the SSE fan-out come from Redis pub/sub instead of per-connection GET loops. **NOT VERIFIED — needs Railway container vCPU/RAM** to size replica count.

### C.2 — Adding web replicas multiplies upstream WebSocket connections and per-replica rate-limit buckets (deployment-level amplification)
- **Severity:** High (becomes active the moment `numReplicas > 1`)
- **File:** `init-data-sockets.ts:44-66`, `uw-socket.ts` (per-process singleton), `polygon-socket.ts`, `options-socket.ts:45-50`.
- **Code reference:** `ensureDataSockets()` is a per-process idempotent singleton — so **each replica opens its own** UW multiplex + Polygon indices + (optional) options sockets. Options socket sizing is per-process: `OPTIONS_WS_MAX_PER_CONN` ≤1000, `OPTIONS_WS_MAX_CONNS` ≤10 (`options-socket.ts:45,50`).
- **Why it's a problem:** This is the infra-side statement of 09-SCALABILITY C.1/H.3 and 05-CRON C3: the web service has no `numReplicas`, so the natural scaling move (raise replicas) silently (a) opens N UW sockets — UW WS connection slots may be account-limited and N replicas each re-ingest flow alerts (idempotent persist via `ON CONFLICT` but N× the work) — and (b) makes every local rate-limit token bucket per-replica, so the UW 2-RPS cluster cap is enforced ONLY by Redis, which fails open on any blip.
- **Impact (500 / 1,000 / 5,000):** At 500 (single replica) this is dormant. At 1,000+ (multi-replica) it is the dominant launch risk: a Redis blip during market hours → 2×N RPS to UW → 429 storm → breaker → platform-wide stale desk. **NOT VERIFIED — needs UW account WS connection allowance.**
- **Recommended fix:** Pin `numReplicas` explicitly in `railway.toml`; document that raising it requires lowering per-replica `UW_MAX_RPS = ceil(2 / replicas)` and treating `REDIS_URL` as required (fail-closed if unset while replicas>1); and move flow-alert WS ingestion to a single owner (C.1). Mirror 09-SCALABILITY C.1 and 05-CRON C3.

### C.3 — No `output: "standalone"` / no image trimming; cron services carry the full repo
- **Severity:** Low
- **File:** `next.config.mjs` (no `output` key), `railway.toml`, all `railway.*.toml`.
- **Code reference:** `next.config.mjs:50-114` has no `output: "standalone"`. Cron tomls build with `echo` (no node_modules) so they are tiny — good — but the web image is the full Nixpacks build (all `node_modules`, `.next`, source) with no standalone tracing.
- **Why it's a problem:** Larger image = slower cold deploys and more disk. Minor; Railway caches layers. The cron services are already correctly minimal (the `echo` build means they don't install node_modules and `hit-cron.mjs` uses only Node stdlib + global fetch).
- **Impact (500 / 1,000 / 5,000):** Negligible to stability; marginally slower rolling deploys, which matter slightly more when you deploy fixes under load. Constant across tiers.
- **Recommended fix:** Optional — set `output: "standalone"` and a slim start command to shrink the image and speed rolling deploys. Not a launch blocker.

---

## D. Environment-variable inventory

Produced by `grep -rhoE "process\.env\.[A-Z0-9_]+" src scripts | sort -u` (the full set the code reads). **Required?** = app/feature breaks without it. **Secret?** = must be a Railway secret, never committed. Grouped by subsystem. Values are NOT VERIFIED against the live Railway env — this is the *code-declared* surface; presence/values need the dashboard.

### Tier-0 (app degrades hard or insecurely without these)
| Var | Where used | Required? | Secret? | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | `db.ts:50` (private) | **Yes** in prod | **Yes** | `requireDatabaseInProduction()` 503s stateful engines if unset (`db.ts:21-32`). |
| `DATABASE_PUBLIC_URL` | `db.ts:51` + build (`railway.toml:3`) | Build + fallback | **Yes** | Used at build; runtime fallback if private DNS fails (`db.ts:81-86`). |
| `REDIS_URL` | `make-redis.ts` callers; rate-limiters; shared-cache; SSE; Largo gate; telemetry | **Effectively required for multi-replica** | **Yes** | Tier-0 SPOF (G). Code tolerates absence by failing OPEN — which removes the UW ceiling + AI-spend cap (09 M.1). |
| `CRON_SECRET` | `hit-cron.mjs:21`, `market-api-auth.isCronAuthorized` | **Yes** | **Yes** | Same value on web + every cron service. Rotating it on web but not crons silently kills all crons (401, no row → watchdog catches via staleness). |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk middleware/auth | **Yes** | secret / publishable | **`.env.local` currently holds `pk_test_`/`sk_test_` keys** — dev/test Clerk instance, not production. Must be the prod Clerk keys in Railway (D.1). |
| `ANTHROPIC_API_KEY` | Largo + Night Hawk Claude | **Yes** for Claude features | **Yes** | Spend is per-replica tripwire only (09 C.4). |
| `POLYGON_API_KEY` / `MASSIVE_API_KEY` | Polygon/Massive REST + WS | **Yes** for market data | **Yes** | Per GEX-source memory, must be a Massive key (or set `polygon-base-env`). |
| `UW_API_KEY` / `UW_CLIENT_API_ID` | UW REST + WS | **Yes** for UW data | **Yes** | Hard 2 RPS cluster cap. |
| `WHOP_API_KEY` / `WHOP_WEBHOOK_SECRET` / `WHOP_COMPANY_ID` | billing + membership reconcile | **Yes** for paid tiers | **Yes** | Revenue path. `WHOP_*_PLAN_IDS`/`*_PRODUCT_IDS` map tiers. |

### Important (feature-gating / behavior)
| Var | Where used | Required? | Secret? | Notes |
|---|---|---|---|---|
| `PG_POOL_MAX` | `db.ts:93` | No (default 5) | No | The pool-of-5 ceiling (09 F.1). Should be set deliberately per replica count. |
| `UW_MAX_RPS` (`UW_*` family) | uw rate limiter | No | No | The per-replica fail-open floor; must be lowered for multi-replica (C.2). |
| `SSE_MAX_STREAMS` | `pulse/stream/route.ts:15` (default 500) | No | No | Per-instance SSE cap = exactly the 500 target (09 H.1). |
| `SSE_MAX_QUEUED_CHUNKS` | SSE backpressure | No | No | — |
| `OPTIONS_WS_ENABLED` + `OPTIONS_WS_*` | options socket | No (inert off) | No | Night's Watch live marks; sizing `MAX_CONNS`≤10, `MAX_PER_CONN`≤1000. |
| `DISCORD_OPS_WEBHOOK_URL` | `spx-play-notify.ts:54` | No (falls back) | **Yes** | **Currently unset in prod** (RT-3) → ops alerts pollute the play channel. Should be set. |
| `DISCORD_PLAY_WEBHOOK_URL` / `DISCORD_FLOW_WEBHOOK_URL` / `DISCORD_FALLBACK_WEBHOOK_URL` | notify | No | **Yes** | Alert sinks. |
| `SENTRY_DSN` | `error-sink.ts:70` | No (dormant) | **Yes** | Error sink forwards to Sentry only if set AND `@sentry/nextjs` installed — **package not installed** (07-TOOLS I-5), so Sentry is dormant regardless (F.2). |
| `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | web push | No (inert) | private/public | `web-push` not installed → inert. |
| `GEX_ALERTS_PUSH` | `gex-alerts/route.ts` | No (inert) | No | Activation flag for the orphaned gex-alerts cron. |
| `NIGHTHAWK_EDITION_*`, `NIGHTHAWK_OUTCOMES_*`, `NH_DOSSIER_BATCH_SIZE`, `NIGHTS_WATCH_WARM_MAX` | Night Hawk crons | No | No | Cron tuning. |
| `SPX_*` (≈100 vars) | SPX engine tuning | No (defaults) | No | Huge config surface — see D.2. |
| `RAILWAY_REPLICA_ID` / `HOSTNAME` | `api-telemetry-redis.ts:41` | auto (Railway) | No | Per-replica instance id for cross-replica telemetry rollup. |
| `RAILWAY_STATIC_URL` / `RAILWAY_HOSTNAME` | `next.config.mjs:8-12` | auto | No | Image `remotePatterns` host. |
| `PORT` | `railway.toml:6` start | auto (Railway) | No | — |
| `NODE_ENV` / `NEXT_PHASE` / `NEXT_RUNTIME` | runtime gates | auto | No | — |

### Search/intel providers (optional, feature-dependent)
`ALPHAVANTAGE_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, `BLACKOUT_INTEL_API_KEY`, `BLACKOUT_INTEL_URL`, `DASHBOARD_API_SECRET`, `API_BASE`, `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_SITE_URL`, `ENGINE_INTEL_OVERLAY`, `ADMIN_EMAILS` — all secret where they are keys; `ADMIN_EMAILS` gates admin access and must be set correctly in prod.

### D.1 — `.env.local` commits a Clerk TEST keypair (`pk_test_`/`sk_test_`); prod must not inherit it
- **Severity:** High (security/auth)
- **File:** `.env.local`.
- **Code reference:** `.env.local` contains `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…`, `CLERK_SECRET_KEY=sk_test_…`, plus a live-looking `POLYGON_API_KEY` and `UW_API_KEY`.
- **Why it's a problem:** `.env.local` is gitignored (`.gitignore` lists `.env.local`), so it should not be in the repo's tracked tree — but it exists on disk with a **test** Clerk instance and what appear to be **real** Polygon/UW keys. If a deploy ever picks up `.env.local` (it must not — Railway uses dashboard env), or if these test Clerk keys are what prod runs, auth is on a dev Clerk tenant. The real risk: the Polygon/UW keys sitting in a plaintext file on the workstation are a secret-hygiene exposure.
- **Impact (500 / 1,000 / 5,000):** If prod runs `sk_test_` Clerk, sessions/users are on the dev tenant (not launch-viable). Constant across tiers.
- **Recommended fix:** Confirm Railway web service env has **production** Clerk keys (`pk_live_`/`sk_live_`) and that `.env.local` is never shipped. Rotate the Polygon/UW keys that are sitting in plaintext if this file has ever been shared. **NOT VERIFIED — needs Railway dashboard env dump to confirm prod uses live keys.**

### D.2 — ~100 `SPX_*` env knobs are read with inline defaults; no central schema/validation means a typo is a silent default
- **Severity:** Low
- **File:** widespread (`grep process.env.SPX_*`).
- **Code reference:** ~100 `SPX_*` vars (e.g. `SPX_PLAY_MIN_SCORE`, `SPX_LOTTO_MAX_PREMIUM`, `SPX_CLAUDE_DAILY_MAX_CALLS`) each read directly via `process.env` with a fallback default.
- **Why it's a problem:** There is no `env.ts` zod-style schema that validates/parses env at boot. A misspelled var name in the Railway dashboard silently falls back to the default — the operator thinks they tuned the engine but didn't. At this surface size (~100 knobs) drift is likely.
- **Impact (500 / 1,000 / 5,000):** Not a stability/scaling issue; a tuning-correctness/ops issue. Constant across tiers.
- **Recommended fix:** Add a single boot-time env validator that logs (a) every recognized var actually set and (b) any `SPX_*`/`UW_*`/`OPTIONS_WS_*` env present that the code does NOT read (typo detector). Cheap, high ops value.

---

## E. Cold-start & deployment behavior

### E.1 — Every rolling deploy ships a cold replica that boots pool + 30-statement migration + WS connect on the FIRST user request; healthcheck reports ready before any of it
- **Severity:** Medium
- **File:** `instrumentation.ts:28-36`, `db.ts:112-141,624-635`, `init-data-sockets.ts:44-66`, `health/route.ts`, `ready/route.ts`.
- **Code reference:** `instrumentation.ts:28-36` explicitly does NOT boot sockets or run migrations at startup (edge-bundling constraint, documented). Schema builds lazily under advisory lock 42 on first query (`db.ts:127-141`). Sockets boot on the first nodejs route calling `ensureDataSockets()`. `/api/health` returns `ok` regardless of DB/socket warmth (`health/route.ts:10-16`); `/api/ready` (the real probe) is **not** wired to `healthcheckPath`.
- **Why it's a problem:** Railway's healthcheck (`/api/health`, 60s) passes the moment the HTTP server binds, so traffic is routed to a replica whose Postgres pool isn't created, schema isn't migrated, and WS stores (`tideStore`, `gexStore`) are empty. The first burst of user requests races to trigger pool-create + migration (serialized by the advisory lock — others wait up to the 30s statement timeout) and WS connect/auth/subscribe. On a slow-DB moment this compounds with the pool-nuke-on-schema-error path (09 F.3).
- **Impact (500 / 1,000 / 5,000):**
  - **500 (single replica):** One cold start per deploy; a short window of empty WS panels + first-request migration latency. Tolerable but visible.
  - **1,000+ (multi-replica rolling deploy):** Each new replica cold-starts independently; a deploy during market hours means a wave of replicas each opening a fresh UW socket (C.2) and each running the lazy migration check, amplifying load exactly during the deploy. The old replica's graceful SIGTERM (`init-data-sockets.ts:39-41,76-94`) correctly releases UW slots to avoid the 1008 indices collision — that part is good.
  - **5,000:** Cold-start storms become a real availability risk without warm-on-boot + readiness gating.
- **Recommended fix:** (1) Warm schema + pool + sockets in a nodejs-gated boot hook so the first user request is hot (the edge-bundle constraint means it cannot go in `instrumentation.ts` directly — do it via a tiny nodejs-only module the server imports once, or accept the first-request warm but gate readiness). (2) Wire `healthcheckPath = "/api/ready"` (or a new `/api/ready-full` that also checks WS first-data) so Railway only routes traffic to a warm replica. (3) Keep the graceful-shutdown handler. Mirrors 09-SCALABILITY L.1.

### E.2 — `restartPolicyType = "on_failure"` on web with lazy boot means a crash loop can flap the only app service
- **Severity:** Low
- **File:** `railway.toml:7`, `instrumentation.ts:38-74`.
- **Code reference:** `railway.toml:7` `restartPolicyType = "on_failure"`. `instrumentation.ts` installs an `unhandledRejection` handler (no `process.exit`) but deliberately does NOT install `uncaughtException` (header note) — so an uncaught exception still terminates the process and Railway restarts it.
- **Why it's a problem:** `on_failure` is correct for a long-running service, but combined with lazy boot, a deterministic boot-path failure (e.g. a bad migration, a DB that's down) would restart → re-attempt the same lazy migration on first request → fail again → restart, i.e. a flap that the single web service cannot self-heal out of without operator action. There is only one app service, so a flapping web = full outage.
- **Impact (500 / 1,000 / 5,000):** A bad deploy during market hours is a full outage until rolled back; impact scales with concurrent users present. The cron services (`never`) are unaffected.
- **Recommended fix:** Keep `on_failure`. Add a max-restart/backoff awareness in alerting (page on repeated restarts), and move migrations to a one-shot boot step that fails the deploy *before* taking traffic rather than per-request (E.1), so a bad migration fails the deploy cleanly instead of flapping a live replica.

---

## F. Monitoring, logging, alerting

### F.1 — Alerting is a single Discord webhook chain with no independent dead-man's-switch; the watchdog uses the same sink it monitors
- **Severity:** High
- **File:** `spx-play-notify.ts:42-63`, `cron-staleness-watchdog/route.ts`, `error-sink.ts`.
- **Code reference:** `notifyOpsDiscord` posts to `DISCORD_OPS_WEBHOOK_URL` or falls back to `DISCORD_PLAY_WEBHOOK_URL` (`spx-play-notify.ts:53-56`). The cron watchdog alerts via the *same* `notifyOpsDiscord` (`cron-staleness-watchdog/route.ts:38`). `instrumentation.ts:50-57` routes unhandled rejections to the same Discord path.
- **Why it's a problem:** All alerting funnels through one Discord webhook. If that webhook is misconfigured/rate-limited/down, OR the watchdog cron itself (a single Railway service) is dead, there is **no second channel** and no external uptime monitor to catch it. The watchdog is the dead-man's-switch for the other crons, but nothing is the dead-man's-switch for the watchdog or for the web service itself. `DISCORD_OPS_WEBHOOK_URL` is currently unset in prod (RT-3), so ops/infra alerts pollute the trader-facing play channel.
- **Impact (500 / 1,000 / 5,000):** A silent-failure incident (Redis degraded, pool saturated, a cron dead) can go unseen if the one alert channel is impaired — and the higher the user count, the larger the blast radius of an unseen incident. Constant mechanism, scaling impact.
- **Recommended fix:** (1) Set `DISCORD_OPS_WEBHOOK_URL` to a dedicated ops channel now (RT-3). (2) Add an **external** uptime monitor (e.g. a third-party pinging `/api/ready`) as the independent dead-man's-switch for the web service AND the watchdog cron — something outside Railway must watch Railway. (3) Optionally add a second alert sink (email/PagerDuty) for `severity:"critical"`.

### F.2 — No external error tracking is actually live; the durable sink is DB-only and best-effort, console is the primary log
- **Severity:** Medium
- **File:** `error-sink.ts:69-93`, `instrumentation.ts:62-70`, 07-TOOLS I-5.
- **Code reference:** `error-sink.ts:70` returns null unless `SENTRY_DSN` set; `:77-78` dynamic-imports `@sentry/nextjs` which is **not in `package.json`** (deps list has no `@sentry/*`), so Sentry is dormant regardless of DSN. Errors land in the `error_events` table (bounded to 2000 rows, `error-sink.ts:43,122-131`) + `console.error`. Logs otherwise are raw `console.*` to Railway's log stream.
- **Why it's a problem:** "Error tracking" is half-built: the *sink* exists but the *backend* (Sentry) isn't installed, so there is no aggregation, no alerting on error spikes, no stack-trace grouping. The DB sink keeps only the newest 2000 rows — under a failure cascade (09 M.1) 2000 rows is minutes of history. Railway log retention/volume is plan-limited (M.2 in 09).
- **Impact (500 / 1,000 / 5,000):** At 500 a console-only + 2000-row sink is survivable for forensics; at 1,000-5,000, error volume during an incident overruns both the console (Railway log volume/cost) and the 2000-row buffer, so post-incident analysis is blind. Scales worse with users.
- **Recommended fix:** Install `@sentry/nextjs` and set `SENTRY_DSN` (the integration is already wired and dormant) so errors aggregate + alert externally — this also gives the independent error channel F.1 wants. Raise/age-bound `ERROR_EVENTS_KEEP` if the DB remains the sink.

### F.3 — Telemetry-per-upstream-call is the primary metric, persisted as one Postgres INSERT each; there is no metrics/APM system (CPU, mem, event-loop lag, pool waitingCount) wired to alerts
- **Severity:** Medium
- **File:** `api-telemetry-persist.ts`, `api-telemetry-redis.ts`, `db.ts:667-687`.
- **Code reference:** Cross-replica telemetry rolls up via Redis (`api-telemetry-redis.ts`, keyed by `RAILWAY_REPLICA_ID`); `getDatabasePoolStats()` exposes `{total, idle, waiting}` (`db.ts:682`) but nothing alerts on `waiting` (09 F.4). No process metrics (RSS, event-loop lag, GC) are collected.
- **Why it's a problem:** The platform measures *upstream API health* well (the telemetry system is genuinely good) but does NOT measure its OWN runtime health: no event-loop-lag, no memory-pressure, no pool-saturation alert. The single most likely first failure (pool-of-5 saturation, 09 F.1) emits `waitingCount` that nothing reads.
- **Impact (500 / 1,000 / 5,000):** At 500 the first sign of pool/Redis/event-loop trouble is users reporting hangs, not a metric — and the gap widens with load. Constant mechanism.
- **Recommended fix:** Wire `getDatabasePoolStats().waiting` and a periodic event-loop-lag sample into the admin health snapshot + Discord critical path; export Railway's built-in CPU/mem to the same alerting threshold. This is the runtime-health half that the upstream-telemetry system doesn't cover.

---

## G. Redis & Postgres infrastructure (HA / sizing) — NOT VERIFIED, evidence needed

### G.1 — Redis is a tier-0 single point of failure; HA/replication/persistence is NOT VERIFIED and a single Railway Redis box is the likely topology
- **Severity:** High
- **File:** `make-redis.ts:41-60`, all callers; 09-SCALABILITY G.1/M.1.
- **Code reference:** One ioredis client per (module,label) per replica, `maxRetriesPerRequest` 1 (caches/limiters) or 2 (pub/sub), `connectTimeout` 2s (`make-redis.ts:49-51`). Every cross-replica invariant (UW ceiling, AI-spend, SSE snapshots, telemetry rollup, membership-sync limit, Largo gate) reads Redis.
- **Why it's a problem (infra angle):** The code is correct in tolerating Redis loss (fail-open) — but that means a single Redis instance failing simultaneously removes the UW rate ceiling, the AI-spend cap, and the Largo gate (09 M.1) while masking the outage from users (in-memory cache fallback keeps serving). Whether prod Redis is a single box or an HA pair with persistence is **NOT VERIFIED**.
- **Impact (500 / 1,000 / 5,000):**
  - **500:** Single Redis likely sufficient for memory, but op-rate (500 SSE × 4 GET/s = 2000 GET/s + rate-limit EVALs, 09 H.1/G.1) stresses a small instance; a slow Redis triggers the fail-open cascade.
  - **1,000-5,000:** Op-rate scales linearly with SSE clients; a single Railway Redis becomes the cluster bottleneck and its failure is correlated with the high-load event. HA + the pub/sub-fan-out SSE refactor (09 H.1) become mandatory.
- **Recommended fix:** Confirm the Redis plan (size, HA, persistence). Move to a managed/HA Redis before 1,000. Implement the SSE pub/sub fan-out (one subscriber/replica) to collapse the GET op-rate. Add a "Redis degraded" health signal (the limiters already track `sharedRedisFailedAt`) into the F.1 alert path. **NOT VERIFIED — needs Railway Redis plan + ops/sec.**

### G.2 — Postgres pool-of-5 + PgBouncer-as-manual-runbook; no provisioning-as-code, no backup/PITR evidence in repo
- **Severity:** Critical (if PgBouncer absent) / High (DR)
- **File:** `db.ts:88-97`, `PGBOUNCER-SETUP.md`, 09-SCALABILITY F.1.
- **Code reference:** `db.ts:93` `max: PG_POOL_MAX ?? 5`; `db.ts:88-90` comment assumes PgBouncer; `PGBOUNCER-SETUP.md` is a **manual** runbook ("click Postgres → Plugins → Add PgBouncer", `default_pool_size = 20`, `pool_mode = transaction`). Nothing in the repo provisions PgBouncer or asserts its presence at boot.
- **Why it's a problem (infra angle):** The entire DB-concurrency story rests on an **unverified manual infra step**. If PgBouncer was never added (or is in session mode), 5 connections/replica is the real ceiling and the advisory-lock-holding paths cut it to 2-3 (09 F.1) — the most likely first systemic failure at 500. Separately, there is **zero evidence in the repo** of Postgres backups, PITR, or a tested restore — Railway's managed Postgres may provide snapshots but that is **NOT VERIFIED**.
- **Impact (500 / 1,000 / 5,000):**
  - **500:** Without PgBouncer, bursts >5 concurrent queries/replica queue 15s (`connectionTimeoutMillis`) then 503 — a launch blocker. With PgBouncer (transaction mode, default_pool_size 20), feasible.
  - **1,000-5,000:** Even with PgBouncer, `default_pool_size = 20` against Postgres `max_connections` must be sized against replica count × telemetry write volume (09 F.2). Backups/PITR become non-negotiable for a paid product.
- **Recommended fix:** (1) **Confirm PgBouncer is in the topology and in transaction mode** — add a boot-time log of the active connection target so the repo can prove it. (2) Size `PG_POOL_MAX` and PgBouncer `default_pool_size` against Postgres `max_connections` ÷ replicas. (3) **Verify Postgres backups + run a restore drill**; document RPO/RTO. (4) Verify Redis persistence if any state must survive a Redis restart (most is reconstructable cache, but the rate-limit/AI-spend keys briefly losing state = a fail-open window). **NOT VERIFIED — needs prod: PgBouncer presence/mode, Postgres `max_connections`, backup/PITR config, last successful restore test.**

### G.3 — No disaster-recovery runbook or multi-region; a Railway region/project outage is a full outage with unverified recovery
- **Severity:** Medium
- **File:** repo-wide (absence).
- **Code reference:** No DR docs beyond `PGBOUNCER-SETUP.md`; single Railway project implied by single `railway.toml`. No infra-as-code (Terraform/Pulumi) for the Railway project itself — only per-service `railway.*.toml`.
- **Why it's a problem:** The whole platform (web + crons + Postgres + Redis) lives in one Railway project/region. A region or project-level incident is a total outage, and rebuilding requires re-creating 11 services + wiring 11 config-as-code paths + populating ~30 env vars by hand (the cron tomls' headers each say "Wire it up: service Settings → Config-as-code → set path to …"). There is no scripted recreation.
- **Impact (500 / 1,000 / 5,000):** RTO is "however long a human takes to rebuild 11 services by hand" — unacceptable for a paid product at any tier; worse as the user base (and SLA expectation) grows.
- **Recommended fix:** Document a DR runbook (service list, env-var manifest, config-as-code paths, restore order). Capture the env-var manifest as a checked-in `.env.example` (names only). Consider IaC for the Railway project so the topology is reproducible. Confirm Railway's region/backup guarantees. **NOT VERIFIED — needs the Railway project's region + backup posture.**

---

## H. Networking

### H.1 — Networking config is sound: private-VPC DB with public fallback, scoped image hosts, strict CSP/HSTS
- **Severity:** Low (this is a "good, do not regress" note with one caveat)
- **File:** `db.ts:38-62`, `next.config.mjs:7-40,15-29`.
- **Code reference:** `db.ts:42` skips TLS for `.railway.internal` (private VPC, traffic stays in-VPC); `db.ts:49-61` prefers private URL, falls back to public with a warning. `next.config.mjs:7-13` resolves the Railway hostname from `RAILWAY_STATIC_URL`/`RAILWAY_HOSTNAME` instead of a `**.railway.app` wildcard (good). Strong security headers: HSTS preload, `X-Frame-Options SAMEORIGIN`, a real CSP, `frame-ancestors 'self'` (`next.config.mjs:15-29`).
- **Why it's a problem / caveat:** Mostly good. The one caveat: `db.ts:45` defaults `rejectUnauthorized: false` for the public endpoint (`DATABASE_SSL_STRICT` not set) — acceptable for Railway's public cert quirk but means the public-fallback path does not validate the cert. Private VPC is unaffected.
- **Impact (500 / 1,000 / 5,000):** Private VPC is the steady-state path (no public egress per query). If private DNS ever fails and the public fallback engages under load, every query pays public TLS without cert validation — a latency + minor-security cost. Constant across tiers.
- **Recommended fix:** Keep the private-first design. Set `DATABASE_SSL_STRICT=1` once the managed Postgres has a trusted CA so the public fallback validates. Monitor for the `"Private Postgres DNS failed — using DATABASE_PUBLIC_URL"` warn (`db.ts:82-86`) as a signal the slow path is active.

### H.2 — Cron services reach the web app over its PUBLIC URL (`https://blackouttrades.com`), not the private VPC
- **Severity:** Low
- **File:** `scripts/hit-cron.mjs:21`.
- **Code reference:** `hit-cron.mjs:21` `const base = process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com"`.
- **Why it's a problem:** Each cron fire is a public HTTPS round-trip into the app (through whatever CDN/edge fronts the domain) rather than a private VPC call. Functionally fine and auth'd by `Bearer CRON_SECRET`, but it means cron traffic shares the public ingress path with users and depends on public DNS/TLS being up for internal scheduled work.
- **Impact (500 / 1,000 / 5,000):** Negligible volume (a handful of cron fires/min). The only real exposure: if the public domain/CDN has an incident, crons fail even though the app is reachable privately. Constant.
- **Recommended fix:** Optionally set `CRON_TARGET_BASE_URL` to the web service's private/internal Railway URL so cron→web stays in-VPC and survives a public-edge incident. Keep the Bearer auth regardless.

---

## I. Will Railway support 500 / 1,000 / 5,000 concurrent users?

The cache-reader rule (per-user features read shared caches, never per-user upstream) is genuinely followed on the hot paths (verified in 09-SCALABILITY P), which is what makes any of this feasible on a 2-RPS UW ceiling. The infra verdict by tier:

| Tier | Verdict | The binding infra constraints (in order) |
|---|---|---|
| **500 concurrent** | **Feasible on a single, well-sized web replica IF (a) PgBouncer is real, (b) Redis is healthy, (c) `SSE_MAX_STREAMS` is raised above 500.** | 1. SSE 500/instance cap lands exactly at the target (09 H.1) → raise it or add a replica. 2. Postgres pool-of-5 (G.2 / 09 F.1) → confirm PgBouncer. 3. Redis op-rate (G.1) → size it. Single replica keeps all per-process invariants intact (no UW socket/bucket multiplication). |
| **1,000 concurrent** | **Requires ≥2 web replicas, which activates the per-replica fixes — do NOT scale replicas without them.** | 1. `UW_MAX_RPS = ceil(2/replicas)` + `REDIS_URL` required (C.2 / 09 C.1). 2. Cross-replica AI-spend counter + Largo fail-closed (09 C.4). 3. Decouple WS ingestion to one owner (C.1) so N replicas don't open N UW sockets. 4. SSE pub/sub fan-out (09 H.1). 5. Redis HA + PgBouncer sized for replicas×load. 6. Readiness-gated rolling deploys (E.1). |
| **5,000 concurrent** | **Requires re-architecture of the real-time tier — not reachable with the current single-process-does-everything model.** | 1. Dedicated socket/fan-out worker service (C.1). 2. Stateless, horizontally-scaled web replicas behind a readiness gate. 3. Managed HA Redis sized for SSE op-rate (or push SSE through a dedicated pub/sub). 4. PgBouncer + telemetry batching/sampling (09 F.2) + connection budget. 5. External APM + error aggregation + multi-channel alerting (F). 6. DR runbook / IaC (G.3). |

**The three pre-launch infra blockers (independent of the 09/05 app-layer blockers):**
1. **Confirm PgBouncer + Postgres backups/PITR** (G.2) — the DB story rests on an unverified manual step.
2. **Pin web `numReplicas` and document the replica-coupled env changes** (C.2) — so scaling to absorb load cannot silently break the UW ceiling and AI-spend cap.
3. **Independent dead-man's-switch + ops alert channel + install Sentry** (F.1, F.2) — so a silent infra failure (Redis degraded, cron dead, web flapping) is actually seen.

---

## J. What is already good (do not regress)

- **Cron services are correctly minimal and isolated:** `echo` build (no node_modules), `hit-cron.mjs` uses only Node stdlib + global fetch, `numReplicas = 1`, `restartPolicyType = "never"` — so cron amplification does not multiply with web replicas, and cron services cost almost nothing.
- **Graceful SIGTERM/SIGINT shutdown releases upstream WS slots** (`init-data-sockets.ts:39-41,76-94`) so rolling deploys don't cause the 1008 indices reconnect collision (verified in RT-1/RT-4 runtime findings as working).
- **Private-VPC-first Postgres** with a public fallback + warning (`db.ts:42,82-86`); **scoped image `remotePatterns`** (no `**.railway.app` wildcard); **strong security headers** (HSTS preload, CSP, frame-ancestors) — `next.config.mjs:7-40,15-29`.
- **Liveness vs readiness are correctly separated in code** (`/api/health` liveness, `/api/ready` DB readiness) — the only gap is that the readiness probe isn't wired to the Railway healthcheck (E.1).
- **A cron staleness watchdog exists** as a separate service to catch silently-dead crons (`cron-staleness-watchdog/route.ts`) — the right idea; just needs an external dead-man's-switch above it and registry coverage of the two orphaned gex crons (B.1, F.1).
- **The mandatory ioredis `error` listener is centralized** in `make-redis.ts:53-57` (a missing one crashes the replica) — a real prior P0, now correctly factored.
- **The `unhandledRejection` handler** (`instrumentation.ts:38-74`) keeps the single web process up + alerts on rejections (does not `process.exit`).

---

## K. Prioritized infra launch-blocker fixes

| Priority | Fix | Finding | Tier it unblocks |
|---|---|---|---|
| **P0** | Confirm PgBouncer (transaction mode) + Postgres backups/PITR + run a restore drill; log the active DB target at boot | G.2 | 500+ |
| **P0** | Pin web `numReplicas` in `railway.toml`; document that >1 requires `UW_MAX_RPS=ceil(2/replicas)` + `REDIS_URL` required + cross-replica AI spend | C.2 | 1,000+ |
| **P0** | Set `DISCORD_OPS_WEBHOOK_URL`; add an EXTERNAL uptime monitor on `/api/ready` as the dead-man's-switch; install `@sentry/nextjs` + `SENTRY_DSN` | F.1, F.2 | 500+ |
| **P0** | Confirm prod uses **live** Clerk keys, not the `sk_test_` in `.env.local`; rotate exposed Polygon/UW keys | D.1 | 500 (launch correctness) |
| **P1** | Add `railway.gex-eod-snapshot.toml` + `railway.gex-alerts.toml` and register both in `CRON_JOBS` | B.1 | 500 (feature + monitoring) |
| **P1** | Wire `healthcheckPath = "/api/ready"` (warm-gated) + warm schema/pool/sockets on boot so rolling deploys don't ship cold replicas | E.1 | 1,000+ |
| **P1** | Confirm Redis plan; move to managed/HA Redis + SSE pub/sub fan-out before 1,000; add "Redis degraded" alert | G.1 | 1,000+ |
| **P1** | Wire pool `waitingCount` + event-loop-lag + CPU/mem into the alert path | F.3 | 500+ |
| **P2** | Reconcile `membership-reconcile` cadence vs registry (6h vs hourly) + stale threshold | B.3 | any |
| **P2** | Forbid dashboard cron edits; surface cron schedule drift in admin | B.2 | any |
| **P2** | Add a boot-time env validator (typo/unknown-var detector) for the ~100 `SPX_*`/`UW_*` knobs; check in `.env.example` (names only) | D.2, G.3 | any |
| **P2** | DR runbook + Railway IaC for reproducible project recreation | G.3 | 1,000+ |
| **P3** | `output: "standalone"` to slim the image; point `CRON_TARGET_BASE_URL` at the private URL | C.3, H.2 | any |

---

## L. Evidence still required (NOT VERIFIED — needs prod/dashboard/invoice)

1. **Web service `numReplicas`** (Railway dashboard) — gates whether the per-replica fixes are already-active risks.
2. **PgBouncer presence + `pool_mode`** (Railway Postgres plugins) + Postgres `max_connections` — gates the pool-of-5 verdict.
3. **Postgres backup / PITR config + last successful restore test** — DR.
4. **Redis plan: size, HA/replication, persistence, ops/sec headroom** — gates 1,000+ feasibility.
5. **Container vCPU/RAM for the web service** — gates single-replica throughput and replica sizing.
6. **Production Clerk keys are `pk_live_`/`sk_live_`** (not the `sk_test_` in `.env.local`) — auth correctness.
7. **`DISCORD_OPS_WEBHOOK_URL` set in prod** + whether any external uptime monitor exists — alerting.
8. **UW account WebSocket connection allowance** vs replica count — gates multi-replica WS multiplication (C.2).
9. **Railway region + project-level backup/DR posture** — G.3.
10. **Whether cron schedules in the dashboard match the tomls** (drift check) — B.2.
