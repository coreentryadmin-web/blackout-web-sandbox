# BLACKOUT — EXPANDED AUDIT EXTENSION (Master Report)

**Auditor:** Pass-2/3 expanded-audit synthesis.
**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web` — same files). **READ-ONLY** on the codebase; no git commit.
**Date:** 2026-06-24.

---

## 1. Note — this supplements the core report

This document is the **EXTENSION** master report. It supplements **`BLACKOUT_FULL_AUDIT.md`** (the core audit, sections **A–T**, overall grade **68/100**) and covers the expanded-audit deliverables that go *beyond* it: the per-provider deep-dives (Unusual Whales, Polygon/Massive, Claude/AI cost), the Railway/infrastructure audit, the feature inventory + feature-to-data-source matrix, the technology-utilization report, the consolidated total-cost model, and the multi-tier scalability simulation.

**Full per-issue detail lives in the `BLACKOUT_AUDIT/` section files** — this report condenses and cross-references; it does not replace them:

| § | Section file | Counts (C/H/M/L) |
|---|---|---|
| 11 | `BLACKOUT_AUDIT/11-UW-DEEP.md` — Unusual Whales deep-dive | 0 / 2 / 5 / 3 |
| 12 | `BLACKOUT_AUDIT/12-POLYGON-DEEP.md` — Polygon/Massive deep-dive | 0 / 4 / 4 / 2 |
| 13 | `BLACKOUT_AUDIT/13-CLAUDE-COST.md` — Claude/AI + cost model | 0 / 2 / 4 / 4 |
| 14 | `BLACKOUT_AUDIT/14-INFRA-RAILWAY.md` — Railway/infrastructure | 1 / 5 / 6 / 5 |
| 15 | `BLACKOUT_AUDIT/15-FEATURES-MATRIX.md` — features + tech utilization | 0 / 2 / 4 / 2 |
| 16 | `BLACKOUT_AUDIT/16-COST-MODEL.md` — consolidated cost model | 0 / 2 / 3 / 0 |
| 17 | `BLACKOUT_AUDIT/17-SCALE-TIERS.md` — 500/1k/5k scale simulation | 2 / 4 / 1 / 0 |

**Extension totals:** 3 Critical · 21 High · 27 Medium · 16 Low (after de-dup of cross-referenced core findings).

> **The one architectural fact that governs everything below — the cache-reader rule** (verified `09-SCALABILITY.md:19`, `11-UW:25`, `12-POLYGON:82`, `16-COST §0`): per-user features read **shared Redis/in-memory caches**, never per-user upstream. Crons + WebSockets populate the caches; users only read them. This is why a platform on a **2-RPS UW ceiling** and a **40-RPS Polygon ceiling** is viable at 500+ concurrent users, and why **only three cost lines scale with users** (Anthropic-Largo, Railway compute/SSE, Redis/egress op-rate). Everything else is flat.

---

## 2. Unusual Whales Audit (condensed — see §11)

**Utilization.** UW documents **172 REST endpoints** (32 categories) + **12 real WS channels**. The code wires **~90–97 REST path-templates (~52–56% of REST surface)** via 116 exported fetchers and joins **7 of 12 WS channels (58%)**. But only **~11 endpoints (~6%)** are continuously exercised (tide, dark-pool, NOPE, net-prem-ticks, flow-per-strike, GEX, flow-alerts, top-net-impact, sector-tide, congress); the rest fire only on a Largo tool-call or a desk refresh. **Capability-weighted, the platform extracts ~35–45% of an Advanced UW plan.** UW is flat-rate, so **every unused endpoint is paid-for capability left idle** — the opportunity is value-extraction, not $ savings.

**Enforced ceiling:** 2 RPS cluster-wide (`uw-rate-limiter.ts:12,14`). **Base load** (flat across all tiers): 23 UW REST tasks / 2 min from the warm cron + 1 WS multiplex **per replica**. The cache-reader rule holds — users read Redis, never UW.

**Top findings:**
- **UW-1 (High):** the 5 unused WS channels include `option_trades` (full options tape), `lit_trades` (lit equity prints), and `price` — the platform **polls REST** (`net-prem-ticks` 60s, `flow-per-strike` 120s) for data UW streams **free** over the already-open socket. Streaming is the architecturally-correct lever at 5,000 users: better freshness + reclaimed 2-RPS budget. `live-api-integrations.ts:7-15`, `uw-cache-refresh/route.ts:80-99`.
- **UW-2 (High, opportunity):** entire UW datasets are **unwired** — `politician_portfolios` (8 eps), `private_markets` (9), `crypto`/`forex`/`commodities`, `volatility/anomaly` + `vix-term-structure`, `option-trades/full-tape`, earnings-call transcripts, `stock-volume-price-levels`. These are net-new products and desk signals on already-paid data. Prioritize vol-anomaly/VIX-term (desk-relevant, low effort) → full-tape (backtest/outcomes) → alt-data products.
- **UW-4 (Med):** `flow-alerts` cold-miss paginates **3×** (limit 200 each) — a 3-call burst against the 2-RPS budget. `unusual-whales.ts:563-615`.
- **UW-5 (Med):** `net-prem-ticks` 60s TTL vs 120s cron cadence → guaranteed mid-cycle live refetch for 4 tickers (heaviest steady REST consumer). `uw-shared-cache.ts:21`.
- **UW-9 (Med):** no calls/min-vs-120-cap or fail-open telemetry — a Redis-down ceiling breach is invisible. `uw-rate-limiter.ts:192,356`.

**NOT VERIFIED — needs UW invoice/account:** tier/price ($375), 120/min cap, `UW_CLIENT_API_ID=100001` correctness, Kafka/MCP streaming entitlement (which would be the definitive 5,000-user fix: single ingest → Redis, zero per-replica fan-out).

---

## 3. Polygon / Massive Audit (condensed — see §12)

**Efficiency verdict: the HOT paths are efficient and well-architected.** 21 distinct REST endpoints + 2 WS sockets (indices + options). The indices WS feeds a shared store; `withServerCache` provides single-flight in-flight dedup + a Redis layer, so **500 users viewing SPX/SPY cost the same upstream as 1 user**. The GEX matrix (`fetchGexHeatmap`) is computed once/ticker/20s and shared in-memory + Redis; all positioning consumers are strict cache-readers. **The inefficiencies are at the edges, not the core.** Working rate ceiling = **40 RPS** (`POLYGON_MAX_RPS`) — **NOT VERIFIED** against the Massive invoice.

**The one hot path that matters:** `/v3/snapshot/options/{underlying}` (paginated, **1–16 pages/build**) — the core options primitive (GEX/VEX/DEX/CHARM/max-pain/IV-term/0DTE). The only real scaling exposure is **distinct-ticker fan-out** on it.

**Top findings:**
- **HIGH-4:** `spx-power-hour-engine.ts:164-171` hardcodes `api.polygon.io` (ignores `POLYGON_API_BASE`) **and** uses underscore filter params (`strike_price_gte` vs the dotted `strike_price.gte` used everywhere else) → the engine **almost certainly always serves the synthetic fallback** (tier-independent correctness bug).
- **HIGH-3:** GEX heatmap cache is **unbounded in the distinct-ticker dimension**; the 200-key in-memory `clear()` wipes the hot SPY/SPX entry instead of LRU-evicting one. At >200 distinct tickers (5k users), `clear()` storms thrash the busiest ticker. `polygon-options-gex.ts:815,1830,1912`.
- **HIGH-1:** Night's Watch valuation has **no global concurrency ceiling** on the chain snapshot when the options WS is off. `options-socket.ts:35-40`, `chain-cache.ts`.
- **HIGH-2:** `fetchSpyGapPct` bypasses **both** the rate limiter and the circuit breaker (calls `trackedFetch` directly, not `polygonTrackedFetch`). `gap-proxy.ts:24-32`.
- **MED-2:** connect-level failures never feed the breaker (only HTTP 429 does) and there's no connect retry/backoff — the scale-up of the RT-2 502 storm.

**Unused-but-documented endpoints worth adopting:** the **single-contract options snapshot** `/v3/snapshot/options/{underlying}/{contract}` (biggest win — replaces paginated band scans for NW warming, directly mitigates HIGH-1), the universal snapshot, options trades/quotes + FMV WS channels. **Possible paid-but-unused:** `MASSIVE_WS_STOCKS` is defined but no client subscribes — a real-time stocks feed possibly being polled via REST instead.

**Breakpoints:** 500 holds if traffic concentrates on SPX/SPY and `OPTIONS_WS_ENABLED=true` (NOT VERIFIED). ~1,000 needs LRU eviction + curated ticker allow-list + global force throttle + page telemetry. ~5,000 needs WS-only NW marks (or single-contract endpoint), connect-breaker + stale-serve, multi-replica Redis-shared caches, and likely a plan bump or a dedicated chain-snapshot micro-cache.

---

## 4. Claude / AI Audit + COST @ 500 / 1k / 5k (see §13)

Every Anthropic call funnels through `anthropicText()` (single-shot) and `anthropicToolLoop()` (Largo agentic loop) in `src/lib/providers/anthropic.ts`. **10 distinct call sites.** Only TWO models: `claude-sonnet-4-6` (Largo + default) and `claude-haiku-4-5` (commentary only). No Opus/Fable; no `count_tokens` anywhere.

**Architecture fact (cache-reader rule):** every surface **except Largo** is a shared-cache reader → its cost is **independent of user count**. Only **Largo** scales linearly with active users.

### The cost table

| Users | Largo/mo (typical) | + Shared (~flat) | **Total/mo (typical)** | **Total/mo (heavy Largo)** |
|---|---|---|---|---|
| **500** | $1,638 | $275 | **~$1,910** | **~$13,700** |
| **1,000** | $3,276 | $278 | **~$3,555** | **~$27,200** |
| **5,000** | $16,380 | $300 | **~$16,680** | **~$134,700** |

**Shared subtotal ≈ $276/mo** (flat at every tier). **GEX-explain is ~75% of it** purely on frequency (~1,300 calls/day, per-ticker 3-min TTL, running on **sonnet**). The shared lines: SPX commentary $18.84, GEX explain $212.94, flow brief $2.46, play gate $9.49, NH synthesis $1.67, NH critic $0.69, NH explainer $5.04, NW narrative $24.78.

**Largo per-turn:** typical 3-round turn ≈ **$0.13** (~32K input × $3/M + ~2.4K output × $15/M); pathological 12-round turn ≈ **$0.30–0.55** — the quadratic re-send of prefix + accumulated tool results is the driver, not output.

### Assumptions (all NOT VERIFIED — needs prod telemetry / invoice)
- **List prices** (`ai-spend.ts:23-36`): sonnet $3/$15 per MTok, haiku $1/$5; cache-read 0.1×, cache-write 1.25×. An enterprise/committed-spend discount scales every number down linearly.
- **Token counts** are char-derived (÷4) estimates — no `count_tokens` in code.
- **Usage:** 30% of users are daily-active premium Largo users; typical 4 turns/day × $0.13; heavy 8 turns/day × $0.40 @ 40% active; 21 trading days/mo.
- The **10–15× typical-vs-heavy spread** is the real budgeting risk; the only hard backstop is the opt-in org-wide kill-switch.

**Top levers:** (C-6, launch blocker) arm `DAILY_AI_SPEND_KILL_USD` in prod — without it Largo is financially unbounded; (C-1) unlock Largo prompt caching by sending a stable, name-sorted tool set + extra `cache_control` breakpoints (today the intent-filtered tool list invalidates the system-prompt cache every turn, re-billing ~32K input tok/turn with near-zero cache benefit — saves ~$5–8k/mo @5k); (C-2) move GEX-explain + flow-brief to haiku (−$142/mo flat, no quality loss).

---

## 5. Railway / Infrastructure Audit (see §14)

**Topology:** ONE long-running Next web service (`railway.toml`, Nixpacks/Node20, no Dockerfile, no `output:standalone`) + **10 single-replica cron *trigger* services** that `fetch` `/api/cron/*` over the **public** URL with Bearer `CRON_SECRET` via `scripts/hit-cron.mjs`. **All cron WORK runs inside the web process pool.** Web `numReplicas` is **unset (=1 default)** — dashboard-controlled and unknown from the repo. Sockets + schema + pool boot **lazily on first request** (every rolling deploy ships a cold replica); healthcheck (`/api/health`) is liveness-only and the real readiness probe (`/api/ready`) is **not wired**.

**13 `/api/cron/*` routes exist; only 10 have a toml** — `gex-eod-snapshot` and `gex-alerts` are **orphaned** (no toml, absent from `cron-registry.ts`, invisible to the watchdog).

**Top findings:**
- **G.2 (Critical if PgBouncer absent / High DR):** Postgres pool-of-5/replica + PgBouncer is a **manual runbook** (`PGBOUNCER-SETUP.md`), not provisioned in-repo; **no backup/PITR evidence**. If PgBouncer is absent, 5 is the hard concurrent-query ceiling/replica — the most likely first systemic failure at 500.
- **C.2 (High):** adding web replicas multiplies UW WebSocket sockets and per-replica rate-limit buckets; web `numReplicas` is unset — scaling replicas without `UW_MAX_RPS=ceil(2/replicas)` + required `REDIS_URL` silently breaks the 2-RPS cluster cap.
- **F.1 (High):** alerting is a single Discord webhook with no independent dead-man's-switch; the watchdog uses the same sink it monitors.
- **B.1 (High):** the two GEX crons are deployed but never fire and have no watchdog coverage (silently dead writers).
- **D.1 (High):** `.env.local` commits a Clerk **TEST** keypair (`pk_test_`/`sk_test_`) + plaintext Polygon/UW keys — confirm prod uses `pk_live_`/`sk_live_`.

### Env-var inventory summary
Tier-0 (app degrades hard/insecurely without these): `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `REDIS_URL`, `CRON_SECRET`, `CLERK_SECRET_KEY`/`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, `POLYGON_API_KEY`/`MASSIVE_API_KEY`, `UW_API_KEY`/`UW_CLIENT_API_ID`, `WHOP_*`. Behavior-gating: `PG_POOL_MAX` (default 5), `UW_MAX_RPS` family, `SSE_MAX_STREAMS` (default 500 = exactly the launch target), `OPTIONS_WS_ENABLED`, `DISCORD_OPS_WEBHOOK_URL` (currently unset → ops noise pollutes the play channel), `SENTRY_DSN` (dormant — `@sentry/nextjs` not installed), VAPID/`web-push` (inert), `GEX_ALERTS_PUSH` (inert), **~100 `SPX_*` knobs with no validation schema** (a typo silently falls back to a default). Auto-injected: `RAILWAY_REPLICA_ID`, `PORT`, `NODE_ENV`.

### Backups / DR gaps
- **No backup/PITR evidence in repo** (G.2) — Railway-managed Postgres may snapshot but it is NOT VERIFIED; no tested restore.
- **No DR runbook, no IaC, single Railway project/region** (G.3) — RTO = "however long a human takes to rebuild 11 services + 11 config-as-code paths + ~30 env vars by hand."
- **Redis is a tier-0 SPOF** (G.1) — HA/persistence NOT VERIFIED; a single Redis failing removes the UW ceiling + AI-spend cap + Largo gate at once (fail-open cascade) while masking the outage from users.

**Verdict by tier:** 500 feasible on one well-sized replica IF PgBouncer is real + Redis healthy + `SSE_MAX_STREAMS` raised. 1,000 requires ≥2 replicas, which activates the per-replica fixes in lockstep. 5,000 needs re-architecture of the real-time tier (dedicated socket/fan-out worker, stateless web, managed HA Redis, telemetry batching). **Three infra launch blockers:** confirm PgBouncer + backups; pin `numReplicas` + document replica-coupled env; independent dead-man's-switch + ops channel + install Sentry.

---

## 6. Feature Inventory + Feature-to-Data-Source Matrix (see §15)

**15 user-facing features:** SPX Slayer (flagship desk), HELIX (flow tape), Heatmaps/GEX, Largo (AI analyst — **87 dispatchable tools**), Night Hawk (evening playbook), Night's Watch (per-user positions), 0DTE Lotto, Journal, Watchlist, Alerts (3 channels), Onboarding/Education, Pricing/Upgrade, Public Track Record, Admin, legacy Python engine proxy.

### Feature → Data-Source matrix

| Feature | Primary Data Source | API(s) | Cache (Redis) | DB (Postgres) | Refresh interval | Rate-limit risk |
|---|---|---|---|---|---|---|
| **SPX Slayer desk** | Merged SPX desk (Massive snap/indices/MA + UW tide/flow) | Polygon/Massive REST+WS, UW REST+WS, Anthropic (commentary) | `spx-desk:*`, `spx-desk-flow:*`, `spx-desk-pulse:*` (withServerCache) | `spx_open_play`, `spx_play_outcomes`, `spx_signal_log` | spx-evaluate cron ~5min; SWR pulse 1.5–3s | **Low (cache-reader); play route 502s on Massive blip — RT-2** |
| **HELIX flow tape** | UW flow-alerts (WS + cron) | UW WS multiplex, UW REST flow-alerts | flow-freshness, flow-event bridge, SSE backpressure | `flow_alerts` (high-volume) | flow-ingest cron ~2min; SSE live; REST fallback 30s | **Low per-user; SSE cap 500/instance; singleton UW socket SPOF** |
| **Heatmaps / GEX** | Massive options chain `/v3/snapshot/options` | Polygon/Massive REST, UW dark-pool overlay | `gex-overlay:{t}` 30s, `gex-eod:{t}` list | none | matrix cache; force ≤1/8s/ticker; overlay 30s | **Bounded (1 chain fetch/ticker/TTL); eod+alerts crons unregistered** |
| **Largo AI terminal** | 87 tools → UW + Polygon caches + web-search | Anthropic (sonnet-4-6) tool-loop; UW/Polygon cache-reads; Tavily/Serper/Brave | per-user daily budget (Lua), spend ledger, session lock | `largo_sessions`, `largo_messages` | on-demand per question | **Highest AI cost; bounded by per-user budget + spend-ledger gate** |
| **Night Hawk playbook** | UW (15+ endpoints) + Polygon (GEX/aggs/breadth/news) | UW REST, Polygon REST, Anthropic (sonnet-4-6) | dossier staging | `nighthawk_editions/jobs/job_log/dossiers_staging/play_outcomes` | edition cron */15 in 21–23 UTC win; outcomes 4:30pm ET | **Concentrated in evening build window, NOT user concurrency** |
| **Night's Watch positions** | `user_positions` + live marks (options WS/Massive) + GEX/flow/technicals/earnings | Polygon/Massive snapshot (cache-read), options WS, Anthropic (narrative, budget-gated) | shared chain cache (warmed) | `user_positions` | nights-watch-warm cron ~60s market hours | **Lowest-risk per-user design (N users → 1 fetch/chain/TTL)** |
| **0DTE Lotto** | Merged desk + optional Polygon candles | Polygon REST (optional) | desk cache | `lotto_plays` | spx-evaluate tick | Low (desk cache reader) |
| **Journal** | user annotations | internal | none | `user_journal` | on write | None (DB-only) |
| **Watchlist** | localStorage | none | none | none | client-local | **Zero (never leaves browser)** |
| **Personal Discord alerts (SPX)** | Clerk privateMetadata webhook | Discord webhook (outbound) | none | none | on play notify | None upstream |
| **Web-push GEX alerts** | `push_subscriptions` | web-push (ABSENT) + VAPID | (cron unregistered) | `push_subscriptions` | gex-alerts cron (UNREGISTERED) | **N/A — delivers nothing (inert)** |
| **Onboarding/Education** | static content | none | none | none | once/version | None |
| **Pricing/Upgrade** | static matrix + Whop URLs | Whop hosted checkout (redirect) | tier-cache (60s) | none (tier in Clerk) | static | None upstream |
| **Public Track Record** | `spx_play_outcomes` aggregate | `/api/public/track-record` (free) | (consider caching) | reads `spx_play_outcomes` | on request | Low (own DB; index if embed-hammered) |
| **Admin** | telemetry + cron + errors | UW/Polygon (manual run buttons) | live Redis telemetry | `api_telemetry_events`, `cron_job_runs`, `error_events`, `admin_audit_log`, `admin_incidents` | on demand | **Admin run/rescan buttons can burst upstream — rate-limit** |
| **Engine proxy (legacy)** | external Python engine | `API_BASE` (GET only) | none | none | on demand | Dormant/orphaned |

