# 15 — Feature Inventory & Technology Utilization (Deliverable: Features Matrix)

**Scope:** Two deliverables. **(1)** A complete inventory of every user-facing feature in `blackout-web` — purpose, user workflow, data sources, APIs, Redis/DB/third-party usage, refresh interval, rate-limit exposure, scalability concern — rendered as a **Feature → Data-Source matrix**. **(2)** A **Technology Utilization Score** (0–100) for each technology (UW, Polygon/Massive, Anthropic, Clerk, Whop, Postgres, Redis, Railway, plus every discovered runtime SDK/dep), with a one-line justification and an overall score.

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Mode:** READ-ONLY. Every claim grounded in `file:line`. Prod/plan/invoice-only facts flagged **"NOT VERIFIED — needs X."** Builds on `07-TOOLS-INTEGRATIONS.md`, `10-PRODUCT-UX.md`, `05-CRON-JOBS.md`, `00-RUNTIME-FINDINGS.md` — but every inherited claim was re-checked against code; corrections are noted inline.

**Headline:** The product is **feature-rich and the integrations are deep** — Largo alone wires **87 dispatchable AI tools** across UW + Polygon. The scaling architecture is sound: **per-user features are cache-readers** (Redis-warmed by crons + WS), so the hard 2 rps UW ceiling survives concurrency. The gaps are not capability — they are **shipped-but-dead surfaces** (web-push delivery inert; `gex-alerts` + `gex-eod-snapshot` crons never registered; `/api/engine` Python proxy orphaned) and **paying-for-unused / under-utilized** technology (Recharts ~3 importers, `lucide-react` 0 importers, `sharp` 0 src importers, three web-search providers for one job, Whop SDK 0.0.x touched in only 2 files). **Overall Technology Utilization Score: 71/100.**

---

## A. COMPLETE FEATURE INVENTORY

Each feature: purpose · workflow · data sources · APIs · Redis · DB · third-party · refresh · rate-limit exposure · scalability concern.

### A.1 — SPX Slayer (flagship desk) · `/dashboard`
- **Purpose:** Live SPX intraday decision desk — graded play card (action/score/confidence, entry/stop/target, 11-point confirmations, weighted confluence), GEX ladder, unified tape, AI commentary, track-record panel, 0DTE lotto dock.
- **Workflow:** Premium user opens `/dashboard` (`requireTier("premium")`); SWR polls `/api/market/spx/play`, `/spx/desk`, `/spx/merged`, `/spx/commentary`, `/spx/pulse/stream` (SSE).
- **Data sources:** `loadMergedSpxDesk()` (`spx-desk-loader.ts:20`) merges `spx-desk:{date}`, `spx-desk-flow:{date}`, `spx-desk-pulse:{date}` via `withServerCache`. Upstream: Polygon/Massive (snapshots, indices, EMA/SMA, aggs) + UW (tide, flow, GEX exclusives). Play built by `readSpxPlaySnapshot` (`spx-evaluator.ts`).
- **APIs:** Polygon/Massive REST + WS indices; UW REST (cache-read) + WS multiplex. AI commentary via Anthropic (`spx-play-claude.ts:306` `anthropicText`, default `claude-sonnet-4-6`).
- **Redis:** `withServerCache` L2 (desk/flow/pulse keys); play snapshot cached. **DB:** `spx_open_play`, `spx_play_outcomes`, `spx_signal_log`, `user_journal` (per-play notes).
- **Refresh:** spx-evaluate cron ~every 5 min (7AM–4PM ET, `cron-registry.ts:32`); client SWR pulse 1.5–3s; play route `no-store`.
- **Rate-limit exposure:** Low per-user (cache-reader). The evaluate cron is the only writer hitting UW/Polygon.
- **Scalability concern:** **RT-2 (`00-RUNTIME-FINDINGS.md`): the play route hard-502s on a Massive connect blip with no stale-serve** (`spx/play/route.ts:35-39`). At 500/1k/5k users a 30s Massive blip = a simultaneous wall of 502s on the flagship. **Highest-priority feature-level reliability gap.**

### A.2 — HELIX (options-flow tape) · `/flows`
- **Purpose:** Real-time institutional options-flow tape + velocity radar, split-flow, coordinated dark-pool, sector rotation, Night Hawk cross-ref, net-premium leaderboard, strike-stack detector, replay, CSV export, audio alerts.
- **Workflow:** SSE stream `/api/market/flows/stream` + 30s REST fallback (`FLOW_POLL_MS = 30_000`, `FlowFeed.tsx`).
- **Data sources:** UW flow-alerts (WS multiplex + `flow-ingest` cron) → `flow_alerts` Postgres → live fan-out (`flow-persist.ts`, `flow-events.ts`, `flow-fanout.ts`).
- **APIs:** UW WS + UW REST flow-alerts (cron-driven). **Redis:** flow-data-freshness keys, flow-event bridge, SSE backpressure. **DB:** `flow_alerts` (high-volume; pruned by db-cleanup).
- **Refresh:** `flow-ingest` cron ~every 2 min market hours (`cron-registry.ts:18`); SSE push live; client REST fallback 30s.
- **Rate-limit exposure:** Low per-user — one cron writer + one WS feed; users read the SSE bridge + Postgres.
- **Scalability concern:** **SSE per-instance cap `MAX_STREAMS = 500`** (`flows/stream/route.ts:13`) → at 1k–5k concurrent the cap is hit and returns 503 unless horizontally scaled; each replica also holds **one singleton UW socket** (`07` I-6) — a per-replica SPOF and freshness-skew source.

