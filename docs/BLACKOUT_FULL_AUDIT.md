# BLACKOUT — Master Pre-Launch Audit (Full)

> **Scope note.** This is the consolidated master report synthesizing ten area audits ahead of a ~500-concurrent-user launch. It deliberately stays at the summary/decision altitude. **Full per-issue detail — file path · code reference · why · severity · impact · fix · worked example — lives in the section files under `audit/`** (`01-API.md` … `10-PRODUCT-UX.md`, plus `00-RUNTIME-FINDINGS.md` for live-log evidence). Every claim below traces back to a specific finding in those files; where a fact depends on production infrastructure we could not inspect from the repo (PgBouncer presence, web replica count, prod Clerk email policy, prod DB connection mode, CI gating), it is marked **[Not verified — needs prod/env]** rather than asserted.

---

## ⏱ Post-Audit Resolutions (updated 2026-06-24)

Fixes that landed on `main` **since** this audit was written. The findings below stay as the historical record; this is the running "what's been done."

- ✅ **R-1 / Risk #2 — Clerk auth-bypass CVE (GHSA-w24r-5266-9c3c) + the 14 Next.js advisories — RESOLVED.** Upgraded **Next.js 14.2.35 → 15.5.19** and **`@clerk/nextjs` ^5.7.6 → ^7.5.8** (commit `a4bb594`, deployed). `npm audit`: **10 vulns (9 high) → 2 moderate**; the Clerk + Next high-severity advisories cleared. Validated: tsc/build/289 tests + a logged-in auth smoke test (sign-in, protected routes, tier gate, admin gate, UserButton) against the dev Clerk instance, plus a clean prod boot (`Next.js 15.5.19`, postgres ok).
- ✅ **Intermittent sign-in bounce — FIXED (same upgrade).** Root cause: in Clerk v5 the session-JWT handshake ran only on *document* requests, never on RSC soft-navs, so a stale JWT on a soft-nav couldn't refresh and `auth().protect()` redirected to `/sign-in`. v7 drives the refresh through the handshake instead. Reproduced live on the old build; **PROD-VERIFIED post-upgrade (2026-06-24)**: 4 RSC soft-navs held auth (no bounce), admin gate + UserButton work, and a logged-out protected nav 307s to the Clerk handshake. *Cosmetic follow-up:* rename the deprecated `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`/`AFTER_SIGN_UP_URL` env vars to the `…FALLBACK_REDIRECT_URL` form to clear v7 deprecation warnings (redirects still work).
- ✅ **Prod Clerk Test mode — DISABLED** (was an open account-creation hole; see `audit/06-AUTH-CLERK.md` H-0).
- ✅ **UW trading-halts false-positive entry block — FIXED** (`e063a9e`): the event-only channel now keys staleness off socket liveness, not last-halt time, so a normal no-halt session no longer blocks desk entries.
- ✅ **Largo GEX-wall unit mislabel (−3.59B vs panel −$3.6M) — FIXED** (`0b0cba1`): `net_gex` is pre-formatted to the panel's K/M/B string and quoted verbatim.
- ✅ **Night's Watch expiry off-by-one + AI date arithmetic — FIXED** (`a1241ab`); **playbook empty-slot contrast** scrim (`e063a9e`).
- ➕ **Night's Watch valuation — Massive Unified Snapshot batch adoption** (`99587b6`) + **indices V (tick) channel** (`8e577fc`).