**Verified corrections to inherited audits:** (1) personal SPX alerts ride **Clerk-metadata Discord webhooks** and ARE functional (not web-push); (2) Largo now has a per-user Redis budget + cross-replica spend-ledger gate (the "alert-only, no cap" framing is outdated); (3) Night Hawk edition uses the **HTTP cron route**, not the crashy tsx worker; (4) watchlist is localStorage-only with zero scale cost; (5) recharts = **3 importers** (not 8); (6) `sharp`/`lucide-react` = 0 src importers.

**New dead-feature findings:** web-push fully inert (triple-gated off + package absent + cron unregistered); `gex-alerts` + `gex-eod-snapshot` crons unregistered (silently never fire, invisible to the watchdog); `/api/engine` Python proxy orphaned.

---

## 7. Technology Utilization Report + overall score (see §15)

Scoring rubric: features-used-vs-available (breadth) × fit/necessity × configuration health.

| Technology | Score | One-line justification |
|---|---|---|
| **Anthropic** | **88** | Largo's 87-tool agentic loop + NH generation + commentary + NW narrative; per-user budget + cross-replica spend ledger. The richest integration. |
| **Unusual Whales** | **85** | WS multiplex + 20+ REST endpoints, correctly rate-limited + cache-read; loses points on the fail-open ceiling + client-id placeholder. |
| **Postgres (pg)** | **82** | 20+ tables, 64 helpers, durable state for every feature; docked for pool-of-5 resting on unverified PgBouncer. |
| **Discord (webhooks)** | **85** | Ops + play + personal-user + AI-spend alerts; only gap is the unset ops webhook. |
| **swr** | **85** | 13 importers; the polling backbone for every desk panel. |
| **Redis (ioredis)** | **80** | Cache-reader backbone — L2 cache, rate ceilings, breaker pub/sub, telemetry, Largo budget; docked for fail-open + single-box SPOF. |
| **Polygon / Massive** | **80** | Broad surface, ~40 RPS treated as permissive; docked for no connect-level retry/breaker → hard-fails on transient blips. |
| **ws** | **80** | Genuinely required for UW auth; docked for the type cast + singleton-per-replica SPOF. |
| **Clerk** | **78** | Auth + tier store + personal-alert storage + admin gating; docked for the per-replica 60s tier cache. |
| **Next.js 14.2.35** | **75** | App Router/API/SSE/instrumentation used well; one major behind 15, relies on experimental `instrumentationHook`. |
| **Railway** | **70** | Working deploy + per-service cron tomls; docked hard for two unregistered crons + unverified replica count. |
| **framer-motion** | **70** | 48 importers, central to the visual language, but heavy bundle weight. |
| **Whop** | **62** | Necessary revenue source-of-truth, but **0.0.40 pre-release SDK in 2 files** with `as unknown as` casts + no contract test. |
| **tsx** | **60** | Runs cron/worker services, but the launch-critical NH path routes around the crashy tsx worker. |
| **recharts** | **45** | Only 3 importers — heavy lib for thin use. |
| **sharp** | **40** | 0 src importers (implicit Next/OG dep only). |
| **Web search (Tavily/Serper/Brave)** | **35** | Three SaaS providers for one job; only the first-configured is used, un-throttled. |
| **Web-push (VAPID + web-push pkg)** | **15** | Inert — package absent, cron unregistered, triple-gated off; subscriptions accumulate with no consumer. |
| **Sentry (@sentry/nextjs)** | **10** | Referenced but not installed → dormant; errors go to Postgres + console only. |
| **lucide-react** | **0** | Dead dependency — 0 importers. Remove. |
| **clsx 95 · docx 90** | — | Right-sized utility/dev deps. |