### A.3 — Heatmaps / GEX · `/heatmap`
- **Purpose:** Dealer-positioning gamma map for SPY (GEX/VEX/DEX/CHARM, walls, flip, regime read, per-strike matrix). **NOTE:** marketed as sector/internals/tide but renders **GEX only** (`10` Q-2; `Heatmap.tsx:6-12`).
- **Workflow:** `/api/market/gex-heatmap` (+ `/explain`, `/gex-positioning`).
- **Data sources:** `fetchGexHeatmap` (`polygon-options-gex.ts`) — Massive `/v3/snapshot/options/{underlying}` chain (primary), matrix computed once + shared; dark-pool overlay via `fetchUwDarkPool` (UW, `uwCacheGet` 2-min TTL).
- **APIs:** Polygon/Massive options chain (~40 rps shared with desk/Night Hawk/Largo); UW dark-pool overlay. **Redis:** `gex-overlay:{ticker}` 30s TTL; `gex-eod:{ticker}` close-snapshot list. **DB:** none direct (Redis-only).
- **Refresh:** in-memory + Redis matrix cache; client force-refresh **server-throttled to ≤1/8s per ticker** (`FORCE_THROTTLE_MS = 8_000`, `gex-heatmap/route.ts:33`); overlay 30s TTL.
- **Rate-limit exposure:** Bounded — one upstream chain fetch per ticker per TTL regardless of user count (the cache-reader rule applied well here).
- **Scalability concern:** **`gex-eod-snapshot` cron is unregistered** (see F-3) → the "vs prior close" `history_context` never populates in prod; **`gex-alerts` web-push cron is unregistered + triple-gated off** (see F-2).

### A.4 — Largo (AI desk analyst) · `/terminal`
- **Purpose:** Full-viewport AI chat grounded in live tool data; streaming; session persistence; tool-used chips.
- **Workflow:** `/api/market/largo/query` (`requireTier("premium")`) → `anthropicToolLoop` (`largo-terminal.ts`) → `runTool` dispatch (`largo/run-tool.ts`). Sessions via `/largo/session`.
- **Data sources:** **87 dispatchable tools** (`grep -cE 'case "..."' run-tool.ts` = 87) spanning quotes, technicals, OI/greeks/max-pain/chains, flow/NOPE/dark-pool/unusual-trades, IV/vol-regime/skew, market breadth/sector-flow/movers/economic-calendar/ETF-flow, company profile/financials/earnings/analyst-ratings/news, **and `get_my_positions`** (cross-tool → Postgres `user_positions`). All read shared caches.
- **APIs:** Anthropic (`LARGO_MODEL = claude-sonnet-4-6`, `anthropic.ts:123`) tool-loop; tools fan out to UW + Polygon cache-readers + `web-search.ts` (Tavily→Serper→Brave) on catalyst miss.
- **Redis:** **per-user daily query budget** (`largoBudgetKey`, Lua incr, TTL to ET midnight — `largo/query/route.ts:98-111`) + **cross-replica spend ledger read** to reject when over cap (`:119`) + session lock. **DB:** `largo_sessions`, `largo_messages`.
- **Refresh:** on-demand per question (interactive).
- **Rate-limit exposure:** **Highest AI-cost surface.** Bounded by per-user daily budget + `anthropicToolLoop` maxRounds×maxTokens; **correction to `07` I-9 / `13`:** the per-user Redis budget AND a cross-replica spend ledger gate now exist (`largo-budget.ts`, `ai-spend-ledger.ts`) — the "alert-only, no cap" claim is **partly outdated**; a per-user cap and a cluster spend-ledger gate are present, though a hard global kill-switch degradation path is still worth confirming.
- **Scalability concern:** Anthropic cost scales with premium concurrency; tool fan-out can pressure the shared 40 rps Polygon + 2 rps UW caches during a news-heavy multi-round session. Largo cleanup cron purges stale sessions weekly.

### A.5 — Night Hawk (evening playbook + dossier + track record) · `/nighthawk`
- **Purpose:** Post-close ranked 5-slot evening playbook with market recap + per-ticker dossier modal; outcome tracking → public track record.
- **Workflow:** Edition built by the evening pipeline; user reads `/api/market/nighthawk/edition`, `/play-explain`, `/hunt`.
- **Data sources:** `nighthawk/data-sources.ts` — **UW** (market-tide, flow-alerts, sector-tide, ETF tide, news headlines, top-net-impact, earnings premarket/afterhours, predictions/insiders, total-options-volume, correlations, oi-change, dark-pool, spot-exposures, max-pain, volatility stats) **+ Polygon** (options snapshot GEX/max-pain primary, SPX/VIX aggs, sector-performance, grouped breadth, news). Plays generated by **Anthropic** (`claude-edition.ts:127` `anthropicText`, default `claude-sonnet-4-6`).
- **APIs:** UW REST + Polygon REST (batched in the evening cron, off the hot path) + Anthropic. **Redis:** dossier staging cache. **DB:** `nighthawk_editions`, `nighthawk_dossiers_staging`, `nighthawk_jobs`, `nighthawk_job_log`, `nighthawk_play_outcomes`.
- **Refresh:** **`nighthawk-edition` cron** runs `node scripts/hit-cron.mjs /api/cron/nighthawk-edition` every 15 min in the **5:30–7:55 PM ET window** (`railway.nighthawk-playbook.toml`, `cronSchedule = "*/15 21-23 * * 1-5"`), checkpoint-resumable; outcomes resolved 4:30 PM ET (`nighthawk-outcomes`).
- **Rate-limit exposure:** Concentrated UW/Polygon load in the evening build window, **not** during user concurrency — by design. **Correction to my own first hunch:** the registry's `nighthawk-playbook` worker key maps to the **HTTP `/api/cron/nighthawk-edition` route**, not the crashy `tsx` worker (the toml comment documents the `server-only` resolution failure). So this path is wired — `07` I-11's tsx-worker risk does **not** bite the edition build (it deliberately uses the HTTP route).
- **Scalability concern:** Read side is fully cache/DB-backed → flat with user count. Build side is a single evening job; staleness covered by `cron-staleness-watchdog`.