**Still open from the launch-blocker set (Section S):** the Redis fail-open cascade (Risk #1), PgBouncer confirmation + pool sizing (Risk #3), arming the AI-spend hard cap (Risk #4 — opt-in via `DAILY_AI_SPEND_KILL_USD`), SSE pulse fan-out + caps (Risk #5), telemetry batching, ticker allowlisting, and `DISCORD_OPS_WEBHOOK_URL`.

---

## A. Executive Summary

**What BLACKOUT is.** BLACKOUT is a premium, "Bloomberg-terminal-for-retail" options-trading desk built on Next.js 14 (App Router) and deployed on Railway. It fuses several live tools behind a single premium paywall: a real-time SPX play card with an 11-point live confluence checklist, the **HELIX** options-flow tape (live SSE), **GEX/dealer-positioning heat maps**, **Night Hawk** (an evening playbook + dossier scanner with a track record), **Night's Watch** (a per-user options-position manager with a deterministic, no-fabrication valuation engine), and **Largo** (an interactive Claude/Anthropic tool-loop analyst grounded in live market data). Market data comes from Unusual Whales (hard **2 RPS** cluster ceiling), Polygon/Massive (~40 RPS), and live UW/Polygon/options WebSockets. Auth/identity is Clerk; billing/entitlements are Whop; state is Postgres + Redis; alerting is a single Discord webhook.

**Overall posture.** This is a genuinely well-architected, security-conscious codebase that is **closer to launch-ready than typical** — but it is **not yet GO without fixes**. The core engineering discipline is real and rare: the *cache-reader rule* (per-user features never make per-user upstream calls; they read shared Redis caches warmed by crons/WebSockets) is honored on the hot paths, the UW/Polygon limiters are atomic Redis-Lua sliding windows with a cross-replica circuit breaker, SQL is fully parameterized (no injection found), per-user data is consistently scoped by the trusted Clerk `userId` (no IDOR paths found), and the product has a distinctive honesty discipline (Stale badges, "no fabricated P&L," public track record reusing the premium aggregation). Across all areas auditors found **4 Critical, 30 High** plus many Mediums/Lows — and critically, **none require re-architecture.** The risk is concentrated, not pervasive.

**The 5 biggest risks (launch-defining).**
1. **The correlated Redis-down fail-open cascade.** Every protective ceiling — the UW 2-RPS cluster cap, the Polygon cap, response caches, the Anthropic spend tripwire, and the Largo concurrency/budget gate — **fails OPEN** on Redis loss, *simultaneously and at the worst possible moment* (peak load is when Redis is most stressed). One Redis blip can multiply UW/Polygon call rate by replica count (→ 429 storm → cluster circuit breaker → stale desk for all users) while removing all AI cost governance (→ unbounded Anthropic spend) — and in-memory cache fallback *hides the outage from users while it happens*. (01/04/07/09)
2. **Dependency CVEs on the auth boundary.** The installed Clerk version carries a published **authorization-bypass advisory (GHSA-w24r-5266-9c3c)** — and Clerk *is* the entire auth/authz boundary. Next.js 14.2.35 carries 14 advisories (WS-upgrade SSRF, Server-Component DoS, cache-poisoning, App-Router XSS) on exactly the surfaces this app uses. `npm audit` reports 10 vulns (9 high, 1 moderate). (08)
3. **Postgres connection-pool exhaustion.** The pool defaults to **max 5 per replica**, with `ensureSchema()` awaited on every query and long-lived advisory-lock clients (SPX-eval, migration) pinning connections down to 2–3 usable — and **PgBouncer is only a documented manual setup step (`PGBOUNCER-SETUP.md`), not provisioned in-repo.** If it is absent in prod, DB pool exhaustion is the single most likely *first* hard failure at 500 concurrent. **[Not verified — needs prod confirmation of PgBouncer.]** (03/04/09)
4. **Uncapped, fail-open AI spend.** Largo is an interactive up-to-12-round Sonnet tool-loop any premium user can drive. The spend tripwire is **per-process and alert-only** (no hard cap), and the per-user budget/concurrency gates fail open on Redis loss. 500 premium users (or a loop bug) during a Redis blip = a four-figure/hr Anthropic bill bounded only by a lagging Discord ping. (01/07/09)
5. **SSE pulse stream capacity + per-connection Redis polling.** The pulse SSE caps at **exactly 500 connections per instance** (the launch target — the 501st live-desk user gets a 503), and each connection does one Redis `GET` every 250ms = **~2,000 GETs/sec/instance** on the same Redis the limiters need, for data already in process memory. Plus `/api/market/live` has *no* connection cap and a broadcaster that permanently stops reconnecting after 10 attempts. (01/03/09)

**Launch verdict: GO-WITH-FIXES.** The product is strong and the architecture is sound, but a small, well-defined must-fix set (dependency upgrades, Redis fail-closed for cost-sensitive gates + replica-aware UW pacing + a "Redis degraded" alert, PgBouncer confirmation/pool sizing, telemetry batching, SSE fan-out + caps, ticker allowlisting, and re-gating the internal docs) stands between "scales smoothly" and "a Redis hiccup or a handful of odd tickers takes the desk stale and spikes the bill." See Section S for the must-fix-before-launch set.

---

## B. System Architecture Summary

**Stack.** Next.js **15.5.19** (App Router, React Server Components, SSE; upgraded from 14.2.35 on 2026-06-24, see Post-Audit Resolutions) · TypeScript · Postgres (`pg` 8.21) · Redis (`ioredis` 5.11) · Clerk auth (`@clerk/nextjs` **^7.5.8**, upgraded from ^5.7.6) · Whop billing (`@whop/sdk` 0.0.40) · Anthropic (`@anthropic-ai/sdk` ^0.105). Deployed on Railway (nixpacks; `next start`; healthcheck `/api/health`; Node ≥20.9).

**Data flow (the cache-reader architecture).**
- **Ingest (writers):** Live UW/Polygon/options **WebSockets** (singleton per replica) + a set of Railway **crons** (`uw-cache-refresh`, `flow-ingest`, `nights-watch-warm`, `spx-evaluate`, Night Hawk playbook/outcomes, etc.) curl `/api/cron/*` and **write Redis caches + Postgres**. These are the only components that spend the UW 2-RPS budget at steady state.
- **Read (per-user, hot path):** User-facing routes are **cache-readers** — `/market/quote` (WS-first → L1 → L2 → coalesced cache), GEX, SPX desk, and Night's Watch positions (O(distinct chains), never per-user upstream) read shared Redis caches with single-flight/SWR dedup. This is what makes a 2-RPS upstream ceiling survivable for 500 users.
- **Limiters:** UW & Polygon use **atomic Redis-Lua sliding windows** enforcing a *cluster-wide* ceiling, with a **cross-replica circuit breaker via pub/sub** (8×429/60s → 45s open). **All fail OPEN on Redis loss** (the central architectural risk).
- **Streaming:** SSE for HELIX flow tape, SPX pulse, and `/market/live` live bars. The SPX pulse snapshot is also mirrored in an in-process `indexStore`.

**Deploy topology.** Single Railway project: one **web service** (replica count **not pinned in `railway.toml`** — dashboard-controlled **[Not verified]**) running Next + all SSE + the data WebSockets + cron route handlers on the *same process*; **11 Railway cron services** that curl cron routes via `scripts/hit-cron.mjs` (Bearer `CRON_SECRET`); a Night Hawk **worker** service (runs via `tsx`); Postgres; Redis. There is **no in-app scheduler** — cron load lands on the user-serving process. Alerting funnels to a single Discord webhook.

**Topology consequences (the scaling contradiction).** Limiters/spend-trackers/WS managers are **module-scope per process**, but the web replica count is unset. The natural move to scale web for 500 users (add replicas) *multiplies* UW/Polygon RPS, spawns one WS per replica (documented `code=1008` collision risk), and divides per-replica spend visibility — so horizontal scaling **breaks the hard UW cap whenever Redis blips**. This must be resolved (replica-aware `UW_MAX_RPS=ceil(2/N)`, cross-replica spend, dedicated socket/worker lane) before adding any web replica.

---

## C. Full API Inventory (condensed)

75 internal routes; all self-authorize in their handlers (middleware does not guard `/api` by design). Only `health`/`readiness`/`track-record`/`webhook/whop` are intentionally public (webhook HMAC-verified). Condensed cross-section; **see `01-API.md`** for the full route-by-route table and external-integration map.

| Path (representative) | Method | Auth | Purpose |
|---|---|---|---|
| `/api/health`, `/api/ready` | GET | public | Liveness/readiness probes |
| `/api/public/track-record` | GET | public | Honestly-gated Night Hawk track record |
| `/api/webhook/whop` | POST | HMAC (Standard-Webhooks) | Billing→entitlement sync |
| `/api/market/quote` | GET | premium | WS-first/L1/L2 coalesced quote (cache-reader) |
| `/api/market/spx/play` | GET | premium | Flagship SPX play card |
| `/api/market/spx/pulse/stream` | GET (SSE) | premium | SPX pulse stream (capped 500/instance) |
| `/api/market/live` | GET (SSE) | premium | Live bars (no cap — **risk**) |
| `/api/market/flows`, `/flows/stream` | GET / SSE | premium | HELIX flow tape (poll + SSE) |
| `/api/market/dark-pool/ticker` | GET | premium | UW dark-pool by **user ticker** (**off-warm-set risk**) |
| `/api/market/gex-heatmap` | GET | premium | GEX by **user ticker** (**off-warm-set risk**) |
| `/api/market/largo/query` | POST | premium | Largo AI tool-loop (**uncapped/fail-open cost**) |
| `/api/nights-watch/*`, `/api/journal/*`, `/api/positions/*` | * | per-user (userId-scoped) | Position manager, journal |
| `/api/push/subscribe`, `/api/push/send` | POST | per-user / admin | Web Push (**inert; send is admin-broadcast**) |
| `/api/membership/sync` | POST | per-user | Manual Whop/Clerk resync (**fail-open cooldown**) |
| `/api/cron/*` (12 routes) | POST/GET | `CRON_SECRET` (constant-time) | Cache warming, ingest, reconcile, evaluate |
| `/api/admin/*` (17 routes) | * | `requireAdminApi` | Ops console |

API-area counts: **C0 / H4 / M4 / L6.** No unauthenticated data leaks found in the API surface.

---

## D. Frontend Component Inventory (condensed)

30 routes/layouts + 131 components, in two tiers. **See `02-FRONTEND.md`** for the full inventory and 18 per-issue blocks.

- **Strong design-system layer (`src/components/ui`):** `Modal` with focus-trap, polymorphic `Button`, honest empty/loading/error states, broad `prefers-reduced-motion` coverage, zero banned grey classes, all `next/image`. This is launch-grade.
- **Busier "desk" layer (the real risk):** `FlowAlertStream` (HELIX tape — up to 150 framer-motion layout-animated cards on a live SSE stream; keyboard-inaccessible), `FlowFeed` (~9 O(n)/O(n·m) `useMemo` recomputes per print), `LargoTerminal` (rebuilds whole message array per token), `GexHeatmap`, `NightsWatchPanel` (Close-position via `window.prompt`), `DnaHelixBackground` (~96 SMIL particles + 2-pass blur under `/flows`). 201+ inline-style hex colors across 40 files bypass design tokens.
- **Static cost:** a **305 KB / 11,033-line monolithic `globals.css`** ships on every route including the logged-out landing page.

Frontend-area counts: **C0 / H4 / M8 / L6.**

---

## E. Backend Service Inventory (condensed)

Route handlers + `src/lib` services + WS managers + SSE streams + caches + limiters + crons. **See `03-BACKEND.md`** for full detail.

| Service | Role | Health |
|---|---|---|
| `src/lib/db.ts` | Postgres pool (max 5), migrations, `ensureSchema`, advisory locks, query helpers | **Primary DB bottleneck** |
| `uw-rate-limiter.ts` / `polygon-rate-limiter.ts` | Redis-Lua sliding-window cluster ceiling + breaker | Correct, but **fail-open** |
| `server-cache.ts` | Single-flight SWR cache, LRU-bounded, degradation tracking | Strong (the model to copy) |
| `shared-cache.ts` / `tier-cache.ts` | Cross-replica caches + per-user tier cache | **Unbounded memory fallback** |
| `ws/uw-socket.ts`, `ws/options-socket.ts` | UW + options feeds, stall watchdogs | Good (options watchdog fixed RT-1) |
| `ws/polygon-socket.ts` | SPX/VIX index feed | **No stall watchdog** |
| `spx-broadcaster.ts` | Fan-out for `/market/live` | **Gives up after 10 reconnects** |
| `api-telemetry.ts` + `-persist.ts` | Per-call telemetry → Postgres | **Unsampled/unbatched (Critical)**; unbounded Map |
| `membership.ts`, `tier-cache.ts` | Whop/Clerk tier resolution | O(users) serial reconcile |
| Cron route handlers | Cache warming, ingest, eval, reconcile | Run on the user web process |

Backend-area counts: **C0 / H3 / M7 / L6.**

---

## F. Database & Redis Review (condensed)

**See `04-DATABASE-REDIS.md`** for full detail.

**Key tables / indexes.**
- `api_telemetry_events` — **largest table & heaviest write load**: one INSERT per external API call, no sampling/batching, unique `event_id` index checked per write. ~30k rows/day at <10 users → hundreds-of-thousands-to-millions/day at 500. 90-day retention floor. **(Critical write-amplification.)**
- `flow_alerts` — busiest write table; **`fetchRecentFlows`** is the heaviest read: default 48h × `LIMIT 5000`, `WHERE COALESCE(created_at, inserted_at)` **defeats `idx_flow_alerts_created_at`** (forces scan), `ORDER BY total_premium` **un-indexed**, ~10 `raw_payload` JSONB extractions/row. Needs a `(inserted_at DESC, total_premium DESC)` index, bare-timestamp predicate, pagination (200–500), precomputed columns, and `serverCache` fronting.
- Per-user tables (positions, journal, play state) — correctly `user_id`-scoped (IDOR-safe).
- Migrations run **lazily under `pg_advisory_lock(42)` on first query** (~30 DDL incl. `LOCK TABLE` + dedup `DELETE`); on any schema error the **pool is nuked** → thundering-herd migration/pool-rebuild on Railway rolling deploys. Move to **boot-time**.

**Redis keys / TTLs.** Single `ioredis` factory always attaches an error listener; **explicit TTLs on every key** (short-TTL sliding-window limiter keys with 3s TTL; `EX` on every cache set). Representative keys: `quote:{ticker}`, `nw:optmark:{occ}`, `server:{key}`, `blackout:server:*`, `uw_cache:*`, `spx:pulse:snapshot`, `tier-changed:{userId}` (recommended). **Risk is op-rate, not memory:** 500 SSE pulse clients = ~2,000 GET/sec/replica + one EVAL per gated UW/Polygon call; and **every limiter/cache/spend gate fails open on Redis loss** (the cascade).

DB/Redis-area counts: **C1 / H4 / M6 / L3.**

---

## G. Cron Job Review

No in-app scheduler — all 11 jobs are Railway cron services that curl `/api/cron/*` on the user-serving web process via `scripts/hit-cron.mjs`. **See `05-CRON-JOBS.md`** for full detail.

| Job | Schedule | Upstream / cost | Risk |
|---|---|---|---|
| `uw-cache-refresh` | `*/2` | UW (~26 tasks serialize behind 2 RPS, ~13s drain) | **High** — saturates the 2-RPS bucket; same `*/2` cadence as flow-ingest |
| `flow-ingest` | `*/2` | UW + Postgres (advisory-locked) | Med — stagger to offset from uw-cache-refresh |
| `nights-watch-warm` | `* 11-21 * * 1-5` (every min) | Polygon (bursts up to ~300 concurrent chain+GEX fetches) | **High** — cap, no alert when capped; chains >300 silently dropped → per-user upstream |
| `membership-reconcile` | hourly TOML (label says "6h"; `stale_after_min=780`) | Whop + Clerk (serial O(users)) | **High** — truncates at 300s; tier drift; watchdog hidden 13h |
| `spx-evaluate` | RTH | Massive/Polygon; holds advisory lock (pins a pooled client) | Med — lock starves request pool |
| `nighthawk-playbook` / `-outcomes` | evening / EOD | UW/Polygon; N+1 outcome inserts | Med |
| `db-cleanup`, `largo-cleanup` | daily | Postgres | Low — no wall-clock budget on db-cleanup |
| `cron-staleness-watchdog` | periodic | reads `meta_json` | Med — only alerts on *total* failure; partial/chronic stays green; can't see jobs not in `CRON_JOBS` |
| **`gex-eod-snapshot`** | **none** | — | **High** — no `railway.*.toml`, not in `CRON_JOBS`; **silently dead**; ships broken "vs prior close" heatmap |
| **`gex-alerts`** | **none** | — | **High** — same: route exists, never fires, invisible to watchdog |

Cron-area counts: **C1 / H4 / M6 / L2.** Cross-cutting: per-process limiters + unset web `numReplicas` (Critical, blocking scale-out); single swallowed-error Discord webhook with no fallback; `hit-cron.mjs` has no fetch timeout (hung cron → consumes a web worker, never logs the run).

---

## H. Clerk / Auth Review

**The strongest area audited: 0 Critical, 0 High (in access control).** **See `06-AUTH-CLERK.md`.** The security model is documented in `src/middleware.ts` and honored consistently: all 73 API routes self-authorize; all 17 admin routes gate first-line; all 12 cron routes verify `CRON_SECRET` with a constant-time compare; every protected page additionally calls `requireTier('premium')` server-side. Per-user routes derive `user_id` only from the trusted `auth()` session and scope every query by it — **no IDOR paths, no header/body-trusted identity**, and Largo's AI tool cannot spoof ownership. The Whop webhook verifies the Standard-Webhooks HMAC and fails closed; the engine proxy is allowlisted (no SSRF); the personal-webhook is host-restricted to Discord; tier resolution fails closed on a Clerk outage.

Remaining items are operational hardening, not open holes: per-replica 60s tier cache (premium persists briefly after churn → revenue/cost leak); `/api/membership/sync` fails open on Redis loss (Whop/Clerk API amplification DoS); `/docs/*` recon exposure; unverified admin-email matching; webhook drop/loss paths; inert admin push-broadcast without audit log; connect-only SSE auth (downgrade not enforced on open streams). Auth-area counts: **C0 / H0 / M2 / L7.** Note: the Critical Clerk *dependency CVE* is tracked under Security (J), not here — the auth *logic* is clean.

---

## I. Third-Party Tool Review

**See `07-TOOLS-INTEGRATIONS.md`.** Dependency set is lean and mostly exact-pinned.

| Tool | Purpose | Risk / cost |
|---|---|---|
| **Redis** (single box) | Tier-0: every limiter, cache, spend gate, cooldown | **High** — all fail OPEN on loss; not HA. The central correlated dependency |
| **Postgres** (`pg` 8.21) | All durable state | **High** — pool max 5/replica; safe only behind PgBouncer (**unverified**, doc-only) |
| **Unusual Whales** | Flow/GEX/dark-pool | Hard **2 RPS cluster** cap; off-warm-set tickers + Redis fail-open = 429 storm |
| **Polygon/Massive** | Quotes, indices, chains | ~40 RPS; connect-blip → SPX-play hard-502 (RT-2) |
| **Clerk** (`^5.7.6`) | Auth boundary | **Critical CVE** (GHSA-w24r-5266-9c3c); tier cache can herd Clerk |
| **Whop** (`@whop/sdk` **0.0.40**) | Billing/entitlements | **High** — pre-1.0, no contract test; an SDK bump can silently downgrade/lock out payers |
| **Anthropic** (`^0.105`) | Largo tool-loop | **High** — spend tripwire per-process, alert-only, no hard cap |
| **Discord webhook** (single) | All ops/critical alerting | **High** — no fallback; errors swallowed; watchdog uses same sink |
| **`web-push`** | GEX/flow push delivery | **Medium** — **NOT installed**; subscriptions accepted, nothing delivered |
| **`@sentry/nextjs`** | Error forwarding | **Medium** — referenced but **NOT installed**; dead pipeline |
| **`tsx`** (devDependency) | Runs the Night Hawk worker | **Low/High-latent** — absent under `--omit=dev` → worker fails to boot ("empty editions" class) |
| **`lucide-react`** | (none) | **Low** — unused dependency; remove |

Tools-area counts: **C0 / H3 / M5 / L7.**

---

## J. Security Findings (consolidated, by severity)

Full detail in `08-SECURITY.md`. **Posture is strong** (fully parameterized SQL; no `dangerouslySetInnerHTML`/`eval`/CORS-wildcard; allowlisted proxy + webhook; constant-time cron auth; credential redaction in logs; no server secrets in the client bundle). The dominant risk is **dependency CVEs, not app logic.**

**Critical**
- **Clerk authorization-bypass advisory (GHSA-w24r-5266-9c3c)** on the installed version — `package.json` (`@clerk/nextjs ^5.7.6`; resolves vulnerable `@clerk/backend`/`@clerk/shared`). Clerk is the *entire* auth boundary. **Fix:** upgrade to a patched line; re-run `npm audit` until Clerk advisories clear; E2E test sign-in/tier/admin gates.

**High**
- **Next.js 14.2.35 — 14 advisories** (WS-upgrade SSRF, Server-Component DoS, cache-poisoning, App-Router XSS) — `package.json`. **Fix:** upgrade to highest patched 14.2.x; smoke-test SSR/image/SSE.
- **No app-layer per-IP/per-user rate limiting; Largo cost gate fails open** — `src/app/api/market/largo/query/route.ts:35,75-83` (+ all routes). **Fix:** edge/Redis limiter keyed by IP (unauth) + userId (auth); make Largo cost gate **fail CLOSED** on Redis loss.
- **Whop webhook 200-ACKs and silently drops changes when `WHOP_WEBHOOK_SECRET` unset** — `src/app/api/webhook/whop/route.ts:31-59`. **Fix:** make a missing secret a **deploy-blocking readiness failure** in prod.
- **No `middleware.ts` default-deny backstop** — project-wide (file referenced in `public/track-record/route.ts:6` but **absent**). **Fix:** add `clerkMiddleware()` default-deny for `/api/*` with an explicit public allowlist; fix the stale comment.
- **`eslint.ignoreDuringBuilds: true`** — `next.config.mjs:61`. Security lint never blocks a deploy. **Fix:** make `npm run lint` a required, deploy-blocking check **[Not verified — confirm CI gates Railway]**.

**Medium**
- CSP allows `'unsafe-inline'`/`'unsafe-eval'` in `script-src` — `next.config.mjs:25-28`. **Fix:** move to nonce/hash CSP.
- DB SSL defaults to `rejectUnauthorized:false` on the public PG endpoint — `src/lib/db.ts:38-47`. **Fix:** `DATABASE_SSL_STRICT=1` in prod with managed CA **[Not verified — confirm prod connection mode]**.
- `push/subscribe` lets a user overwrite another's row (`endpoint` is PK; `ON CONFLICT` overwrites `user_id`) — `src/app/api/push/subscribe/route.ts:45-53` (IDOR — latent while push inert). **Fix:** conflict target `(endpoint,user_id)`.
- Verbose upstream error messages echoed to clients (info disclosure) — `largo/query/route.ts:234-235`, `flows/route.ts:41`. **Fix:** generic client message; log detail server-side.
- `/api/membership/sync` fails open on Redis loss (API amplification DoS) — `src/lib/membership-sync-limit.ts:41-54`. **Fix:** in-process fallback limiter or fail closed (429).
- `/docs/*` internal vendor/analysis catalogs readable by any signed-in user — `src/middleware.ts:3-11` / `src/app/docs/layout.tsx`. **Fix:** gate behind `requireAdmin()` or exclude from prod build.

**Low** (see `08`): unverified admin-email match (no `verification.status==='verified'` check, `admin-access.ts:17-23`); admin push-broadcast with no audit log (`push/send/route.ts:38-80`); connect-only SSE auth (`market/live/route.ts:18-21`); Clerk-outage paywall flap; webhook null-email drop path.

Security-area counts: **C1 / H5 / M6 / L5.** `npm audit`: 10 vulns (9 high, 1 moderate).

---

## K. Scalability Risks for 500 Concurrent Users (breaking points + fixes)

Full detail in `09-SCALABILITY.md`. The cache-reader rule is genuinely honored on hot per-user paths, which is what makes a 2-RPS ceiling survivable. Risk is concentrated in config + a handful of fail-closed/batching/boot-time changes — **no re-architecture.**

1. **[Critical] Postgres pool exhaustion (most likely first failure).** `max=5`/replica + `ensureSchema` per query + advisory-lock-pinned clients (→ 2–3 usable). Bursts queue 15s then 502/503. PgBouncer **doc-only, unverified**. **Fix:** confirm PgBouncer (transaction mode); set `PG_POOL_MAX` deliberately (10–20 vs `max_connections`/replicas); move long-lived locks off the request pool; lower `connectionTimeoutMillis` to 3–5s to shed load fast; wire `waitingCount` into alerts.
2. **[High] SSE pulse caps at exactly 500/instance → 501st user 503s.** Plus 500 streams = 500 fds + ~2,000 Redis GET/sec. **Fix:** run ≥2 web replicas (then apply per-replica fixes) and/or raise `SSE_MAX_STREAMS` with fd headroom; replace the per-connection 250ms GET with **one Redis pub/sub subscriber per replica** (or read in-memory `indexStore`) — collapses ~2,000 GET/sec to a handful; load-test SSE fan-out at 500+.
3. **[High] Redis-down fail-open cascade.** UW cap + AI-spend cap + Largo gate all fail open at once; in-memory cache masks it. **Fix:** one **"Redis degraded" health alert** (limiters already track `sharedRedisFailedAt`); switch cost-sensitive gates (AI budget, Largo concurrency) to **fail-closed with a conservative local backstop**.
4. **[High] UW cap fails open → 2 RPS × N replicas blows the hard cap.** **Fix:** `UW_MAX_RPS=ceil(2/replica_count)` via env so Redis-down fallback still respects the cluster cap; alert when failing open.
5. **[High] Per-replica Anthropic spend + fail-open Largo gates** → org spend can reach N×$50 unalerted; unbounded concurrent Claude loops during a Redis blip. **Fix:** cross-replica daily spend counter (Redis `INCRBYFLOAT` per ET day) + org alert + hard daily kill-switch; fail-closed gates above a ceiling.
6. **[High] Unbatched telemetry INSERTs = dominant write load** competing for the pool of 5. **Fix:** buffer + multi-row flush; sample non-error events (keep all errors); dedicated/async low-priority pool.
7. **[High] Lazy `ensureSchema` + pool-nuke-on-error = deploy thundering herd.** **Fix:** run migrations once at boot (instrumentation `register`, node-gated); on failure reset only `schemaReady`, never the pool; guard one-time `LOCK TABLE`/dedup behind a `platform_meta` version flag.
8. **[Med] Client poll cadences** (1.5s quote + 3s pulse + 5s positions) ≈ **600 req/s** to the web tier at 500 users (cache-fronted, but each pays Clerk auth + cache read). **Fix:** prefer SSE over the 3s poll; widen quote poll to 2–3s (matches its 2s Redis TTL); `revalidateOnFocus:false` everywhere.
9. **[Med] uw-cache-refresh ~13s UW saturation per `*/2` run, same cadence as flow-ingest.** **Fix:** stagger to `1-59/2`; priority lane so interactive UW reads preempt bulk warm.
10. **[Med] Scale-out spawns one UW/Polygon WS per replica** (`code=1008` collisions). **Fix:** dedicated socket/worker service (or Redis leader-election) so only one replica holds the live sockets.

Scalability-area counts: **C1 / H7 / M6 / L5.**

---

## L. Bugs Found (consolidated; file:line · severity)

| Bug | Severity | File:line |
|---|---|---|
| Two GEX crons (`gex-alerts`, `gex-eod-snapshot`) never fire — no `railway.toml`, not in `CRON_JOBS`; ship broken heatmap "vs prior close" | High | `src/app/api/cron/gex-alerts/route.ts`, `gex-eod-snapshot/route.ts`; `cron-registry.ts:16-114` |
| SPX-play returns hard **HTTP 502** on a Massive connect blip (no stale-serve/retry; connect errors bypass breaker) — observed in prod logs | High | `src/app/api/market/spx/play/route.ts:35-39` (RT-2) |
| `spxBroadcaster` permanently stops reconnecting after `MAX_RECONNECT_ATTEMPTS=10` → transient Massive blip = permanent live-bar outage until restart | High | `src/lib/spx-broadcaster.ts:28,61-64` |
| `/api/market/live` SSE has no connection cap/heartbeat/backpressure (DoS amplifier) | High | `src/app/api/market/live/route.ts:24-43` |
| `fetchRecentFlows` `COALESCE(created_at,…)` defeats the timestamp index; `ORDER BY total_premium` un-indexed | High | `src/lib/db.ts:796-866` |
| Upgrade-page product sigils silently never render (LABEL_TO_MARK key mismatch → every `ProductMark` undefined) | Med | `FeatureComparison.tsx:5`, `AuthProofRail.tsx:5` vs `upsell-features.ts:24` |
| `membership-reconcile` TOML hourly but label "6h" + `stale_after_min=780` → watchdog hides a stuck run 13h | Med | `railway.membership-reconcile.toml`; `cron-registry.ts:96-104` |
| `polygon-socket.ts` (SPX/VIX) has no stall watchdog → half-open feed freezes `indexStore`, pulse serves stale with no auto-recovery | Med | `src/lib/ws/polygon-socket.ts:157-162` |
| `endpointStats` telemetry Map unbounded, keyed on raw per-ticker/per-OCC paths → slow leak + admin-dashboard cardinality blow-up | Med | `src/lib/api-telemetry.ts:40,203`; `polygon.ts:20` |
| `tierCache`/`shared-cache` in-memory Maps never bounded (expired checked on read, never evicted) | Med | `tier-cache.ts:19`; `shared-cache.ts:3,97` |
| `/market/quote` ticker not validated before paid upstream (uppercased only) | Med | `src/app/api/market/quote/route.ts:136` |
| `/market/flows` `since_hours` unbounded → unbounded DB scan window + cache-key explosion | Med | `src/app/api/market/flows/route.ts:20,24` |
| `insertManyNighthawkOutcomes` N+1 awaited insert loop (15–30 serial round-trips/edition) | Med | `src/lib/db.ts:2206-2241` |
| `hit-cron.mjs` has no fetch `AbortController`/timeout → hung cron consumes a web worker, never logs the run | Med | `scripts/hit-cron.mjs:27-38` |
| After-hours brief uses browser-local `new Date().getHours()` → SSR/client hydration mismatch + copy flash | Med | `src/components/desk/FlowBrief.tsx:42-45,61` |
| FlowAlertStream list keys include array index while list reorders under `AnimatePresence` → broken identity, remount churn | Low | `src/components/desk/FlowAlertStream.tsx:270` |
| Options-socket stall watchdog tracked liveness only on priced quotes → quiet contract = false stall → 1006 reconnect storm | High (**FIXED** a9eb3dc) | `src/lib/ws/options-socket.ts` (RT-1) |
| `DISCORD_OPS_WEBHOOK_URL not set` warning logged on every alert | Low (**FIXED** a9eb3dc) | `src/lib/spx-play-notify.ts:44` (RT-3) |

---

## M. UX / UI Issues Found

From `02-FRONTEND.md` + `10-PRODUCT-UX.md`.

**Trust-eroding product gaps (High).**
- **Onboarding/landing still teach removed "Hunt Modes"/agents**; the genuinely strong Night's Watch is never introduced. Day-one "is this finished?" trust hit. (`onboarding-content.ts:78`, `FeaturesGrid.tsx:68`, `NightHawkFeed.tsx:26`) → rewrite copy; delete dead `AgentSidebar`/`DayTradeAgentWorkspace`/`AgentPowerModal`.
- **Heatmaps marketed as sector/internals (TICK/TRIN/ADD)/market-tide but renders GEX only** — a falsifiable claim the product fails on 1 of 5 headline tools (refund/chargeback risk). (`Heatmap.tsx:7`, `FaqSection.tsx:75`) → restore the view or re-cut all marketing.
- **Close-position (the only realized-P&L money action) uses `window.prompt`/`window.confirm`** — unstyled, unvalidated, no mobile numeric pad, and **suppressible on installed-PWA/mobile** the product markets → user may be unable to exit a position. (`NightsWatchPanel.tsx:445,477`) → replace with the existing `Modal` + numeric input prefilled from `valuation.mark`.
- **No free-tier preview** — every tool is a hard premium wall; the 10→500 funnel must convert on the sales page alone. (`(site)/dashboard|flows|heatmap|terminal|nighthawk/page.tsx`) → throttled cache-served preview (15-min-delayed HELIX tape, read-only last closed SPX play, 1–2 Largo Q/day) within the cache-reader rule (zero new upstream calls).
- **Flagship HELIX tape card is keyboard-inaccessible** (no `role`/`tabindex`/`keydown`) — WCAG 2.1.1/4.1.2 fail on the core feature; `NightsWatchPanel` does it right. (`FlowAlertStream.tsx:268-283`) → add `role="button"`, `tabIndex=0`, `aria-label`, `onKeyDown`; extract shared `<ClickableCard>`.

**Performance/feel (Medium).**
- HELIX tape FLIP-animates up to 150 `motion.div` (`layout="position"`) during whale bursts → jank on the feature selling "real-time tape." (`FlowAlertStream.tsx:242-282`)
- `FlowFeed` ~9 O(n)/O(n·m) `useMemo` recomputes per print (`coordinatedTickers` is alerts×darkPoolPrints). (`FlowFeed.tsx:146-428`)
- `LargoTerminal` rebuilds the whole message array + smooth-scrolls per stream token → chat stutter. (`LargoTerminal.tsx:61-87`)
- SPX desk polls pulse every 1s on SSE-fallback (raise floor + jitter). (`useMergedDesk.ts:11,72-77`)
- `DnaHelixBackground` ~96 SMIL particles + 2-pass blur under the busiest page. (`DnaHelixBackground.tsx:157-202`)
- 305 KB monolithic `globals.css` on every first paint (LCP/egress at cold load).
- 201+ inline-style hex colors bypass design tokens (defeats memoization, blocks theming).

**Product trust / compliance (Medium).**
- Largo shows *which* tools it used but not *what they returned* — no inline citations; reads like an AI wrapper. (`LargoTerminal.tsx:174`) → collapsible `Sources` footer reusing the Night's Watch `DataSourcesLedger`.
- Disclaimers inconsistent — gated on the SPX play card (can show an actionable lean without it), absent on the HELIX tape. (`SpxTradeAlerts.tsx:382`, `FlowFeed.tsx`)
- "Alerts reach you in real time" marketed but **push is inert** (in-tab audio only; `web-push` not installed). (`send-web-push.ts`, `FaqSection.tsx:80`)

---

## N. Unused or Underused Code / API / Tools (consolidated)

- **`gex-alerts` + `gex-eod-snapshot` cron routes** — exist, authenticate, never scheduled, invisible to the watchdog. Wire (add tomls + `CRON_JOBS`) **or delete**.
- **`web-push` package — not installed.** Subscribe route accepts rows; nothing ever delivers. Install + verify E2E **or** flag the UI off.
- **`@sentry/nextjs` — not installed.** `error-sink.ts:77-78` dynamic-imports a missing package; "external error tracking" is dead. Install + wire **or** delete the branch and document Postgres+Discord as the strategy.
- **`lucide-react` ^0.395.0 — zero importers in `src/`.** Remove (supply-chain surface for nothing).
- **Dead agent UI** — `AgentSidebar`, `DayTradeAgentWorkspace`, `AgentPowerModal` (the removed "Hunt Modes"). Delete or restore.
- **`/docs/*` internal analysis pages** (17 pages / 7,551 LOC) — readable by any premium (or signed-in) user; build/route bloat + IP leak. Re-gate to admin or exclude from prod.
- **Largo "tools used" chips** — render tool names but not returned values/timestamps (underused grounding data already available).
- **`tsx` runs a production worker but is a devDependency** — underused-as-prod-dep risk; promote to `dependencies` or precompile.

---

## O. Strengths

- **Cache-reader discipline is real.** Per-user features (Night's Watch O(distinct chains), quote/GEX/SPX desk) never make per-user upstream calls — the only way a 2-RPS UW ceiling survives 500 users.
- **Correct, atomic limiters.** Redis-Lua sliding windows enforce a *cluster-wide* UW/Polygon ceiling with a cross-replica pub/sub circuit breaker.
- **Strong cache primitive.** `server-cache.ts`: single-flight SWR, LRU-bounded, degradation tracking — the model the leaky caches should copy.
- **Clean security baseline.** Fully parameterized SQL, no `dangerouslySetInnerHTML`/`eval`/CORS-wildcard, allowlisted proxy + Discord webhook, HMAC-verified Whop webhook, constant-time cron auth, credential redaction, no secrets in client bundle.
- **IDOR-safe by construction.** Every per-user query scopes on the trusted Clerk `userId`; the Largo tool can't spoof ownership.
- **Honesty discipline (the brand asset).** Stale badges, em-dash-when-off-live, `PROOF_REAL=false`, a deterministic Night's Watch verdict engine that refuses to fabricate P&L, a cross-tool "Verified data sources" provenance ledger, and a public track record reusing the premium aggregation.
- **Solid design-system layer** (`src/components/ui`): focus-trapped Modal, honest empty/loading/error states, broad reduced-motion coverage, zero banned grey, all `next/image`.
- **Operationally thoughtful:** graceful SIGTERM socket shutdown, advisory-locked migrations and flow ingest, a cron watchdog concept, batched nightly DB cleanup.

## P. Weaknesses

- **Fail-OPEN everywhere on Redis loss** — the single biggest systemic weakness; turns a Redis blip into a correlated multi-system failure that hides itself.
- **Per-process assumptions vs unset replica count** — limiters, spend trackers, WS managers, and tier cache all assume one replica, so horizontal scaling breaks the hard caps.
- **DB pool sized for an unverified PgBouncer**, with `ensureSchema` per query, lazy boot-time migrations, pool-nuke-on-error, and the heaviest read/write paths un-indexed/unbatched.
- **Dependency CVEs on the auth boundary** (Clerk) and framework (Next), plus two wired-but-uninstalled integrations (Sentry, web-push).
- **Monitoring blind spots** — single swallowed-error Discord sink, alert-only-on-total-failure crons, two invisible dead crons, no pool-saturation/Redis-degraded alerts, no hard AI cost cap.
- **Marketing/onboarding promise things the product no longer renders** (Hunt Modes, sector/internals heatmaps, real-time push) — trust erosion at the exact moment of a 10→500 launch.
- **Desk-layer polish gaps** — `window.prompt` money action, keyboard-inaccessible flagship card, heavy live-tape animation, 305 KB global CSS, 201+ inline hex colors.

## Q. Recommended Enhancements (premium / Bloomberg-terminal)

- **Largo inline citations.** Return `{tool, key_value, as_of}` per answer; render a collapsible "Sources" footer (reuse `DataSourcesLedger`). Turns "AI wrapper" perception into "grounded analyst" — the marketed differentiator.
- **Throttled free preview of one tool** (15-min-delayed HELIX tape / read-only last closed SPX play / 1–2 Largo Q/day) served entirely from existing caches — highest-ROI growth change for a 10→500 launch; zero new upstream calls.
- **Restore the sector/internals/tide heatmap view** (components exist) so Heatmaps delivers all five marketed dimensions, not just GEX.
- **Real push delivery** (install `web-push`) for GEX/flow/play alerts — the "alert-first PWA" promise.
- **Org-wide AI budget console** with a hard daily kill-switch and per-user round/cost caps — protects margin and enables confident Largo marketing.
- **A "Redis degraded / pool saturated" ops panel** + second alert channel (email/PagerDuty) + daily "all healthy" heartbeat — turns silent slow-burn into visible signal.
- **Shared `<ClickableCard>` + design-token enforcement (extend `lint:brand`)** — accessibility + theming consistency across tape/watchlist/positions.
- **A dedicated WS/socket worker service** writing Redis, making all web replicas pure cache-readers — matches the project's own rule and removes the `code=1008`/uneven-freshness class.

---

## R. Priority Fix List (single ranked list, all areas)

> Severity reflects launch impact at 500 concurrent. Each: title · severity · file · one-line fix.

**Critical**
1. **Clerk authorization-bypass CVE on the auth boundary** · Critical · `package.json` (`@clerk/nextjs ^5.7.6`) · Upgrade to a patched Clerk line; re-run `npm audit` until Clerk advisories clear; E2E test sign-in/tier/admin.
2. **Postgres pool max=5/replica behind an unverified PgBouncer; locks pin connections** · Critical · `src/lib/db.ts:91-97,693-721` · Confirm PgBouncer (txn mode) or set `PG_POOL_MAX` 10–20; move long-lived locks off the request pool; drop `connectionTimeoutMillis` to 3–5s.
3. **Per-process limiters + unset web `numReplicas` multiply UW/Polygon RPS on scale-out** · Critical · `railway.toml`; `uw-rate-limiter.ts:12-15,168-195` · Pin replica count; set `UW_MAX_RPS=ceil(2/N)`; require `REDIS_URL` for multi-replica; move cron warming to a worker lane.
4. **Unsampled/unbatched telemetry INSERT per upstream API call (largest table, dominant write)** · Critical · `api-telemetry.ts:240-244`; `api-telemetry-persist.ts:12-18` · Sample non-errors (100% errors, 1–5% OK) + buffer into multi-row flushes; consider a dedicated pool.

**High**
5. **Redis-down fail-open cascade (UW cap + AI spend + Largo gate all open at once)** · High · `uw-rate-limiter.ts:192`; `largo/query/route.ts:35,82`; `ai-spend.ts:6-9` · Add a "Redis degraded" alert; fail-closed cost-sensitive gates with a local backstop.
6. **Uncapped, fail-open Anthropic/Largo spend (per-process, alert-only)** · High · `anthropic.ts:17-19`; `largo/query/route.ts:75-84` · Cross-replica daily $/token counter + hard org kill-switch (429) + per-user round/cost caps; fail CLOSED on Redis loss.
7. **Next.js 14.2.35 — 14 advisories (WS-SSRF, SC-DoS, cache-poisoning, XSS)** · High · `package.json` (`next 14.2.35`) · Upgrade to highest patched 14.2.x; smoke-test SSR/image/SSE.
8. **SSE pulse caps at exactly 500/instance + per-connection 250ms Redis GET (~2,000/s)** · High · `spx/pulse/stream/route.ts:14-78` · One pub/sub subscriber (or in-memory `indexStore`) per replica; raise `SSE_MAX_STREAMS` / run ≥2 replicas; load-test fan-out.
9. **`/api/market/live` uncapped SSE + broadcaster gives up after 10 reconnects** · High · `market/live/route.ts:24-43`; `spx-broadcaster.ts:28,61-64` · Add cap+heartbeat+backpressure; reconnect indefinitely (capped 60s backoff) while subscribers exist.
10. **`fetchRecentFlows` index-defeating scan over 48h×5000 JSONB rows** · High · `src/lib/db.ts:796-866` · Add `(inserted_at DESC, total_premium DESC)` index, bare-timestamp predicate, paginate, precompute JSONB columns, front with `serverCache`.
11. **Lazy `ensureSchema` + pool-nuke-on-error = deploy thundering herd** · High · `src/lib/db.ts:624-635,127-218` · Run migrations once at boot; on error reset only `schemaReady`; guard one-time `LOCK TABLE`/dedup behind a version flag.
12. **User-controlled tickers on UW routes bypass warm cache, pressure 2-RPS cap** · High · `dark-pool/ticker/route.ts`; `gex-heatmap/route.ts` · Allowlist supported roots (400 unknown); off-warm-set served from Polygon with an LRU warm budget.
13. **No app-layer per-IP/per-user rate limiting** · High · all routes (no global limiter) · Add an edge/Redis limiter keyed by IP (unauth) + userId (auth).
14. **No `middleware.ts` default-deny backstop (one forgotten guard = open route)** · High · project-wide (file absent) · Add `clerkMiddleware()` default-deny for `/api/*` with an explicit public allowlist; fix the stale reference.
15. **Whop webhook 200-ACKs and drops changes when `WHOP_WEBHOOK_SECRET` unset** · High · `webhook/whop/route.ts:31-59` · Make a missing secret a deploy-blocking readiness failure in prod; grant `member:email:read`; add an id-based reconcile heal path.
16. **SPX-play hard-502 on Massive connect blip (no stale-serve/retry; bypasses breaker)** · High · `market/spx/play/route.ts:35-39` (RT-2) · Serve last-known-good `{degraded:true}` (200); jittered retry on connect errors; route connect failures through the breaker; 503 (not 502) when no stale.
17. **Two GEX crons never fire & are watchdog-invisible (broken heatmap feature)** · High · `cron/gex-alerts`, `gex-eod-snapshot`; `cron-registry.ts:16-114` · Add `railway.*.toml` + register in `CRON_JOBS`, or delete the routes.
18. **All alerting funnels through one swallowed-error Discord webhook** · High · `cron-run.ts:35-41`; `spx-play-notify.ts:38-58` · Add a second channel (email/PagerDuty) for critical; surface webhook-post failures; daily heartbeat. (Set `DISCORD_OPS_WEBHOOK_URL` — RT-3.)
19. **`membership-reconcile` hourly but labeled 6h / 13h stale threshold; serial O(users) truncates at 300s** · High · `railway.membership-reconcile.toml`; `membership.ts:146-220` · Align label+threshold; bounded concurrency (5–10); persist a resume cursor; alert on errors>0.
20. **`nights-watch-warm` every minute bursts ~300 concurrent Polygon fetches; >300 silently dropped** · High · `nights-watch-warm/route.ts:26,71-99` · Shard across minutes; dedicated lower-concurrency Polygon lane; raise cap with growth; alert when `capped`.
21. **`eslint.ignoreDuringBuilds:true` — security lint never blocks deploy** · High · `next.config.mjs:61` · Make `npm run lint` a required, deploy-blocking check **[verify CI gates Railway]**.
22. **Flagship HELIX tape card keyboard-inaccessible (WCAG fail on core feature)** · High · `FlowAlertStream.tsx:268-283` · Add `role`/`tabindex`/`aria-label`/`onKeyDown`; shared `<ClickableCard>`.
23. **Close-position money action uses `window.prompt` (suppressible on PWA/mobile)** · High · `NightsWatchPanel.tsx:445,477` · Replace with existing `Modal` + numeric input prefilled from `valuation.mark` + typed-confirm.
24. **`/docs/*` internal analysis/vendor catalogs readable by any premium/signed-in user (IP leak)** · High · `docs/layout.tsx`; `middleware.ts:3-11` · Gate behind `requireAdmin()` or exclude from prod build.
25. **Onboarding/landing teach removed "Hunt Modes"; Night's Watch never introduced** · High · `onboarding-content.ts:78`; `FeaturesGrid.tsx:68` · Rewrite copy to shipped product; add a Night's Watch step; delete dead agent components.
26. **Heatmaps marketed as sector/internals/tide but renders GEX only** · High · `Heatmap.tsx:7`; `FaqSection.tsx:75` · Restore the view or re-cut all marketing to the GEX/dealer-positioning reality.
27. **No free-tier preview — funnel converts on the sales page alone** · High · `(site)/*/page.tsx` (`requireTier`) · Add a throttled cache-served preview of one tool (zero new upstream calls).
28. **305 KB / 11,033-line monolithic `globals.css` on every first paint** · High · `globals.css` (`layout.tsx:12`) · Split tool CSS into route-scoped modules/`@layer`; target <40 KB public sheet.
29. **HELIX tape FLIP-animates up to 150 cards on a live SSE stream** · High · `FlowAlertStream.tsx:242-282` · Drop `layout="position"`; animate only the new row; memoize + hoist styles; or virtualize.
30. **`@whop/sdk` 0.0.40 (pre-1.0) billing with no contract test** · High · `package.json:22`; `webhook/whop/route.ts:75` · Add a CI signed-fixture unwrap + fixed-membership tier-resolution test.

**Medium** (representative — full list in section files)
31. `polygon-socket.ts` (SPX/VIX) missing stall watchdog · Med · `polygon-socket.ts:157-162` · Add `lastIndicesMessageAt` watchdog + ping like uw/options sockets.
32. Unbounded `endpointStats` telemetry Map (per-ticker/OCC keys) · Med · `api-telemetry.ts:40,203` · Normalize to templated routes; LRU-bound.
33. Unbounded `tierCache`/`shared-cache` Maps · Med · `tier-cache.ts:19`; `shared-cache.ts:97` · Apply `server-cache` LRU eviction.
34. `/market/quote` ticker unvalidated before paid upstream · Med · `quote/route.ts:136` · Allowlist `/^[A-Z0-9.\-]{1,8}$/` (400).
35. `/market/flows` `since_hours` unbounded · Med · `flows/route.ts:20,24` · Clamp to ≤720h.
36. `hit-cron.mjs` no fetch timeout; routes missing `maxDuration` · Med · `scripts/hit-cron.mjs:27-38` · 90s `AbortController`; set `maxDuration` per route.
37. CSP `'unsafe-inline'`/`'unsafe-eval'` · Med · `next.config.mjs:25-28` · Nonce/hash CSP.
38. DB SSL `rejectUnauthorized:false` on public endpoint · Med · `db.ts:38-47` · `DATABASE_SSL_STRICT=1` in prod **[verify mode]**.
39. `push/subscribe` cross-user row overwrite (IDOR) · Med · `push/subscribe/route.ts:45-53` · Conflict target `(endpoint,user_id)`.
40. `/membership/sync` fails open on Redis loss (amplification DoS) · Med · `membership-sync-limit.ts:41-54` · In-process fallback or fail closed.
41. Per-replica 60s tier cache (premium persists post-churn) · Med · `tier-cache.ts:19-49` · Redis pub/sub `tier-changed:{userId}` eviction.
42. Crons alert only on total failure (chronic partial stays green) · Med · `cron-run.ts:18,35` · Watchdog reads `meta_json` for per-task failure ratios; add `partial_degraded`.
43. Upgrade-page sigils never render (key mismatch) · Med · `FeatureComparison.tsx:5` · Key off real labels or add `mark?` to the data row.
44. Largo no inline citations · Med · `LargoTerminal.tsx:174` · Collapsible Sources footer.
45. Disclaimers inconsistent (HELIX tape has none) · Med · `SpxTradeAlerts.tsx:382`; `FlowFeed.tsx` · Persistent page-frame disclaimer; ungate the play-card string.
46. `FlowFeed` ~9 O(n·m) `useMemo`/print · Med · `FlowFeed.tsx:146-428` · Cap working set by time; batch SSE setState per frame.
47. `LargoTerminal` rebuilds whole message list per token · Med · `LargoTerminal.tsx:61-87` · Memoize, re-render only the streaming bubble, batch tokens.
48. After-hours brief hydration mismatch (`getHours()`) · Med · `FlowBrief.tsx:42-45` · Derive from ET; gate first paint behind `mounted`.
49. Client poll fan-in ~600 req/s · Med · `LiveMarketPulse.tsx:45` et al. · Prefer SSE; widen quote poll to 2–3s; `revalidateOnFocus:false`.
50. `insertManyNighthawkOutcomes` N+1 loop · Med · `db.ts:2206-2241` · Single multi-row INSERT.

**Low** (see section files): FlowAlertStream index-in-key; `lucide-react` unused; `tsx` as devDependency runs prod worker; admin email not verification-checked; admin push-broadcast no audit log; connect-only SSE auth; verbose upstream error messages echoed; `DnaHelixBackground` particle cost; 201+ inline hex colors.

---

## S. Launch Readiness Score

**Overall: 68 / 100 — GO-WITH-FIXES.**

| Area | Sub-score | Justification |
|---|---|---|
| 01 API design | 78 | Well-architected cache-readers; risk concentrated in UW-route tickers, SSE polling, fail-open AI cost. |
| 02 Frontend/UX | 70 | Strong design system over a busier, less-accessible desk layer; CSS/animation cost; `window.prompt` money path. |
| 03 Backend services | 72 | Correct primitives; 3 cheap-to-fix High blockers (pool, `/live` SSE, pulse polling). |
| 04 Database/Redis | 60 | Critical telemetry write-amplification + heaviest read un-indexed + lazy migrations; primitives are good. |
| 05 Cron/background | 62 | Scaling topology + monitoring completeness gaps; 2 dead crons; single alert sink. |
| 06 Auth/Clerk | 88 | Strongest area: 0 access-control C/H; IDOR-safe; fails closed. (Clerk *CVE* scored under Security.) |
| 07 Tools/integrations | 66 | Lean deps, but Redis tier-0 fail-open, unverified PgBouncer, pre-1.0 Whop SDK, two uninstalled integrations. |
| 08 Security | 55 | Clean app logic, but a Critical Clerk CVE on the auth boundary + 14 Next advisories + no edge rate limit. |
| 09 Scalability (500) | 58 | No re-architecture needed, but pool exhaustion + SSE cap + Redis-down cascade are real cliffs at the target. |
| 10 Product/Trading UX | 70 | Genuinely deep + honest, but marketing/onboarding over-promise and there's no conversion preview. |

**Verdict: GO-WITH-FIXES.** The architecture is sound and the product is differentiated; the gaps are config, dependency upgrades, and a handful of fail-closed/batching/boot-time changes — not redesign.

**Must-fix-before-launch set (NO-GO until all are cleared):**
1. Upgrade **Clerk** off the authorization-bypass CVE (and Next.js 14.2.x for the 14 advisories). *(R-1, R-7)*
2. **Confirm/provision PgBouncer** (or set `PG_POOL_MAX` + move locks off the pool); add pool-saturation alerting. *(R-2)*
3. **Pin the web replica count** and make limiters/spend replica-aware (`UW_MAX_RPS=ceil(2/N)`, cross-replica AI spend). *(R-3, R-6)*
4. **Fail CLOSED for cost-sensitive gates on Redis loss** + add a hard AI daily kill-switch + a "Redis degraded" alert. *(R-5, R-6)*
5. **Batch + sample telemetry INSERTs.** *(R-4)*
6. **Fix the SSE layer:** pulse pub/sub fan-out + cap headroom; cap `/market/live` + indefinite broadcaster reconnect. *(R-8, R-9)*
7. **Allowlist user-controlled tickers** on UW routes; add an edge per-IP rate limiter. *(R-12, R-13)*
8. **Make `WHOP_WEBHOOK_SECRET` a prod readiness gate**; add the `middleware.ts` default-deny backstop. *(R-14, R-15)*
9. **Re-gate `/docs/*` to admin.** *(R-24)*
10. **Align marketing/onboarding to the shipped product** (Hunt Modes, Heatmaps) and **replace the `window.prompt` money action**. *(R-23, R-25, R-26)*

Clearing items 1–10 moves the overall score to the low-80s and the verdict to **GO**.

---

## T. 30 / 60 / 90-Day Engineering Roadmap

**Days 0–30 — Stop the bleeding (launch-blocking).**
1. **Dependencies:** upgrade Clerk (clear GHSA-w24r-5266-9c3c) + Next 14.2.x; `npm audit` to zero high; E2E auth/tier/admin smoke. Remove `lucide-react`; install+wire **or** delete Sentry & web-push branches.
2. **DB:** confirm PgBouncer (transaction mode) or set `PG_POOL_MAX`; move SPX-eval/migration locks off the request pool; drop `connectionTimeoutMillis` to 3–5s; **batch+sample telemetry**; add the `(inserted_at DESC, total_premium DESC)` index + bound `fetchRecentFlows`; move migrations to boot-time (no pool-nuke).
3. **Redis/limiters:** pin web replica count; `UW_MAX_RPS=ceil(2/N)`; **fail-closed** AI budget + Largo concurrency with local backstop; hard org AI kill-switch + cross-replica spend; **"Redis degraded" alert**.
4. **SSE:** pulse → one pub/sub subscriber per replica; cap `/market/live` (+heartbeat/backpressure); indefinite `spxBroadcaster` reconnect; SPX-play stale-serve on Massive blip (RT-2); load-test SSE at 500+.
5. **API hardening:** allowlist UW-route tickers; edge per-IP rate limiter; `clerkMiddleware()` default-deny; `WHOP_WEBHOOK_SECRET` readiness gate; clamp `/flows since_hours`; validate `/quote` ticker.
6. **Crons/ops:** wire or delete the two GEX crons; second alert channel + daily heartbeat + `DISCORD_OPS_WEBHOOK_URL`; `hit-cron.mjs` timeout + per-route `maxDuration`; fix `membership-reconcile` cadence/labels + concurrency + cursor.
7. **Product trust:** re-gate `/docs/*` to admin; align Hunt Modes/Heatmaps marketing+onboarding; replace the `window.prompt` close-position action with the Modal.

**Days 31–60 — Harden & make scaling visible.**
8. Make ESLint a required deploy-blocking check; nonce/hash CSP; `DATABASE_SSL_STRICT=1`; fix `push/subscribe` IDOR; generic client-facing error messages.
9. Bound the leaking Maps (`endpointStats`, `tierCache`, `shared-cache`) with LRU; add the `polygon-socket` stall watchdog; cross-replica tier-cache eviction (`tier-changed:{userId}`); Whop SDK contract test in CI.
10. Watchdog upgrade: per-task failure ratios + `partial_degraded` status + pool-saturation/Redis-degraded panels in admin.
11. Frontend perf: split `globals.css` to route-scoped modules (<40 KB public); de-animate the HELIX tape (animate only the new row / virtualize); fix `FlowFeed`/`LargoTerminal` re-render cost; add keyboard-accessible `<ClickableCard>`; fix the upgrade-page sigil key mismatch and the FlowBrief hydration mismatch.
12. Stagger `*/2` crons; add a Night's Watch Polygon warm lane; promote `tsx` to a prod dependency (or precompile the worker).

**Days 61–90 — Premium & growth.**
13. **Dedicated WS/socket worker service** writing Redis; make all web replicas pure cache-readers (removes `code=1008` + uneven freshness).
14. **Throttled free preview** of one tool (cache-served) + **org AI budget console** with per-user caps.
15. **Largo inline citations** (Sources footer) + **real push delivery** for GEX/flow/play alerts.
16. Restore the **sector/internals/tide heatmap** view (or finalize the GEX-only re-cut); centralize disclaimers across HELIX + SPX; enforce design tokens (extend `lint:brand` to flag raw bull/bear/gold hex).
17. Run a full 500-concurrent load test (SSE fan-out, pool saturation, Redis op-rate, AI spend under a simulated Redis blip) and right-size Redis/replicas from the results.