**OVERALL TECHNOLOGY UTILIZATION SCORE: 71 / 100.**

**Formula (criticality-weighted):** core stack (UW/Polygon/Anthropic/Clerk/Whop/Postgres/Redis/Railway/Next) avg ≈ **77.8** weighted 70%; support libs (ws/swr/framer/recharts/clsx/sharp/lucide) avg ≈ **59.3** weighted 20%; optional/inert (web-push/Sentry/web-search/tsx/docx) avg ≈ **42.0** weighted 10% → **0.70×77.8 + 0.20×59.3 + 0.10×42.0 = 70.6 ≈ 71**.

**Interpretation:** the core stack is utilized at ~78% (strong — the expensive technologies do real, broad work). The drag is the support tier (~59%, thin/dead libs) and the optional tier (~42%, half-built features). **Removing 3 dead deps (`lucide-react`, 2 of 3 web-search providers) + resolving the 2 inert features (web-push, Sentry) would lift utilization to ~78–80 with zero capability loss** — pure cleanup.

---

## 8. Total Cost Model @ 500 / 1k / 5k (see §16)

### Consolidated monthly table (F = FIXED plan, range NOT VERIFIED; V = VARIABLE)

| Service | Type | @ 500 | @ 1,000 | @ 5,000 | Scales w/ users? |
|---|---|---|---|---|---|
| **Anthropic — Largo** | V | ~$1,640 typ / ~$13,440 heavy | ~$3,280 / ~$26,880 | ~$16,380 / ~$134,400 | **YES (linear)** |
| **Anthropic — shared surfaces** | V-flat | ~$276 | ~$278 | ~$300 | No (NW weakly) |
| **Unusual Whales** plan | F | $375–$500 | $375–$500 | $375–$750* | No (flat-rate) |
| **Polygon / Massive** plan | F | $300–$2,000 | $300–$2,000 | $300–$2,000* | No within plan; tier-bump risk @5k |
| **Railway — web compute** | V | $40–$120 (1 rep) | $120–$360 (2–3) | $400–$1,200 (5–10+) | **YES (step/replica)** |
| **Railway — cron services** | V-flat | $0–$50 | $0–$50 | $0–$50 | No |
| **Railway — Postgres** | F+V | $50–$250 | $100–$400 | $250–$1,000 | Weak (writes) |
| **Railway — Redis** | F+V | $10–$100 | $30–$200 | $100–$500 | **YES (SSE op-rate)** |
| **Railway — egress** | V | $20–$150 | $40–$300 | $200–$1,500 | **YES (linear)** |
| **Logging / monitoring (+Sentry)** | V | $0–$80 | $26–$130 | $26–$300 | Weak (failure-driven) |
| **Object storage** | F | ~$0 | ~$0 | ~$5–$20 | No |
| **TOTAL (typical)** | — | **~$2,700–$3,900** | **~$4,700–$6,500** | **~$18,700–$23,000** | Largo dominates |
| **TOTAL (heavy Largo)** | — | **~$14,500–$16,700** | **~$28,300–$32,000** | **~$137,000–$152,000** | Largo dominates harder |