### A.6 — Night's Watch (per-user positions manager) · right column of `/nighthawk`
- **Purpose:** Per-user options position tracker — live P&L + greeks, deterministic HOLD/TRIM/SELL/WATCH verdict, portfolio summary, cross-tool detail modal with verified-data provenance ledger.
- **Workflow:** `/api/account/positions` (CRUD), `/positions/[id]/detail` (enriched). Close-position uses `window.prompt` (`10` P-1 — money-path UX defect).
- **Data sources:** `user_positions` (Postgres) + live option marks (options WS / Massive snapshot) + GEX walls + flow + technicals + earnings fed into `verdict.ts` (`nights-watch/`). Narrative via Anthropic (budget-gated, `narrative-budget.ts`).
- **APIs:** Polygon/Massive option-chain snapshot (cache-read via `chain-cache.ts withServerCache`); options WS for live marks. **Redis:** shared option-chain cache (`gex`/chain keys) warmed by `nights-watch-warm`. **DB:** `user_positions`.
- **Refresh:** **`nights-watch-warm` cron ~every 60s market hours** (`cron-registry.ts:81`) pre-warms the shared chain cache for **all distinct open positions** so user GETs are pure cache hits.
- **Rate-limit exposure:** **Lowest-risk per-user design in the app** — the warm cron collapses N users holding the same (underlying, expiry) to ONE upstream fetch per TTL. This is the canonical cache-reader pattern.
- **Scalability concern:** **RT-1 (`00`): options-socket stall→reconnect storm** dropped live marks ~10–20s every ~14 min (FIXED, commit a9eb3dc). At 5k users with many distinct chains, the warm cron's per-chain fan-out grows — confirm the distinct-chain count scales sub-linearly. **NOT VERIFIED — needs prod distinct-open-chain count.**

### A.7 — 0DTE Lotto dock · within `/dashboard`
- **Purpose:** End-of-day 0DTE directional lotto plays + power-hour engine.
- **Data sources:** `spx-lotto-engine.ts`, `spx-power-hour-engine.ts` — reads merged desk (`desk.flow_0dte_net`) + Polygon candles (optional quality boost, not a hard gate, `:346`). **DB:** `lotto_plays`. **Refresh:** spx-evaluate cron tick. **Rate-limit exposure:** Low (reads desk cache). **Scalability:** flat with users.

### A.8 — Journal · per-play notes (in desk)
- **Purpose:** Per-user annotation on plays. **Workflow:** `/api/market/spx/journal`. **Storage:** **Postgres `user_journal`** (isolated, annotation-only — `journal/journal-store.ts`). **Redis:** none. **Refresh:** on write. **Rate-limit exposure:** none (DB only). **Scalability:** trivial; one row per user/play.

### A.9 — Watchlist · client-side
- **Purpose:** Per-user ticker watchlist. **Storage:** **`localStorage` only** (`STORAGE_KEY = "blackout:watchlist:v1"`, MAX 50, pure logic in `watchlist-store.ts` — no React, no window, no server, no DB). **Redis/DB:** none. **Rate-limit exposure:** **zero — never leaves the browser.** **Scalability:** infinite (client-local). **Note:** not cross-device (a UX limitation, not a scale risk).

### A.10 — Alerts (three distinct, partially-inert channels)
- **(a) In-app audio/visual:** whale beep (`FlowFeed.tsx`) + play beep (`SpxTradeAlerts.tsx`) — **tab-open only** (`10` P-8).
- **(b) Personal Discord alerts (SPX play):** **WORKING.** Stored as a personal webhook in **Clerk `privateMetadata`** (`personal-alert-store.ts:18`), fanned out fire-and-forget via `postDiscordWebhook` (`personal-alert-fanout.ts:52`), triggered by `spx-play-notify.ts`. **Correction to `07`'s implication that user-personal alerts ride web-push:** SPX personal alerts are a fully-functional **Discord-webhook** path, independent of web-push. **Redis/DB:** none (Clerk metadata). **Rate-limit exposure:** none on our upstreams (Discord free).
- **(c) Web-push (GEX regime):** **INERT.** `gex-alerts` cron calls `sendWebPush` (`gex-alerts/route.ts:30`) but is **triple-gated:** `GEX_ALERTS_PUSH=1/true` AND `vapidConfigured()` AND the `web-push` package installed — and the package is **NOT installed** (`07` I-8) **and the cron is unregistered** (F-2). **DB:** `push_subscriptions` (subscriptions accumulate with no consumer). **Net: web-push delivers nothing.**