\* UW/Polygon flat-rate hold across tiers; the 5k upper bound is a *possible plan-tier bump* (a value/engineering decision), not a usage overage.

### Dominant drivers
- **Anthropic-Largo at every tier:** ~50–60% of total @500 (typ) → ~75–85% @5k. **The only cost line that scales ~linearly with users.** Cost-engineering = Largo-engineering.
- **#2 cluster @5k = the real-time tier** (Railway compute + Redis op-rate + egress, ~$1–4k/mo combined), **not the data providers.** UW + Polygon + all non-Largo AI are pinned flat by the cache-reader rule — a rounding error against Largo.
- **Widest uncertainty:** the 4 FIXED plan invoices (UW/Polygon/Postgres/Redis) — the Polygon range ($300–$2,000) alone is a $1,700/mo swing — plus the ~8–10× typical-vs-heavy Largo spread.

### Optimizations (ranked by $ impact)
1. **Arm `DAILY_AI_SPEND_KILL_USD`** — bounds the unbounded tail (caps a runaway from $4–6k/day @5k). Trivial. **Launch blocker.**
2. **Largo prompt caching** (stable name-sorted tool set + cache breakpoints) — **−$5–8k/mo @5k** (−$500–800 @500). Biggest single lever.
3. **Tighten + token-budget the per-user Largo cap** (default is **100 queries/day** — far too loose; budget by tokens not queries).
4. **GEX-explain + flow-brief → haiku** — −$142/mo flat, no quality loss. Cheapest high-value fix.
5. **SSE → one Redis pub/sub subscriber/replica** — cuts the 4 GET/s/client op-rate AND replica count.
6. **Batch + sample telemetry inserts** — caps the dominant DB write load.
7. **Cap flows `LIMIT` to 500 + CDN the identical flows/pulse GETs** — cuts the largest egress line.
8. **GEX LRU eviction + curated tickers + single-contract NW endpoint** — avoids a 5k Polygon plan-tier bump.
9. **Stream the UW tape; retire `net-prem-ticks` REST polling** — reclaims 2-RPS budget, avoids a UW tier-bump.

---

## 9. Scalability Simulation @ 500 / 1k / 5k (see §17)

Every load number is `users × cadence` arithmetic from verified file:line constants. Client polls: pulse 3s, quote 1.5s, NW 5s RTH, GEX 20s, flows/darkpool 30s; SSE send loop 250ms = **4 Redis GET/s/conn**, cap **500/instance**. Web req/s ≈ 0.8–1.3/active-user → 400–650 @500, 800–1,300 @1k, 4,000–6,500 @5k. SSE Redis GET/s = 2,000 / 4,000 / 20,000. UW cron = 23 REST tasks / 2 RPS ≈ 11.5s drain every 2 min. Web `numReplicas` unset = 1.

### @ 500 (1 replica) — breaks-first ordering
1. **SSE pulse cap (500/instance) — lands EXACTLY on the launch target, zero headroom** (Critical, S-1).
2. **Postgres pool-of-5** (advisory-lock holders cut usable to 2–3; 15s queue then 503) — Critical **if PgBouncer absent**.
3. **Redis op-rate** (2,000 GET/s) — slow Redis → fail-open cascade.
4. **SPX-play 502 storm** on any Massive connect blip (no stale-serve).
5. **Telemetry write volume** competes for the pool-of-5.
   *(UW 2-RPS cap HOLDS at 1 replica — local bucket == cluster cap.)*
   **Mitigations:** confirm PgBouncer + backups; raise `SSE_MAX_STREAMS` or add a 2nd replica; SPX-play stale-serve; arm the kill-switch; set ops webhook + external uptime monitor + install Sentry. No re-architecture.