### A.11 — Onboarding / Education · global
- **Purpose:** 7-step tour + 8-term Options 101 glossary, auto-opens once per version. **Storage:** localStorage (seen-version). **Data sources:** static `onboarding-content.ts`. **Rate-limit/DB/Redis:** none. **Scalability:** static. **Note:** content drifted — teaches removed "Hunt Modes," never introduces Night's Watch (`10` Q-1); glossary undersized vs desk jargon (`10` P-7).

### A.12 — Pricing / Upgrade · `/upgrade`
- **Purpose:** Free-vs-premium matrix + 3 Whop checkout options (monthly/yearly/lifetime). **Workflow:** `WHOP_CHECKOUT.{monthly,yearly,lifetime}` are **hosted Whop checkout URLs** from `NEXT_PUBLIC_WHOP_CHECKOUT_*` env (`whop-checkout.ts:23-27`) — a redirect, **not** a `window.prompt` (the `window.prompt` is only Night's Watch close, A.6). **Data:** static `upsell-features.ts FEATURE_MATRIX`. **Tier source:** Clerk `publicMetadata.tier` written by Whop webhook. **Scalability:** static page; conversion gap is the absence of any free preview (`10` P-2). **Note:** product sigils silently never render (`10` Q-3).

### A.13 — Public Track Record · `/track-record` + `/embed/track-record`
- **Purpose:** Aggregate win-rate / W-L-BE / cold-buy + watch-promote paths; embeddable iframe. **Data:** `track-record-public.ts` — **same aggregation as the premium desk** (anti-divergence). **DB:** reads `spx_play_outcomes`. **APIs:** `/api/public/track-record` (free). **Rate-limit exposure:** none upstream (reads own DB). **Scalability:** Postgres aggregate — add an index / cache if the embed is hammered. **NOT VERIFIED — needs prod embed traffic.**

### A.14 — Admin surface · `/admin` + `/api/admin/*`
- **Purpose:** API-SLA dashboard, cron-health, error log, incidents, audit log, SPX analytics, Night Hawk analytics/run, options-socket inspector, membership tooling. **Data:** `api_telemetry_events`, `cron_job_runs`, `error_events`, `admin_audit_log`, `admin_incidents` + live Redis telemetry. **Access:** `admin-access.ts`. **Scalability:** admin-only (tiny user count) — but the admin "Run now" buttons (Night Hawk run, rescan) are the **only manual upstream-bursting endpoints** outside crons; rate-limit them. **NOT VERIFIED — needs admin-user count.**

### A.15 — Legacy Python engine proxy · `/api/engine/[...path]`
- **Purpose:** GET-only proxy to an external Python engine (`API_BASE` + `DASHBOARD_API_SECRET`, `engine.ts:12-13`). **Status:** **near-orphaned** — referenced only by `engine/health` + a docs page; POST proxying intentionally disabled; the platform has moved to TS engines. **Scalability:** dormant. **Recommend:** confirm whether `API_BASE` is still set in prod; if not, delete the proxy + `engineConfigured` dead path. **NOT VERIFIED — needs prod env (`API_BASE`).**

---

## B. FEATURE → DATA-SOURCE MATRIX

| Feature | Primary Data Source | API(s) | Cache (Redis) | DB (Postgres) | Refresh interval | Rate-limit risk |
|---|---|---|---|---|---|---|
| **SPX Slayer desk** | Merged SPX desk (Massive snap/indices/MA + UW tide/flow) | Polygon/Massive REST+WS, UW REST+WS, Anthropic (commentary) | `spx-desk:*`, `spx-desk-flow:*`, `spx-desk-pulse:*` (withServerCache) | `spx_open_play`, `spx_play_outcomes`, `spx_signal_log` | spx-evaluate cron ~5min; SWR pulse 1.5–3s | **Low (cache-reader); but play route 502s on Massive blip — RT-2** |
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

**Postgres tables (verified from `db.ts` CREATE TABLE):** `admin_audit_log`, `admin_incidents`, `api_telemetry_events`, `cron_job_runs`, `error_events`, `flow_alerts`, `largo_messages`, `largo_sessions`, `lotto_plays`, `nighthawk_dossiers_staging`, `nighthawk_editions`, `nighthawk_job_log`, `nighthawk_jobs`, `nighthawk_play_outcomes`, `platform_meta`, `spx_open_play`, `spx_play_outcomes`, `spx_signal_log`, `user_journal`, `user_positions`, `push_subscriptions` (referenced). **64 exported helper functions in `db.ts`.**

---

## C. TECHNOLOGY UTILIZATION SCORE (0–100)

Scoring rubric: **features-used-vs-available** (breadth of the API/SDK surface exercised) × **fit/necessity** × **configuration health** (misconfig, paying-for-unused, dead code). 100 = fully and correctly utilized; <50 = significant waste or misconfiguration.

| Technology | Score | One-line justification |
|---|---|---|
| **Unusual Whales (UW)** | **85** | Deeply utilized — WS multiplex + 20+ REST endpoints across flow, tide, dark-pool, GEX, NOPE, max-pain, earnings, predictions, correlations; correctly rate-limited (2 rps Redis ceiling) and cache-read. Loses points only for the Redis-fail-open ceiling gap (`07` I-1) and `UW_CLIENT_API_ID` placeholder (`07` I-14). |
| **Polygon / Massive** | **80** | Broad surface used (snapshots, options chains/GEX, indices, EMA/SMA, aggs, grouped breadth, sector-performance, Benzinga news/earnings, WS indices + options marks). ~40 rps treated as permissive. Docked for **no connect-level retry/breaker** → RT-2/RT-5 hard-fails on transient blips (the single biggest reliability waste of an otherwise-rich integration). |
| **Anthropic** | **88** | Excellent breadth — Largo's **87-tool agentic loop**, Night Hawk play generation, SPX commentary, Night's Watch narrative; per-user Redis budget + cross-replica spend ledger + cost-table. Models pinned in code (`sonnet-4-6`/`haiku-4-5`); only gap is no env-override on `LARGO_MODEL`/`COMMENTARY_MODEL` + no hard global kill-switch degradation (`07` I-9/I-10). The most sophisticated integration in the codebase. |
| **Clerk** | **78** | Used for auth + tier store + **personal-alert webhook storage (privateMetadata)** + admin gating — more than just login. Docked for the per-replica 60s tier cache (Clerk 502 risk at scale, `07` I-4; not yet moved to Redis) and tier resolution on the hot path. |
| **Whop** | **62** | Necessary (revenue source of truth: webhook verify + membership→tier + reconcile cron + 3 hosted checkout URLs) but **0.0.40 pre-release SDK touched in only 2 files** (`whop.ts`, `membership.ts`) with `as unknown as` casts and no contract test (`07` I-3). Functionally correct, structurally fragile — the lowest-confidence revenue dependency. |
| **Postgres (pg)** | **82** | Heavily and correctly used — 20+ tables, 64 helpers, durable state for every feature, append-only outcomes, telemetry, pruning crons. Docked for `max=5`/replica pool whose safety depends on **unverified PgBouncer** (`07` I-2) and no pool-saturation metric. |
| **Redis (ioredis)** | **80** | Exemplary cache-reader backbone — L2 cache, global rate ceilings, breaker pub/sub, cross-replica telemetry + Largo budget + spend ledger, warm-cron targets. The architecture's keystone. Docked because **every limiter fails OPEN when Redis blips** (`07` I-1) and it's a single-box SPOF (no HA confirmed). |
| **Railway** | **70** | Deploy + per-service cron tomls (Bearer `CRON_SECRET`) + worker services — a working pattern. Docked hard for **two unregistered crons** (`gex-alerts`, `gex-eod-snapshot` — no toml, not in registry → silently never fire, F-2/F-3) and replica-count being unverified (drives the UW-ceiling and pg-pool math). |
| **Next.js 14.2.35** | **75** | App Router, API routes, SSE, instrumentation hook all used well. Docked: one major behind 15, error-handling relies on **experimental** `instrumentationHook` (`07` I-12). |
| **@anthropic-ai/sdk** | (rolled into Anthropic, 88) | — |
| **ws** | **80** | Genuinely required (header-bearing ctor for UW auth; `require('ws')` in `spx-broadcaster.ts:42` + the 3 socket modules). Docked for the `as unknown as string[]` cast papering over the options type (`07` I-15) and singleton-per-replica SPOF (`07` I-6). |
| **swr** | **85** | 13 importers; the polling backbone for every desk panel; correct refresh cadences. Well-used. |
| **framer-motion** | **70** | 48 importers — central to the "Living Terminal" visual language, so genuinely used, but heavy bundle weight; reduced-motion handling and bundle cost are the only knocks. |
| **recharts** | **45** | **Only 3 importers** (`07` claimed 8 — drift). A heavy charting lib for 3 charts; either consolidate charts onto it or replace with lightweight SVG and drop the dep. Paying bundle weight for thin usage. |
| **clsx** | **95** | 82 importers, trivial, correct. |
| **sharp** | **40** | **0 src importers** (only doc-page prose mentions it). Present as an implicit Next/OG image dep; if OG image generation isn't actually exercised it's pure install weight. **NOT VERIFIED — needs confirmation OG `ImageResponse` runs in prod.** |
| **lucide-react** | **0** | **Dead dependency — 0 importers** (`07` I-7). `^0.395` pre-1.0. Pure supply-chain + install surface. Remove. |
| **Discord (webhooks)** | **85** | Free, fire-and-forget, used for ops alerts + play posts + **personal user alerts** + AI-spend warnings. Well-utilized for what it is; only gap is `DISCORD_OPS_WEBHOOK_URL` unset → ops noise mixes into the play channel (RT-3, fixed). |
| **Web-push (VAPID) + web-push pkg** | **15** | **Inert** — VAPID env wired, `push_subscriptions` table exists, `gex-alerts` cron written, but `web-push` **not installed** AND the cron **unregistered** AND triple-gated off. Subscriptions accumulate with no consumer. Paying schema/UI surface for a feature that delivers nothing (`07` I-8, `10` P-8). |
| **Sentry (@sentry/nextjs)** | **10** | **Referenced but not installed** → dormant; errors go to Postgres + console only (`07` I-5). Decide in-or-out. |
| **Web search (Tavily/Serper/Brave)** | **35** | **Three SaaS providers coded for one job; only the first-configured is ever used** (`07` I-13). No breaker/rate-cap. Two of three are dead code; the one used is un-throttled. Consolidate to one. |
| **tsx (devDep running prod workers)** | **60** | Runs cron/worker services via `npx tsx`, but the Night Hawk edition deliberately switched to the HTTP route because the tsx worker crashed on `server-only` (toml comment). Boundary-fragile but the launch-critical path routes around it. |
| **docx** | **90** | Correctly dev-only, one script (playbook generation). Right-sized. |

**OVERALL TECHNOLOGY UTILIZATION SCORE: 71 / 100.**

**Formula (weighted by criticality):** core revenue/data/AI stack (UW 85, Polygon 80, Anthropic 88, Clerk 78, Whop 62, Postgres 82, Redis 80, Railway 70, Next 75) weighted 70%; supporting libs (ws 80, swr 85, framer 70, recharts 45, clsx 95, sharp 40, lucide 0) weighted 20%; optional/inert (web-push 15, Sentry 10, web-search 35, tsx 60, docx 90) weighted 10%.
- Core weighted avg ≈ (85+80+88+78+62+82+80+70+75)/9 = **77.8**
- Support weighted avg ≈ (80+85+70+45+95+40+0)/7 = **59.3**
- Optional weighted avg ≈ (15+10+35+60+90)/5 = **42.0**
- Overall = 0.70×77.8 + 0.20×59.3 + 0.10×42.0 = 54.5 + 11.9 + 4.2 = **70.6 ≈ 71/100.**

**Interpretation:** The **core stack is utilized at ~78%** (strong — the expensive technologies you pay for are doing real, broad work). The drag is the **support tier (~59%, dead/thin libs)** and the **optional tier (~42%, half-built features)**. Removing 3 dead deps (`lucide-react`, 2 of 3 web-search providers) and resolving the 2 inert features (web-push, Sentry) would lift the overall to ~78–80 with **zero new capability needed** — pure cleanup.

---

## D. PAYING-FOR-UNUSED / MISCONFIG LEDGER (the "tech debt invoice")

| Item | Type | Evidence | Action |
|---|---|---|---|
| `lucide-react ^0.395` | Dead dep (0 importers) | `07` I-7; grep = 0 | `npm uninstall` |
| `@sentry/nextjs` | Referenced, not installed | `error-sink.ts:77`; lock = 0 | Install + wire OR delete branch |
| `web-push` | Referenced, not installed → feature inert | `send-web-push.ts:36`; lock = 0 | Install + verify OR hide subscribe UI |
| 2 of 3 web-search providers | Dead branches | `web-search.ts` first-wins | Keep one; delete two + their env |
| `recharts` (3 importers) | Heavy lib, thin use | grep = 3 | Consolidate charts or replace |
| `sharp` (0 src importers) | Implicit Next dep only | grep = 0 in src | Confirm OG runs; else note as implicit-only |
| `gex-alerts` cron | Unregistered → never fires | not in `cron-registry.ts`; no toml | Register + install web-push OR delete |
| `gex-eod-snapshot` cron | Unregistered → `history_context` never populates | not in registry; "NOT done in this PR" comment | Register the toml + hit-cron entry |
| `/api/engine` proxy | Orphaned (TS migration done) | only health + docs reference | Confirm `API_BASE` unset → delete |
| `UW_CLIENT_API_ID` default `"100001"` | Magic placeholder x2 | `07` I-14 | Confirm w/ UW; fail loud if placeholder |
| Tier cache per-replica (not Redis) | Clerk 502 risk at scale | `07` I-4 | Move to Redis + jitter |

---

## E. FINDINGS (per-issue blocks)

### F-1 · Web-push is a fully-scaffolded, fully-inert feature consuming schema, UI, and a cron — but delivering nothing
- **Severity:** Medium (High as a marketing-vs-reality trust defect)
- **File:** `src/lib/push/send-web-push.ts`, `src/app/api/cron/gex-alerts/route.ts`, `src/app/api/push/subscribe/route.ts`
- **Code reference:** `gex-alerts/route.ts:30` `import { sendWebPush, vapidConfigured } from "@/lib/push/send-web-push";` gated at `:108` by `GEX_ALERTS_PUSH === "1"`; `send-web-push.ts:36` guarded `import("web-push")` → null (package absent); the cron is **not in `cron-registry.ts`** and has **no `railway.gex-alerts.toml`**.
- **Why:** Three independent gates each block delivery: (1) `web-push` not installed, (2) `GEX_ALERTS_PUSH` flag off, (3) cron unregistered so it never fires even if the first two were satisfied. The FAQ markets "the signal reaches you in real time" (`10` P-8). `push_subscriptions` rows accumulate with no consumer.
- **Impact:** **500 users:** some opt into alerts, get nothing off-tab → "your alerts don't work" tickets. **1,000:** dead `push_subscriptions` grows unbounded (no pruning consumer). **5,000:** a headline differentiator is conspicuously absent vs competitors; compounding trust erosion on the PWA the product sells.
- **Fix:** Either fully wire it — `npm i web-push`, register `railway.gex-alerts.toml` + `cron-registry.ts` entry, flip `GEX_ALERTS_PUSH` — and verify end-to-end; OR hide the subscribe UI behind a flag and re-scope the alert copy to in-app-only. Don't ship three gates that each silently disable a marketed feature.
- **Example:** add to `cron-registry.ts`: `{ key: "gex-alerts", name: "GEX Alerts", kind: "http", path: "/api/cron/gex-alerts", schedule_label: "Every 5 min (market hours)", stale_after_min: 15, market_hours_only: true, description: "GEX regime change → web-push broadcast" }` + the matching toml.

### F-2 · `gex-alerts` cron is unregistered (no toml, not in registry) — silently never fires
- **Severity:** Medium
- **File:** `src/app/api/cron/gex-alerts/route.ts`, `src/lib/cron-registry.ts`
- **Code reference:** `grep -c "gex-alerts" cron-registry.ts` = 0; no `railway.gex-alerts.toml` exists (only 10 tomls, none for gex-alerts).
- **Why:** Even with web-push installed and `GEX_ALERTS_PUSH=1`, nothing triggers the route — there's no scheduler. It's also **not covered by `cron-staleness-watchdog`** because the watchdog only checks keys in `cron-registry.ts`, so its silence is invisible.
- **Impact:** **500/1k/5k:** the entire GEX-alert product line is dark and undetected at every scale. The "silent never-fired cron" class the watchdog was built to catch — but it can't catch this one because it isn't registered.
- **Fix:** Register it (toml + registry + hit-cron entry) so the watchdog covers it, or delete the route if web-push is being descoped.

### F-3 · `gex-eod-snapshot` cron unregistered → Heatmap "vs prior close" history never populates in prod
- **Severity:** Medium
- **File:** `src/app/api/cron/gex-eod-snapshot/route.ts`, `src/lib/providers/polygon-options-gex.ts`
- **Code reference:** route comment (lines 1–15): *"Registering that schedule is infra-owned and intentionally NOT done in this PR"*; `grep -c "gex-eod" cron-registry.ts` = 0; no `railway.gex-eod-snapshot.toml`. The route appends to the `gex-eod:{ticker}` Redis list which `fetchGexHeatmap` diffs to produce the `history_context` ("flip/wall/net-GEX drift vs prior close").
- **Why:** Without the daily 4:10 PM ET run, the `gex-eod:{ticker}` list stays empty, so `history_context` is permanently null — a documented Heatmap value-add ("pros rely on day-over-day drift") that never renders.
- **Impact:** **500/1k/5k:** every Heatmap user is missing the prior-close comparison; flat with user count but a permanent feature gap. Compounds `10` Q-2 (Heatmap already under-delivers vs marketing).
- **Fix:** Add `railway.gex-eod-snapshot.toml` (`cronSchedule` ~`10 20 * * 1-5` = 4:10pm ET via UTC offset), a `cron-registry.ts` entry, and a hit-cron path. The route is already idempotent + a pure cache-reader, so it's safe to schedule.

### F-4 · `/api/engine` Python-engine proxy is orphaned (TS migration complete) — confirm-and-delete
- **Severity:** Low
- **File:** `src/lib/engine.ts`, `src/app/api/engine/[...path]/route.ts`
- **Code reference:** `engine.ts:12-13` reads `API_BASE` + `DASHBOARD_API_SECRET`; only callers are `engine/health/route.ts` + a docs page; POST proxying "intentionally disabled — no caller uses it."
- **Why:** The platform moved all engines to TS (per project memory). The proxy is a dormant external-trust surface (forwards a Bearer secret to `API_BASE`) for an engine that may no longer exist.
- **Impact:** **All scales:** dormant, but an un-needed external dependency + secret-forwarding surface. If `API_BASE` is unset it's pure dead code; if set, it's an undocumented live dependency.
- **Fix:** **NOT VERIFIED — needs prod env (`API_BASE`).** If unset, delete `engine.ts`, the proxy route, and `DASHBOARD_API_SECRET`. If set, document why the Python engine is still load-bearing.

### F-5 · Watchlist is browser-local only — a per-user feature with zero server/scale cost but no cross-device sync
- **Severity:** Low
- **File:** `src/lib/watchlist-store.ts`
- **Code reference:** `STORAGE_KEY = "blackout:watchlist:v1"`; module header: *"no React, no window, no @/ imports"* — pure parse/serialize of a `localStorage` blob.
- **Why:** Positive for scale (never touches Redis/DB/upstream — infinitely scalable). But it's invisible to Largo's `get_my_positions`-style cross-tool sharing and doesn't sync across devices — at odds with the "every tool sees every tool's data" principle (project memory) and the PWA multi-device pitch.
- **Impact:** **500/1k/5k:** zero infra cost (good), but the watchlist can't feed personalized alerts or cross-tool context, capping the feature's value. A user on phone + desktop sees two different watchlists.
- **Fix:** If cross-device/cross-tool watchlist is wanted, persist to a small `user_watchlist` table or Clerk metadata (like personal-alert webhooks already do). If not, document the local-only scope so it isn't mistaken for synced.

### F-6 · Largo's per-user budget + spend-ledger gate exist, but the global hard kill-switch degradation is still worth confirming (partial correction to `07` I-9 / `13`)
- **Severity:** Medium
- **File:** `src/app/api/market/largo/query/route.ts`, `src/lib/largo-budget.ts`, `src/lib/ai-spend-ledger.ts`
- **Code reference:** `largo/query/route.ts:98-111` per-user daily budget via `largoBudgetKey` + `BUDGET_INCR_LUA` (TTL to ET midnight); `:119` reads the cross-replica spend ledger and "rejects new [queries]" when over. So the "alert-only, no cap" framing in `07`/`13` is **outdated** — per-user and cross-replica caps exist.
- **Why:** What remains to verify is whether the cross-replica ledger gate **degrades Largo to a budget-exhausted message** (hard stop) vs merely throttling, and whether Night Hawk / commentary (the non-Largo Anthropic callers) share that ceiling. The most expensive surface (Largo's 87-tool loop) is now gated; the batch surfaces (Night Hawk edition build) may not be.
- **Impact:** **500:** likely fine. **1,000/5,000:** if the global ledger only gates Largo and not the evening Night Hawk build or commentary, a runaway there is uncapped.
- **Fix:** Confirm `ai-spend-ledger.ts` is consulted by ALL Anthropic entry points (Largo, Night Hawk `anthropicText`, commentary), with a hard global daily ceiling that degrades to a static message. Document the cap value. **NOT VERIFIED — needs to confirm the ledger gates `anthropicText` callers, not just the Largo loop.**

### F-7 · Recharts is a heavy dependency for only 3 importers (drift from `07`'s "8")
- **Severity:** Low
- **File:** `package.json`, 3 chart components
- **Code reference:** `grep -rln "from \"recharts\"" src` = 3 (vs `07` line 25 "Charts in 8 components").
- **Why:** A full charting library carried for 3 charts is bundle weight disproportionate to use; the count also drifted since the prior audit, suggesting charts were removed without revisiting the dep.
- **Impact:** **All scales:** client bundle weight (LCP/TTI on the marketing + desk pages), no runtime/upstream risk.
- **Fix:** Either consolidate more visualizations onto recharts (justify the weight) or replace 3 charts with lightweight SVG/`<canvas>` and drop the dependency.

### F-8 · No free-preview path means the entire feature catalog is invisible pre-purchase (re-stated from `10` P-2, framed as a utilization gap)
- **Severity:** High (growth/utilization)
- **File:** `src/app/(site)/{dashboard,flows,heatmap,terminal,nighthawk}/page.tsx`
- **Code reference:** every tool page opens `await requireTier("premium")`; only free API is `market/ticker-search`.
- **Why (utilization lens):** You pay for UW + Polygon + Anthropic + Redis to power a deep feature set, but **zero of it is exposed to the top of the funnel.** The cache-reader architecture means a delayed/throttled preview (e.g. 15-min-delayed HELIX from the existing `flow_alerts` table, last-closed play from `spx_play_outcomes`, 1–2 Largo Qs/day under the existing per-user budget) costs **nothing additional** at the upstream ceiling — the data is already cached/persisted.
- **Impact:** **500/1k/5k:** conversion is capped at "trust the sales page"; refund/chargeback risk (Whop disputes) scales with the cohort. The most expensive infra is doing work only paying users ever see.
- **Fix:** Ship a throttled free preview served entirely from existing caches/Postgres — the highest-ROI use of infra you already pay for.

---

## F. LAUNCH BLOCKERS (Features & Tech Utilization)

1. **RT-2 — SPX play route hard-502s on a Massive connect blip with no stale-serve** (`00-RUNTIME-FINDINGS.md`; `spx/play/route.ts:35-39`). The flagship feature has no degradation path; at 500–5,000 users a transient Massive blip = a synchronized wall of 502s. **Add stale-serve + connect-level retry + breaker before scaling.**
2. **F-1/F-2/F-3 — Three GEX/push surfaces are shipped-but-dead** (web-push inert; `gex-alerts` + `gex-eod-snapshot` crons unregistered). Either wire + verify end-to-end, or hide the UI/marketing. Don't launch features that silently deliver nothing while the FAQ promises them.
3. **F-8 / `10` P-2 — No free preview** caps the funnel at the sales page despite a deep, already-paid-for feature catalog. A cache-served throttled preview is the highest-ROI growth change and breaks no scaling rule.
4. **Whop SDK 0.0.40 with no contract test** (`07` I-3) — the revenue gate runs through a pre-release SDK touched in only 2 files with `as unknown as` casts. Add a signed-fixture verify + tier-resolution test before opening the paid funnel.

**Strongly recommended pre-scale (not strict blockers):** remove the 3 dead deps (`lucide-react`, 2 web-search providers) + confirm `sharp`/`recharts` (F-7) — lifts Technology Utilization from 71 to ~78 with zero capability loss; confirm the Anthropic global ledger gates all callers (F-6); confirm `/api/engine` (F-4) is dead and delete it.

---

## G. METHOD / VERIFICATION LIMITS

- Feature data sources traced from route → loader → provider (`spx-desk-loader.ts`, `polygon-options-gex.ts`, `nighthawk/data-sources.ts`, `largo/run-tool.ts`); Postgres tables from `db.ts` `CREATE TABLE`; refresh intervals from `cron-registry.ts` + SWR `refreshInterval`/`POLL_MS` grep; alert channels from `personal-alert-fanout.ts` + `gex-alerts/route.ts`.
- **Corrections to inherited audits (all re-verified):** (a) personal SPX alerts ride **Clerk-metadata Discord webhooks** and are functional — NOT web-push; (b) Largo now has a **per-user Redis budget + cross-replica spend ledger gate** (`07` I-9 / `13` "alert-only" is partly outdated); (c) Night Hawk edition uses the **HTTP cron route**, not the crashy tsx worker, so `07` I-11 doesn't bite the build; (d) **recharts = 3 importers**, not 8; (e) `sharp`/`lucide-react` confirmed **0 src importers**; (f) `ws` IS used (via `require('ws')` + 3 socket modules) — stands.
- **Technology Utilization Scores** are a structured judgement (breadth × fit × config-health), not a measured metric; the formula + inputs are shown in §C so they can be recomputed. Per-feature **prod facts flagged NOT VERIFIED:** replica count (drives UW-ceiling + pg-pool math), `API_BASE` (engine proxy), PgBouncer presence, OG-image (`sharp`) runtime exercise, distinct-open-chain count (Night's Watch warm fan-out), Anthropic model-ID validity, and whether the spend ledger gates non-Largo callers.
- This section is the **features + tech-utilization lens**; it defers data-plumbing depth to `01/03/04`, integration internals to `07`, cron mechanics to `05`, and product/trust framing to `10`, citing them rather than re-litigating.