### @ 1,000 (≥2 replicas) — breaks-first ordering
1. **UW 2-RPS cluster cap silently doubles** — replicas>1 + any Redis blip → each replica paces at its own 2 RPS, global ceiling fails open → **2×N RPS** to UW → 429 storm → breaker → platform-wide stale desk (Critical, S-3).
2. **Per-replica UW WebSockets multiply** — N sockets, N× flow-persist (S-4).
3. **SSE cap/instance** — needs ≥2 replicas just for headroom.
4. **Redis is the cluster bottleneck** (4,000 GET/s) — slowdown triggers the fail-open cascade for ALL replicas at once.
5. **Postgres pool = 5×N** — PgBouncer `default_pool_size` becomes the real ceiling.
   **Mitigations (in lockstep with adding replicas):** `UW_MAX_RPS=ceil(2/replicas)` + `REDIS_URL` required (fail-closed); decouple WS ingestion to one owner; SSE pub/sub fan-out; gate non-Largo `anthropicText` on the kill-switch; Redis HA + PgBouncer sized; readiness-gated rolling deploys; Polygon LRU + curated tickers + global force throttle.

### @ 5,000 (~10 replicas) — breaks-first ordering
1. **UW 2-RPS is physically impossible to share across ~10 replicas via REST polling** — `ceil(2/10)` floors to 1 RPS local, so a Redis blip → ~10 RPS = 5× cap → permanent breaker (Critical).
2. **~10 UW multiplex sockets** — likely exceeds the account WS allowance (Critical, S-4).
3. **Redis SSE op-rate = 20,000 GET/s** — a single Redis can't serve it; pub/sub fan-out becomes mandatory (Critical, S-2).
4. **Polygon chain ceiling breached by background work alone** — NW warm with WS off = 300 distinct combos × ~3 pages/60s = ~900 calls/burst = 22.5s solid chain traffic/min; >200 distinct GEX tickers → `clear()` storms (HIGH-1/HIGH-3).
5. **Massive connect-blip → cluster-wide 10s-timeout pile-up** (connect errors don't feed the breaker).
6. **Anthropic heavy-curve ~$135k/mo** (financial, not stability).
   **Mitigations (re-architecture of the real-time tier):** dedicated upstream-ingest worker (or UW Kafka) → Redis pub/sub, web replicas pure stateless cache-readers; stream the UW tape; SSE pub/sub fan-out + managed HA Redis; Polygon single-contract NW marks + connect-breaker + stale-serve + chain micro-cache; PgBouncer + telemetry batching/sampling; external APM + multi-channel alerting + DR runbook/IaC.

**Verdict:** the cache-reader rule makes **500 feasible on one replica**; **1,000 needs the per-replica fixes applied in lockstep** with adding replicas (naive scaling silently breaks the UW cap); **5,000 needs real-time-tier re-architecture.** The financial backstop (`DAILY_AI_SPEND_KILL_USD`) and the observability gap (single Discord webhook, no Sentry, no external dead-man's-switch) are launch blockers at **every** tier — their blast radius scales with the user base.

**9 NOT-VERIFIED gates:** replica count, PgBouncer/`max_connections`, Redis plan/HA, `OPTIONS_WS_ENABLED`, UW WS allowance + Kafka, Massive RPS ceiling, kill-switch armed, Clerk plan/live keys, container vCPU/RAM.

---

## 10. FULL NAMED SCORECARD

Each score 0–100 + letter, derived from the core report's sub-scores (S section; overall **68/100**) and these extension findings. Justification states what holds and what caps it.

| Dimension | Score | Grade | Justification |
|---|---|---|---|
| **Launch Readiness** | **60** | **D-** | Multiple hard launch blockers, none yet fixed: SSE cap == the 500 target with zero headroom (S-1); SPX-play flagship hard-502s with no stale-serve (RT-2); PgBouncer + Postgres backups unverified (G.2); `DAILY_AI_SPEND_KILL_USD` likely unarmed (C-6); `.env.local` test Clerk keys must be confirmed live (D.1); 3 shipped-but-dead GEX/push surfaces; no free preview; Whop 0.0.40 SDK with no contract test. The architecture is sound but the pre-launch checklist is long and unverified. |
| **Security** | **70** | **C-** | Strong network posture — private-VPC-first Postgres, scoped image hosts, HSTS preload + real CSP + frame-ancestors. But: committed `sk_test_`/`pk_test_` + plaintext Polygon/UW keys in `.env.local` (D.1); fail-open rate limiters mean a Redis blip silently removes the UW ceiling + AI-spend cap (a financial-DoS surface); `/api/engine` forwards a Bearer secret to a possibly-dead `API_BASE`; admin "Run now" buttons are unthrottled upstream-bursting endpoints. No P0 RCE-class issue, but secret hygiene + fail-open economics need closing. |
| **Scalability** | **66** | **D+** | The cache-reader rule is genuinely followed on the hot paths — verified across quote/GEX/desk/NW/flows — which makes 500 feasible on one replica and pins UW/Polygon/non-Largo-AI flat across all tiers. But 1,000+ depends on per-replica fixes that don't exist yet (UW 2×N on multi-replica, N UW sockets, SSE per-connection GET op-rate of 20k/s @5k, pool-of-5×N), and 5,000 needs real-time-tier re-architecture. Excellent foundations, unfinished horizontal story. |
| **Product** | **72** | **C** | Feature-rich and differentiated — 15 features, Largo's 87-tool agentic loop is the richest surface, Night's Watch is a textbook cache-reader per-user design, public track record is anti-divergent with the premium desk. Capped by shipped-but-dead surfaces (web-push inert, 2 GEX crons unregistered, Heatmap under-delivers vs marketing, engine proxy orphaned) and no free preview gating the funnel at the sales page. |
| **Architecture** | **76** | **B-** | The strongest dimension. Single-flight `withServerCache` + shared GEX matrix + WS-fed stores + per-user budget/spend-ledger + circuit breakers + cron staleness watchdog are well-designed and verified. Docked for the single-process-does-everything model (web + all WS + all SSE + all Largo loops + all cron work on one event loop) being the structural ceiling, the per-process socket singleton multiplying with replicas, and three fail-open invariants resting on one Redis. |
| **Infrastructure** | **62** | **D+** | Working but fragile and under-verified. Clean cron-trigger isolation (echo build, never-restart) and graceful SIGTERM WS release are real strengths. But: PgBouncer is a manual runbook with no backup/PITR evidence (Critical if absent), web `numReplicas` unpinned, Redis HA unconfirmed (tier-0 SPOF), alerting is a single Discord webhook with no independent dead-man's-switch, Sentry referenced but not installed, 2 orphaned crons, ~100 unvalidated `SPX_*` env knobs, no DR runbook/IaC. 10+ load-bearing facts NOT VERIFIED. |
| **User Experience** | **68** | **D+** | Coherent "Living Terminal" visual language, sensible SWR cadences, onboarding tour + glossary. Capped by money-path defects (Night's Watch close uses `window.prompt`), onboarding content drift (teaches removed Hunt Modes, never introduces Night's Watch), alerts that only fire tab-open, a Heatmap that renders GEX-only despite broader marketing, and the inherited tools-tier UI debt from the core report (no `src/components/ui`, grey-on-near-black contrast). |
| **OVERALL BLACKOUT GRADE** | **67** | **D+** | Sound, differentiated architecture (cache-reader rule, deep integrations, ~78% core-tech utilization) undercut by an unfinished launch checklist, fail-open infra invariants resting on one unverified Redis, an unbounded AI-cost tail with the only backstop likely unarmed, and several shipped-but-dead surfaces. Consistent with the core report's 68/100 — the extension findings (cost tail, infra DR gaps, scale breakpoints) hold the grade just below the launch line rather than moving it materially. Close the Top-25 list and this rises to low-B territory. |

---

## 11. Top 25 Pre-Launch Fixes (ranked, deduped, cross-referencing the core R priority list)

Ranked by launch-blocking severity × blast radius. Each cites its section finding(s); core-report cross-refs noted as "core R".

| # | Fix | Finding(s) | Tier unblocked |
|---|---|---|---|
| 1 | **Arm `DAILY_AI_SPEND_KILL_USD` in prod** + confirm the cross-replica ledger writes — the only hard cap on a financially-unbounded Largo tail | 13 C-6, 16 L-1 (core R) | all |
| 2 | **SPX-play stale-serve** on Massive blip (last-good + `degraded:true`, 200 not 502) — flagship single point of failure | 12 RT-2, 15 F-blocker (core R) | all |
| 3 | **Confirm PgBouncer (transaction mode) + Postgres backups/PITR**; run a restore drill; log the active DB target at boot | 14 G.2, 17 PG (core R) | 500+ |
| 4 | **Raise `SSE_MAX_STREAMS` above 500** (or add a 2nd replica) — the default cap == the launch target with zero headroom; load-test SSE fan-out | 17 S-1, 14 §I | 500+ |
| 5 | **Confirm prod Clerk keys are `pk_live_`/`sk_live_`** (not the `sk_test_` in `.env.local`); rotate the plaintext Polygon/UW keys | 14 D.1, 17 §J | 500 |
| 6 | **Pin web `numReplicas`** in `railway.toml`; document that >1 requires `UW_MAX_RPS=ceil(2/replicas)` + `REDIS_URL` required (fail-closed) | 14 C.2, 17 S-3 | 1,000+ |
| 7 | **Set `DISCORD_OPS_WEBHOOK_URL` + add an external uptime monitor** on `/api/ready` (independent dead-man's-switch) | 14 F.1 | 500+ |
| 8 | **Install `@sentry/nextjs` + set `SENTRY_DSN`** — the integration is wired but dormant; no external error aggregation today | 14 F.2, 15 | 500+ |
| 9 | **Confirm Redis plan + HA/persistence**; treat as tier-0 SPOF; add a "Redis degraded" alert | 14 G.1, 17 S-2 | 1,000+ |
| 10 | **SSE → one Redis pub/sub subscriber per replica** — collapses 4 GET/s/client (20k GET/s @5k) and caps Redis + compute cost | 17 S-2, 16 L-5 (core R) | 1,000+ |
| 11 | **Largo prompt caching** — send the stable name-sorted tool set + cache breakpoints on last-tool + prior-turn | 13 C-1, 17 S-7, 16 L-2 | all (cost) |
| 12 | **Decouple WS ingestion to ONE owner** (ingest worker → Redis pub/sub; or UW Kafka) so N replicas don't open N UW sockets | 14 C.1, 17 S-4, 11 §7 | 1,000+ |
| 13 | **Fix `spx-power-hour-engine.ts`** — use `POLYGON_API_BASE` + dotted filter params; it almost certainly always serves the synthetic fallback | 12 HIGH-4 | all (correctness) |
| 14 | **GEX heatmap LRU eviction** (not `clear()`) + **curated ticker allow-list** + **global force throttle** | 12 HIGH-3, 17 §F | 1,000+ |
| 15 | **Route `fetchSpyGapPct` through `polygonTrackedFetch`** — it bypasses both the limiter and the breaker today | 12 HIGH-2 | 500+ |
| 16 | **Register the 2 orphaned GEX crons** (`gex-eod-snapshot`, `gex-alerts`) in toml + `cron-registry.ts`, or delete them — silently dead writers, invisible to the watchdog | 14 B.1, 15 F-2/F-3 | 500 |
| 17 | **Resolve web-push** — install + wire + verify end-to-end, OR hide the subscribe UI and re-scope the alert copy; it delivers nothing today | 15 F-1 | 500 |
| 18 | **Connect-level breaker + retry/backoff for Polygon** — connect failures don't feed the breaker; each pays the full 10s timeout (scale-up of RT-2) | 12 MED-2 | 1,000+ |
| 19 | **Tighten + token-budget the per-user Largo cap** (default 100 queries/day is far too loose; budget by tokens, not queries) | 13 C-7, 16 L-3 | all (cost) |
| 20 | **Gate non-Largo `anthropicText` callers on the kill-switch ceiling** — they write the ledger but never read it, so they spend after the switch trips | 13 C-6, 17 S-5 | 1,000+ |
| 21 | **Move GEX-explain + flow-brief to haiku** — −$142/mo flat, no quality loss | 13 C-2, 16 L-4 | all (cost) |
| 22 | **Wire `/api/ready` to the healthcheck + warm schema/pool/sockets on boot** — every rolling deploy ships a cold replica today | 14 E.1 | 1,000+ |
| 23 | **Batch + sample telemetry inserts** — one INSERT/upstream-call competes with user reads for the pool-of-5 | 17 S-8, 09 F.2 | 500+ |
| 24 | **Cap `fetchRecentFlows` LIMIT to 500 + CDN/edge-cache the identical flows/pulse GETs** — largest user-correlated egress line; UI slices to 500 anyway | 17 §F, 16 L-7 | 1,000+ |
| 25 | **Ship a throttled free preview** served entirely from existing caches/Postgres + add a **Whop signed-fixture contract test** — funnel is gated at the sales page; revenue runs through a 0.0.40 pre-release SDK | 15 F-8, F-blocker | 500 (growth/revenue) |

**Confirm-and-delete (cheap utilization wins, not strict blockers):** remove `lucide-react` (0 importers) + 2 of 3 web-search providers; confirm `sharp`/`recharts`; confirm `/api/engine` is dead and delete it — lifts technology utilization from 71 to ~78–80 with zero capability loss.

---

*All cost/infra facts marked NOT VERIFIED require the stated evidence (UW/Massive invoices, Railway dashboard replica count + PgBouncer mode + Postgres `max_connections` + backups, Redis plan/HA, container vCPU/RAM, prod Clerk keys, `OPTIONS_WS_ENABLED`, `DAILY_AI_SPEND_KILL_USD` armed, UW WS allowance + Kafka entitlement). The model's shape and ratios are reliable; absolute totals move with the real invoices and the real Largo turn distribution. No code modified; no git commit.*
