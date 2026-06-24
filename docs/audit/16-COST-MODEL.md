# 16 — CONSOLIDATED MONTHLY COST MODEL (500 / 1,000 / 5,000 users)

**Auditor pass:** Pass-2 synthesis. Consolidates the per-service deep dives (11-UW, 12-POLYGON, 13-CLAUDE, 14-INFRA) + 09-SCALABILITY + 00-RUNTIME into ONE monthly $ cost model per service per tier, separating **VARIABLE** cost (estimable from usage × rate — formula shown) from **FIXED** plan cost (marked `NOT VERIFIED — needs invoice/plan tier`, with a plausible range).

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`). **READ-ONLY.**

**Method:** Every number is either (a) a list/published rate × a usage estimate with the formula + inputs shown, or (b) a FIXED plan line flagged `NOT VERIFIED` with the evidence required and a plausible range. No invented invoice numbers. Where the deep dives already derived a figure I re-state its source; where a fact needed code confirmation I verified it (see §0.3).

> **The single most important architectural fact for this whole model (the cache-reader rule, verified `09-SCALABILITY.md:19`, `11-UW-DEEP.md:25`, `12-POLYGON-DEEP.md:82`):** per-user features read **shared caches**, never per-user upstream. Therefore **almost every cost line is FLAT across 500 / 1k / 5k users.** Only THREE things scale with user count: **(1) Anthropic-Largo** (per active premium user), **(2) Railway compute/SSE** (replicas needed to hold concurrent connections), and **(3) Postgres/Redis/bandwidth op-rate** (linear in concurrent connections). UW, Polygon, and all non-Largo AI are user-count-independent at steady state. This is why the platform is fundable at all on a 2-RPS UW ceiling.

---

## 0. Inputs, rates, and what is FIXED vs VARIABLE

### 0.1 The three cost archetypes

| Archetype | Definition | Scales with users? | Services in it |
|---|---|---|---|
| **FIXED plan** | Flat monthly subscription, independent of usage within plan limits | **No** (until a plan-tier breakpoint) | UW Advanced, Polygon/Massive Options Advanced, Railway Postgres plan, Railway Redis plan, base web compute, Anthropic committed-spend minimum (if any) |
| **VARIABLE metered** | Billed per unit consumed (token, GB egress, GB-hour, log GB) | **Some lines yes, some no** | Anthropic tokens (Largo = per user; shared surfaces = flat), Railway egress/bandwidth, Railway compute-hours (replica count), log ingestion |
| **VARIABLE but FLAT** | Metered upstream but collapsed to a shared cache so the bill doesn't grow with users | **No** | UW REST/WS (flat-rate anyway), Polygon chain snapshots (shared GEX cache), all non-Largo Anthropic surfaces |

### 0.2 Published / list rates used (each flagged where unconfirmed)

| Service | Rate basis | Value | Status |
|---|---|---|---|
| Anthropic `claude-sonnet-4-6` | list price | $3.00 in / $15.00 out per MTok; cache-read $0.30; cache-write(5m) $3.75 | list price, `NOT VERIFIED` vs contract (`ai-spend.ts:29` confirms $3/$15) |
| Anthropic `claude-haiku-4-5` | list price | $1.00 in / $5.00 out per MTok; cache-read $0.10; cache-write $1.25 | list price, `NOT VERIFIED` vs contract (`ai-spend.ts:31` confirms $1/$5) |
| Unusual Whales | flat-rate plan | "$375/mo" per catalog **descriptive text only** (`api-provider-catalog.ts:92`) | **NOT VERIFIED — needs UW invoice.** No per-call billing in code; rate budget is 2 RPS, not $ |
| Polygon / Massive | flat-rate plan | "Options Advanced … real-time" (`polygon-options-gex.ts:14`); "unlimited calls on paid plan" (`polygon-largo.ts:3`) | **NOT VERIFIED — needs Massive invoice.** No per-call billing in code; ceiling is 40 RPS |
| Railway compute | GB-hour / vCPU-hour | Railway meters RAM-GB-hour + vCPU-hour | **NOT VERIFIED — needs Railway plan + container size** (`14-INFRA §L.5`) |
| Railway egress | per GB | Railway bills network egress | **NOT VERIFIED — needs Railway plan + actual egress** |
| Railway Postgres | plan tier | managed plan | **NOT VERIFIED — needs Railway Postgres plan** (`14-INFRA §G.2`) |
| Railway Redis | plan tier | managed plan | **NOT VERIFIED — needs Railway Redis plan/HA** (`14-INFRA §G.1`) |

### 0.3 Facts verified in code for THIS section (not inherited on faith)

| Fact | Evidence (file:line) | Used for |
|---|---|---|
| UW local + global ceiling = 2 RPS | `uw-rate-limiter.ts:12,14` | UW load is rate-bounded, not $-metered |
| Polygon local + global ceiling = 40 RPS, concurrency 24 | `polygon-rate-limiter.ts:32,34,35` | Polygon headroom; chain-fan-out breakpoint |
| Anthropic price table (sonnet $3/$15, haiku $1/$5; cache mults 0.1×/1.25×) | `ai-spend.ts:23-36` | every Anthropic $ line |
| Cross-replica daily spend ledger EXISTS (Redis INCRBYFLOAT) | `ai-spend-ledger.ts:52-53` | org-spend is observable; kill-switch is real |
| Org kill-switch is OPT-IN, null unless `DAILY_AI_SPEND_KILL_USD` set | `ai-spend-ledger.ts:42-45` | the only hard $ backstop; launch blocker if unarmed |
| Largo per-user daily query cap default = **100 queries/user/day** | `largo-budget.ts:8` (`DEFAULT_LARGO_DAILY_QUERY_BUDGET = 100`) | the per-user worst-case ceiling (huge — see §4.3) |
| Largo loop: `maxRounds=12`, `maxTokens=4096`/round, `MAX_HISTORY=28` | `anthropic.ts:320`, `largo-terminal.ts:27,173` | Largo per-turn token model |
| UW warm cron = 22 UW REST tasks + 1 Polygon (movers) per run, every 2 min | `uw-cache-refresh/route.ts:42-100` (1 tide + 5 sector + 1 dp-recent + 1 top-net + 1 congress + 4×3 index + 2 flow-strike = 22 UW; movers→Polygon) | UW/Polygon steady-state load (flat) |
| SSE cap = 500 streams/instance | `pulse/stream/route.ts:15` | replica count → compute cost driver |
| PG pool max = 5/replica, connTimeout 15s | `db.ts:93,96` | DB plan sizing |

---

## 1. Per-service cost summary (the consolidated table)

All $ are **monthly**. **F** = FIXED plan (range, `NOT VERIFIED`). **V** = VARIABLE (formula in the cited section). "Flat" = does not grow with users.

| Service | Type | @ 500 users | @ 1,000 users | @ 5,000 users | Scales with users? | Driver |
|---|---|---|---|---|---|---|
| **Anthropic — Largo** (per-user) | V | ~$1,640 (typ) / ~$13,440 (heavy) | ~$3,280 / ~$26,880 | ~$16,380 / ~$134,400 | **YES (linear)** | active premium users × turns × tokens (§4) |
| **Anthropic — shared surfaces** (commentary, GEX, flow, NW, play-gate, Night Hawk) | V-flat | ~$276 | ~$278 | ~$300 | No (NW narrative weakly) | GEX-explain frequency (§4.2) |
| **Unusual Whales** plan | F | $375–$500 | $375–$500 | $375–$750* | No (flat-rate) | 2-RPS budget, not $ (§5) |
| **Polygon / Massive** plan | F | $300–$2,000 | $300–$2,000 | $300–$2,000* | No within plan; tier-bump risk at 5k (§6) | chain-snapshot fan-out (rate, not $) |
| **Railway — web compute** (replicas) | V | $40–$120 (1 replica) | $120–$360 (2–3) | $400–$1,200 (5–10+) | **YES (step per replica)** | SSE 500/instance cap (§7.1) |
| **Railway — cron services** (10×) | V-flat | $0–$50 | $0–$50 | $0–$50 | No | near-zero (echo build) (§7.2) |
| **Railway — Postgres** | F+V | $50–$250 | $100–$400 | $250–$1,000 | Weak (write volume) | telemetry INSERT/call (§8) |
| **Railway — Redis** | F+V | $10–$100 | $30–$200 | $100–$500 | **YES (SSE op-rate)** | 4 GET/s/SSE client (§9) |
| **Railway — egress / bandwidth** | V | $20–$150 | $40–$300 | $200–$1,500 | **YES (linear)** | flow payload + poll fan-out (§10) |
| **Logging / monitoring** (+ Sentry when installed) | V | $0–$80 | $26–$130 | $26–$300 | Weak (failure-driven) | console log volume; Sentry plan (§11) |
| **Object storage** | F | ~$0 | ~$0 | ~$5–$20 | No | none today (§12) |
| **TOTAL (typical)** | — | **~$2,700–$3,900** | **~$4,700–$6,500** | **~$18,700–$23,000** | — | Largo dominates |
| **TOTAL (heavy Largo)** | — | **~$14,500–$16,700** | **~$28,300–$32,000** | **~$137,000–$152,000** | — | Largo dominates harder |

\* UW/Polygon flat-rate hold across tiers; the upper bound at 5k reflects a *possible plan-tier bump* (Polygon chain-fan-out, 12-POLYGON §8) or a UW Business/Enterprise upgrade if a streaming entitlement (Kafka) is bought — NOT a usage overage.

> **Range width is dominated by two unknowns:** (1) the FIXED plan tiers (UW/Polygon/Postgres/Redis invoices — every "F" line is a range, not a point), and (2) the **typical-vs-heavy Largo spread** (~8–10×, §4.3). The *shape* is reliable; the absolute total moves with the real invoices and the real Largo turn distribution.

---

## 2. Dominant cost driver per tier (the headline)

| Tier | #1 driver | Share of total (typ) | Why | First $-control lever |
|---|---|---|---|---|
| **500** | **Anthropic-Largo** | ~50–60% (typ); ~90% (heavy) | Only unbounded per-user surface; everything else is flat plan cost | Arm `DAILY_AI_SPEND_KILL_USD` (§13 L-1) |
| **1,000** | **Anthropic-Largo** | ~60–70% | Largo doubles with users; UW/Polygon still flat | Largo prompt caching (§13 L-2) + tighten per-user query cap from 100 |
| **5,000** | **Anthropic-Largo** | ~75–85% (typ); ~95% (heavy) | Largo is the only thing that grows ~linearly to 5k; the fixed plans barely move | Caching + token-budget the per-user cap + possibly haiku-tier a Largo "lite" mode |

**The non-Largo services never become the dominant cost at any tier** because the cache-reader rule pins them flat. At 5k the *second* driver is Railway compute+egress+Redis (the real-time tier), not the data providers. **The data providers (UW, Polygon) are a rounding error against Largo at every tier** — their cost is a fixed plan you've already bought, and their scaling constraint is the **2-RPS / 40-RPS rate budget**, not dollars.

---

## 3. The structural insight: cost is concentrated, not spread

```
                     500 users          1,000 users         5,000 users
Anthropic-Largo     ████████ ~$1.6k     ████████ ~$3.3k     ████████████████ ~$16.4k   ← grows ~linearly
Anthropic-shared    █ ~$0.28k           █ ~$0.28k           █ ~$0.30k                   ← FLAT
UW plan             ██ ~$0.4–0.5k       ██ ~$0.4–0.5k       ██ ~$0.4–0.75k              ← FLAT plan
Polygon plan        ██–████ ~$0.3–2k    ██–████ ~$0.3–2k    ██–████ ~$0.3–2k            ← FLAT plan (tier risk @5k)
Railway compute     █ ~$0.04–0.12k      ██ ~$0.12–0.36k     ████ ~$0.4–1.2k             ← STEP per replica
Railway PG+Redis    █ ~$0.06–0.35k      ██ ~$0.13–0.6k      ████ ~$0.35–1.5k            ← grows w/ op-rate
Egress              █ ~$0.02–0.15k      █ ~$0.04–0.3k       ███ ~$0.2–1.5k              ← grows ~linearly
```

The picture: **one tall bar (Largo) that grows, surrounded by short bars that mostly don't.** Optimizing anything except Largo, compute, and egress is rounding-error work. **Optimizing Largo is the entire cost-engineering job.**

---

## 4. Anthropic / Claude (from 13-CLAUDE-COST.md, re-verified)

### 4.1 Split: shared (flat) vs Largo (per-user)

Every Anthropic call funnels through `anthropicText()` (single-shot) or `anthropicToolLoop()` (Largo). **Every surface except Largo is a shared-cache reader → cost is user-count-independent** (`13-CLAUDE §4`, verified via the cache layers in the call-site table). Only Largo scales with active users.

### 4.2 Shared (flat) monthly subtotal — computed once, added to every tier

From `13-CLAUDE §5a` (list prices, char-derived token estimates, `NOT VERIFIED — needs prod telemetry from the recordApiCall ledger`):

```
SPX commentary  : 78 win/day × $0.0115 × 21 trd-days = $18.84/mo   (haiku, 1 call/5-min window)
GEX explain     : 1,300/day × $0.0078 × 21           = $212.94/mo  ← 75% of shared; sonnet, per-ticker 3-min TTL
Flow brief      : 26/day × $0.0045 × 21              = $2.46/mo
SPX play gate   : 40/day × $0.0113 × 21              = $9.49/mo    (hard cap SPX_CLAUDE_DAILY_MAX_CALLS=40)
NH synthesis    : 1/day × $0.0795 × 21               = $1.67/mo
NH critic       : 1/day × $0.0330 × 21               = $0.69/mo
NH explainer    : 5/day × $0.0480 × 21               = $5.04/mo
NW narrative    : ~200 distinct-pos/day × $0.0059 × 21 = $24.78/mo (weak user-scaling via distinct positions)
                                                       ─────────
SHARED SUBTOTAL ≈ $276/mo  (rises to ~$300 @5k only via more distinct NW positions)
```

**GEX-explain is 75% of all shared AI spend purely on frequency** (per-ticker, 3-min TTL, ~10 tickers, running on **sonnet**). Moving it to **haiku** cuts that $213 line to ~$71 = **−$142/mo flat** at every tier with negligible quality loss (`13-CLAUDE C-2`). This is the cheapest high-value AI fix.

### 4.3 Largo (per-user) — the cost engine

**Per-turn cost** (verified loop mechanics: `anthropic.ts:320` `maxRounds=12`, 4096 tok/round; `largo-terminal.ts:27` `MAX_HISTORY=28`): a **typical 3-round turn ≈ $0.13** (Σ ~32K input × $3/M + ~2.4K output × $15/M); a **pathological 12-round turn ≈ $0.30–0.55** because the prefix + accumulated tool results are re-billed every round (quadratic re-send is the driver, not output) — `13-CLAUDE §3`.

**Monthly formula:**
```
Largo $/mo = users × active_frac × turns/user/day × $/turn × 21 trading-days
```
**Assumptions (all `NOT VERIFIED — needs prod`):** active_frac = 30% premium-active/day; typical = 4 turns/day × $0.13; heavy = 8 turns/day × $0.40, active_frac 40%.

| Users | Typical Largo/mo | Heavy Largo/mo |
|---|---|---|
| 500 | 500×0.30×4×$0.13×21 = **$1,638** | 500×0.40×8×$0.40×21 = **$13,440** |
| 1,000 | **$3,276** | **$26,880** |
| 5,000 | **$16,380** | **$134,400** |

**The per-user worst-case ceiling is alarming:** the per-user daily cap defaults to **100 queries/day** (`largo-budget.ts:8`). At $0.30–0.55/pathological turn, one abusive user = **$30–55/day = ~$630–1,155/user/mo** if they max the cap with expensive turns. At 5k users a small cohort doing this is the tail that the *query-count* budget fails to bound (it counts queries, not tokens — `13-CLAUDE C-7`). **Recommendation: lower the default cap well below 100 and budget by TOKENS, not queries.**

### 4.4 The two Largo levers worth real money

1. **Prompt caching (`13-CLAUDE C-1`, High).** Today the only `cache_control` breakpoint is on `LARGO_SYSTEM_PROMPT` (~1,270 tok), but tools render *before* system and the tool list is **intent-filtered per question**, so a changed tool set invalidates the entire cached prefix. Of ~32K input tok/turn, only ~1,270 are ever cacheable. **Fix:** send the full, name-sorted tool set every turn + add a cache breakpoint on the last tool def + on the prior turn's last message. **Estimated saving: cut Largo input 30–50% → −$500–800/mo @500, −$1,000–1,600/mo @1k, −$5,000–8,000/mo @5k.** This is the single biggest cost lever in the whole platform.
2. **Arm the kill-switch (`13-CLAUDE C-6`, High, launch blocker).** `aiSpendKillSwitchUsd()` returns null unless `DAILY_AI_SPEND_KILL_USD` is set (`ai-spend-ledger.ts:42-45`). The cross-replica ledger IS wired (`ai-spend-ledger.ts:52`) so the org total is *observable*, but unarmed there is **no hard stop**. A prompt-injection loop or viral day at 5k heavy = **$4,000–6,000/day** unbounded. Arm it at e.g. 3–5× expected daily spend.

> **Correction carried from 15-FEATURES:** the "Largo is alert-only, no cap" framing in older sections is outdated — a per-user query budget (`largo-budget.ts`) AND a cross-replica spend ledger (`ai-spend-ledger.ts`) both exist. What's missing is (a) the kill-switch being *armed* in prod, and (b) the ledger gating the **non-Largo** batch callers (Night Hawk `anthropicText`), which today is unverified (`15-FEATURES`, `13-CLAUDE C-6`).

---

## 5. Unusual Whales (from 11-UW-DEEP.md)

**Cost type: FIXED flat-rate plan. Zero per-call billing in code.** The scarce resource is the **2-RPS cluster ceiling** (`uw-rate-limiter.ts:12,14`), not dollars.

- **FIXED plan:** "$375/mo" appears only as **descriptive catalog text** (`api-provider-catalog.ts:92`) — **NOT VERIFIED — needs UW invoice** for tier + price + whether 2 RPS / 120-per-min is the real cap. **Plausible range $375–$500/mo** for Advanced; a streaming/Kafka entitlement or Business tier could push it to **$500–$1,500/mo** (`11-UW §7`, Kafka NOT VERIFIED).
- **VARIABLE:** **none.** Flat-rate. Adding users adds **zero** UW $ because users read Redis, never UW (`11-UW:25`).
- **Steady-state load (flat across tiers):** 22 UW REST tasks / 2 min from the warm cron + 1 WS multiplex/replica (`uw-cache-refresh/route.ts:42-100`, verified). This is **independent of user count** — the same at 500 and 5,000.
- **The cost angle that matters is the inverse:** UW Advanced is flat-rate, so **every unused endpoint is paid-for capability left idle** (`11-UW §4`: ~53% of 172 REST endpoints wired, only ~6% continuously exercised; 5 of 12 WS channels unused incl. the high-value `option_trades`/`lit_trades` tape). **There is no $ saving to extract from UW — the opportunity is to extract more VALUE from the flat fee** (stream the tape per UW-1; build the unwired vol/alt-data surfaces per UW-2) and to **avoid a forced tier-bump** at 5k by streaming instead of REST-polling.
- **Scaling $ risk:** the only way UW cost *rises* is a deliberate plan upgrade (Business/Enterprise or Kafka) chosen to serve 5k users live tape. That's a **value decision, not an overage** — and per UW-1 the architecturally-correct one if you go to 5k.

**UW verdict: $375–$500/mo flat at all three tiers; a possible $500–$1,500/mo if a streaming entitlement is bought for the 5k real-time tier. NOT VERIFIED — needs UW invoice + Kafka entitlement confirmation.**

---

## 6. Polygon / Massive (from 12-POLYGON-DEEP.md)

**Cost type: FIXED flat-rate plan. "Unlimited calls on paid plan" assumed in code** (`polygon-largo.ts:3`); ceiling is the **40-RPS limiter** (`polygon-rate-limiter.ts:32`), not per-call billing.

- **FIXED plan:** "Massive Options Advanced … real-time" (`polygon-options-gex.ts:14`). **NOT VERIFIED — needs Massive invoice.** Massive/Polygon options real-time plans publicly range widely. **Plausible range $300–$2,000/mo** depending on whether it's a mid-tier Options Advanced or a higher real-time/unlimited tier. The wide range is the single biggest FIXED-cost uncertainty in the model.
- **VARIABLE:** **none today** (flat-rate). Users read shared GEX/desk caches (`12-POLYGON §3b`: `withServerCache` single-flight + 20s GEX TTL collapses 500 desk GETs to 1 upstream build).
- **Steady-state load (flat for the hot set):** indices WS (1 connection, cluster-shared, **zero** marginal cost/user) + options WS union (zero marginal cost/user) + the GEX chain-snapshot hot path. SPX/SPY concentrated traffic stays **far under 40 RPS** at 500 users.
- **The scaling $ risk is a TIER-BUMP at 5k, driven by RATE not $:** distinct-ticker GEX fan-out (`12-POLYGON HIGH-3`) — at 5k users across >200 tickers, ~60 chain-calls/s **exceeds the 40-RPS ceiling on its own**, and the 200-key in-memory `clear()` thrashes the hot SPY/SPX entry. If unfixed, you'd be forced onto a higher Massive tier (more $) to buy RPS headroom you don't actually need. **The fix is engineering, not spend:** LRU eviction + curated ticker allow-list + global force throttle (`12-POLYGON HIGH-3`) + the **single-contract snapshot endpoint** for Night's Watch warming (`12-POLYGON §5`, "biggest win") keeps you on the current plan at 5k.
- **Correctness $ leak (tier-independent):** `spx-power-hour-engine.ts` hardcodes `api.polygon.io` + wrong filter param syntax (`12-POLYGON HIGH-4`) → wastes a rate-limited call per build for a discarded synthetic-fallback result. Trivial $ but a clean correctness fix.

**Polygon verdict: $300–$2,000/mo flat at all tiers. The 5k tier holds on the SAME plan IF the HIGH-3 fan-out fixes land; otherwise a tier-bump is a real (avoidable) cost. NOT VERIFIED — needs Massive invoice + the 40-RPS plan ceiling + a prod page-count sample (`12-POLYGON MED-3`).**

---

## 7. Railway compute (from 14-INFRA-RAILWAY.md)

### 7.1 Web service — the only compute that scales with users

**Cost type: VARIABLE (GB-hour + vCPU-hour), step-function in replica count.** Topology = ONE long-running Next web service (`14-INFRA §A`); replica count **not pinned in code** (`railway.toml` has no `numReplicas`, `14-INFRA §A`).

**The cost-driving constraint is the SSE 500/instance cap** (`pulse/stream/route.ts:15`, verified). Concurrent users on the live desk each hold an SSE stream, so **replica count ≈ ceil(concurrent_SSE_users / 500)** plus headroom:

| Tier (concurrent) | Min replicas (SSE cap) | Realistic replicas (+ event-loop headroom) | Compute $/mo (range) | Basis |
|---|---|---|---|---|
| 500 | 1 (exactly at cap, zero headroom) | 1–2 | **$40–$120** | one well-sized replica feasible IF PgBouncer real + `SSE_MAX_STREAMS` raised (`14-INFRA §I`) |
| 1,000 | 2 | 2–3 | **$120–$360** | ≥2 replicas activates per-replica fixes (UW_MAX_RPS, cross-replica spend) |
| 5,000 | 10 | 5–10+ (after SSE pub/sub refactor cuts per-replica cost) | **$400–$1,200** | needs real-time tier re-architecture (dedicated socket/fan-out worker) (`14-INFRA §C.1`) |

**`NOT VERIFIED — needs Railway container vCPU/RAM + the actual GB-hour/vCPU-hour rate + the prod replica count.** Ranges assume a mid-size container (~1–2 vCPU / 2–4 GB) at typical Railway metered rates. The single-process-does-everything model (web + all WS + all SSE + all Largo loops + all cron work) is the structural ceiling (`14-INFRA §C.1`); past 1k you pay for replicas you wouldn't need if SSE used Redis pub/sub fan-out (`09-SCALABILITY H.1`) — so the **SSE refactor is a compute-cost lever**, not just a scaling fix.

### 7.2 Cron services — near-zero

10 single-replica cron *trigger* services build with `echo` (no node_modules, no app build) and run `node scripts/hit-cron.mjs` then exit (`14-INFRA §A,J`). **Cost ≈ $0–$50/mo total** — they're seconds of compute a few times/min. The actual cron WORK runs inside the web pool (already counted in §7.1). Flat across tiers.

---

## 8. Postgres (from 14-INFRA §G.2, 09-SCALABILITY F)

**Cost type: FIXED plan + weak VARIABLE (write volume + storage).**

- **FIXED plan:** managed Railway Postgres. **NOT VERIFIED — needs Railway Postgres plan + `max_connections` + PgBouncer presence** (`14-INFRA §G.2` — PgBouncer is a *manual runbook*, not provisioned; if absent, pool-of-5/replica is the hard ceiling and the **most likely first systemic failure at 500**, `09-SCALABILITY F.1`). **Plausible range $50–$250/mo @500 → $250–$1,000/mo @5k** for a larger instance + replica + backups.
- **VARIABLE (write volume):** **one un-batched INSERT per upstream API call** (telemetry, `api-telemetry-persist.ts`, `09-SCALABILITY F.2`) = hundreds of thousands to low-millions of rows/day. This scales with **upstream-call volume** (roughly flat per TTL window under the cache-reader rule) **plus** Largo tool-calls (which *do* scale with users). At 5k the telemetry table is the dominant write load + largest table (≥90-day retention). **Lever: batch + sample telemetry inserts** (`09-SCALABILITY F.2` / 04-DB) — collapses round-trips and storage, and stops telemetry competing with user reads for the pool-of-5.
- **Storage:** telemetry + flow_events + error_events (bounded 2000) + journal/positions. Modest; grows with retention, not users. `NOT VERIFIED — needs row counts.`

**Postgres verdict: $50–$250/mo @500, $100–$400 @1k, $250–$1,000 @5k — mostly the plan tier (FIXED), with telemetry write volume the only user-correlated VARIABLE. Batch+sample telemetry to cap it.**

---

## 9. Redis (from 14-INFRA §G.1, 09-SCALABILITY G/H)

**Cost type: FIXED plan + VARIABLE op-rate. This is the one infra line where the OP-RATE scales ~linearly with concurrent users.**

- **FIXED plan:** managed Railway Redis. **NOT VERIFIED — needs Railway Redis plan + HA/persistence** (`14-INFRA §G.1` — single box is the likely topology; tier-0 SPOF). **Plausible range $10–$100/mo @500 → $100–$500/mo @5k** (HA pair + memory for the op-rate).
- **VARIABLE (op-rate):** **each SSE stream issues a Redis GET every 250ms = 4 GET/s/client** (`09-SCALABILITY G.1, H.1`). So **500 SSE clients = 2,000 GET/s; 5,000 = 20,000 GET/s** — plus rate-limit EVALs (1/UW+Polygon call) + cache reads + the cross-replica spend ledger. Memory is bounded (short TTLs); the **op-rate is the cost** — a small Redis becomes the cluster bottleneck and, if it slows, triggers the fail-open cascade (`09-SCALABILITY M.1`: UW ceiling + AI-spend cap + Largo gate all drop at once).
- **The dominant lever (both cost AND stability):** replace the per-connection 250ms GET loop with **one Redis pub/sub subscriber per replica** (`09-SCALABILITY H.1`) → collapses ~20,000 GET/s to a handful at 5k. This lets you stay on a smaller Redis plan AND removes the SPOF op-rate risk. **Highest-leverage infra change for the 1k→5k path.**

**Redis verdict: $10–$100/mo @500 → $100–$500/mo @5k. The op-rate (4 GET/s/SSE client) is the user-correlated driver; the SSE pub/sub refactor caps it.**

---

## 10. Egress / bandwidth (from 09-SCALABILITY I.1, H.2)

**Cost type: VARIABLE, scales ~linearly with concurrent users.** This is the most underestimated user-correlated line.

- **Driver 1 — flow payload fan-out:** `fetchRecentFlows` returns up to **5,000 JSONB-heavy rows** (`db.ts:822`, `09-SCALABILITY I.1`/F.5), polled every 30s by every flow-feed user, identical per user (server-cached). At 5k users that's 5k × a large JSON blob every 30s = significant egress. **Lever: cap `LIMIT` to ~500 (the UI slices to 500 anyway, `FlowFeed.tsx:157`) + edge/CDN-cache the identical GET** (`09-SCALABILITY I.1`).
- **Driver 2 — poll cadence fan-out:** ~600 req/s at 500 users from the 1.5s quote + 3s pulse + 5s positions polls (`09-SCALABILITY H.2`), each serializing JSON. Scales linearly → ~6,000 req/s at 5k. Each response is egress.
- **Estimate (formula, `NOT VERIFIED — needs Railway egress rate + measured payload sizes`):** if avg response ≈ 20 KB and ≈ 1 req/s/user across panels → 500 users × 20 KB × 86,400 s/day ≈ **~864 GB/day → ~26 TB/mo** at 500 (most served from cache, but still egressed to clients). Even at a low per-GB rate this is the line most likely to surprise. **Cap payloads + CDN the cacheable identical GETs (flows, pulse) to cut it hard.**

**Egress verdict: $20–$150/mo @500 → $200–$1,500/mo @5k — linear in users, and the flow-payload cap + CDN are real levers. NOT VERIFIED — needs Railway egress pricing + measured payload bytes.**

---

## 11. Logging / monitoring (from 14-INFRA §F, 09-SCALABILITY M.2)

**Cost type: VARIABLE (log GB) + FIXED (Sentry plan, once installed).**

- **Logging:** `console.*` to Railway's log stream is the primary sink (`14-INFRA §F.2`, `09-SCALABILITY M.2`). Under a failure cascade every replica emits per-key/per-call warns → log flood → Railway log-ingestion cost spike (`09-SCALABILITY M.2`). Bounded normally; the risk is incident-driven, scaling with replica count. **Lever: leveled logger + per-message rate-limiting; prefer the DB error-sink over raw console for high-frequency failures.**
- **Sentry:** the error-sink integration is wired but **`@sentry/nextjs` is NOT installed** (`14-INFRA §F.2`, `15-FEATURES`) — so Sentry is dormant. Installing it (a launch blocker for observability) adds a **FIXED plan: ~$0 (free tier) to ~$26–$80/mo (Team)**, growing with event volume at 5k. **NOT VERIFIED — needs the chosen Sentry plan.**
- **Estimate:** logging $0–$50/mo @500 (within Railway's included volume) → up to ~$200/mo @5k under incident load; + Sentry $0–$26/mo @500 → $26–$100/mo @5k.

**Monitoring verdict: $0–$80/mo @500 → $26–$300/mo @5k. Install Sentry (currently absent) — it's an observability launch blocker (`14-INFRA F.2`, `15-FEATURES`), and the cost is small.**

---

## 12. Object storage

**Cost type: FIXED, ~$0 today.** No object storage is in active use (`sharp` has 0 src importers, `15-FEATURES`; no S3/blob client wired). If UW-10's full-tape backtest dataset (`11-UW UW-10`) is built, a nightly options-tape dump → object storage would add **~$5–$20/mo** at modest retention. Not a current cost line. Flat across tiers.

---

## 13. Top cost-optimization opportunities (ranked by $ impact)

| # | Opportunity | Service | Est. saving | Effort | Source |
|---|---|---|---|---|---|
| **L-1** | **Arm `DAILY_AI_SPEND_KILL_USD`** (the hard org ceiling; cross-replica ledger already wired) | Anthropic | **Bounds the unbounded tail** — caps a runaway day at the ceiling instead of $4–6k/day @5k | Trivial (env var) | `13-CLAUDE C-6`, `ai-spend-ledger.ts:42` |
| **L-2** | **Largo prompt caching** — stable name-sorted tool set + cache breakpoints on last-tool + prior-turn | Anthropic | **−$500–800 @500 · −$1–1.6k @1k · −$5–8k @5k /mo** | Medium | `13-CLAUDE C-1` |
| **L-3** | **Tighten + token-budget the per-user Largo cap** (default 100 queries/day is huge; budget by tokens not queries) | Anthropic | Bounds the heavy-user tail that drives the 8–10× typical→heavy spread | Low | `largo-budget.ts:8`, `13-CLAUDE C-7` |
| **L-4** | **Move GEX-explain + flow-brief to haiku** | Anthropic | **−$142/mo flat** (every tier), no quality loss | Trivial | `13-CLAUDE C-2` |
| **L-5** | **SSE → one Redis pub/sub subscriber per replica** (kills the 4 GET/s/client op-rate) | Redis + compute | Stays on a smaller Redis plan + fewer replicas → meaningful at 1k→5k | Medium | `09-SCALABILITY H.1` |
| **L-6** | **Batch + sample telemetry inserts** | Postgres | Caps the dominant write load + storage; keeps the pool-of-5 for user reads | Medium | `09-SCALABILITY F.2` |
| **L-7** | **Cap flows `LIMIT` to 500 + edge/CDN-cache the identical flows/pulse GETs** | Egress | Cuts the largest user-correlated egress line | Low | `09-SCALABILITY I.1` |
| **L-8** | **GEX heatmap LRU eviction + curated ticker allow-list + global force throttle + single-contract NW endpoint** | Polygon | **Avoids a 5k plan-tier bump** (keeps you under 40 RPS) | Medium | `12-POLYGON HIGH-3, HIGH-1, §5` |
| **L-9** | **Stream UW `option_trades`/`lit_trades`; retire `net-prem-ticks` REST polling for index tickers** | UW | Reclaims 2-RPS budget → avoids a UW tier-bump at 5k (value, not $ saving) | Medium | `11-UW UW-1, UW-5` |
| **L-10** | **Batch Night Hawk play explainers via the Messages Batches API (50% off, overnight, not latency-sensitive)** | Anthropic | Halves NH explainer cost (small absolute, clean win) | Low | `13-CLAUDE §8.6` |

### The launch blockers that are also cost-control gaps

1. **`DAILY_AI_SPEND_KILL_USD` unarmed in prod** (L-1) — the only hard $ backstop; without it Largo is financially unbounded. **NOT VERIFIED — confirm the env var is set in Railway.**
2. **Largo non-Largo callers (Night Hawk batch) may not consult the spend ledger** (`13-CLAUDE C-6`, `15-FEATURES`) — confirm the kill-switch gates the batch `anthropicText` path too, not just Largo `query/route`.
3. **The default per-user query cap of 100/day** (`largo-budget.ts:8`) is too loose to bound the expensive tail — lower it + budget by tokens (L-3).

---

## 14. Per-issue findings (cost-model-specific)

### CM-1 · Largo is the only cost line that scales with users; everything else is flat — so cost-engineering = Largo-engineering · **High**
- **File / evidence:** `anthropic.ts:320` (Largo loop), `largo-terminal.ts:173`; vs the shared-cache-reader surfaces (`13-CLAUDE §4`); UW/Polygon flat-rate (`uw-rate-limiter.ts:12`, `polygon-largo.ts:3`).
- **Why:** The cache-reader rule pins UW, Polygon, and all non-Largo AI flat across 500/1k/5k. Largo (`anthropicToolLoop`) is the sole unbounded per-user surface, and it grows ~linearly to 5k. At 5k it's 75–95% of total cost.
- **Impact at 500 / 1k / 5k:** ~$1.6k / $3.3k / $16.4k typical; ~$13.4k / $26.9k / $134.4k heavy. The typical→heavy spread (~8–10×) is the real budgeting risk at every tier.
- **Recommended fix:** L-1 (arm kill-switch) + L-2 (caching) + L-3 (token-budget the per-user cap). These three cover ~90% of the cost-control surface.
- **Example:** caching alone at 5k ≈ −$5–8k/mo; arming the kill-switch turns an unbounded tail into a capped one.

### CM-2 · UW + Polygon are FIXED flat-rate; their "scaling cost" is a rate-budget breakpoint, not a $ overage · **Medium**
- **File / evidence:** `uw-rate-limiter.ts:12,14` (2 RPS), `polygon-rate-limiter.ts:32` (40 RPS); no per-call billing anywhere in either provider path.
- **Why:** Neither provider bills per call in the code's model — both are flat plans. The only way their $ rises is a **deliberate tier-bump** to buy RPS headroom (Polygon chain fan-out at 5k, `12-POLYGON HIGH-3`) or a streaming entitlement (UW Kafka, `11-UW §7`). Both bumps are **avoidable with engineering** (LRU+allow-list for Polygon; WS streaming for UW).
- **Impact at 500 / 1k / 5k:** Flat $375–$500 (UW) and $300–$2,000 (Polygon) at all tiers; the 5k upper bound is the *avoidable* tier-bump, not usage.
- **Recommended fix:** L-8 (Polygon fan-out fixes) + L-9 (UW streaming) keep you on the current plans at 5k.
- **Example:** without L-8, >200-ticker GEX fan-out at 5k exceeds 40 RPS → forced Massive tier-bump; with it, you stay put.

### CM-3 · The op-rate / egress / replica lines are the SECOND cost cluster at 5k — driven by the real-time tier, not data providers · **Medium**
- **File / evidence:** SSE 4 GET/s/client (`09-SCALABILITY G.1, H.1`); SSE cap 500/instance (`pulse/stream/route.ts:15`); flows 5,000-row payload (`db.ts:822`); poll fan-out (`09-SCALABILITY H.2`).
- **Why:** Compute (replicas, step-function on the SSE cap), Redis op-rate (4 GET/s/SSE client), and egress (flow payload + poll fan-out) all scale ~linearly with concurrent users. Together they're the #2 cost cluster at 5k (~$1–4k/mo combined), behind only Largo.
- **Impact at 500 / 1k / 5k:** small at 500; ~$200–960/mo combined at 1k; ~$1.0–4.2k/mo combined at 5k.
- **Recommended fix:** L-5 (SSE pub/sub fan-out — cuts Redis op-rate AND replica count) + L-7 (cap flows payload + CDN). One refactor (SSE pub/sub) hits compute + Redis together.
- **Example:** SSE pub/sub collapses 20,000 GET/s → a handful at 5k, letting you stay on a smaller Redis plan and fewer replicas.

### CM-4 · Every FIXED plan line is `NOT VERIFIED` — the total's absolute level (not its shape) hinges on 4 invoices · **High (estimate confidence)**
- **File / evidence:** UW "$375" is catalog text only (`api-provider-catalog.ts:92`); Polygon tier is a code comment (`polygon-options-gex.ts:14`); Postgres/Redis plans absent from repo (`14-INFRA §G`).
- **Why:** The FIXED lines (UW + Polygon + Postgres + Redis + base compute) are the floor of every tier's total, and all four provider/infra plans are unconfirmed. The Polygon range ($300–$2,000) alone is a $1,700/mo swing — wider than the entire shared-AI subtotal.
- **Impact at 500 / 1k / 5k:** the model's *shape and ratios* are reliable; the *absolute floor* moves with these four invoices. At 500 (where Largo is smallest) the FIXED plans are ~40–60% of total, so this uncertainty matters most at the lowest tier.
- **Recommended fix:** Pull the four invoices (UW, Massive, Railway Postgres, Railway Redis) + the Railway compute/egress rate card. Replace each range with a point. Until then, treat the lower bound as the planning floor and the upper as the budget ceiling.
- **Example:** if Massive is actually a $2,000 unlimited-real-time tier, the @500 total floor jumps ~$1,700/mo and Polygon becomes the #2 line at 500.

### CM-5 · Token estimates are char-derived, not measured — re-derive from the recordApiCall ledger before budgeting · **Medium**
- **File / evidence:** no `count_tokens` anywhere (`13-CLAUDE C-7`); usage-based post-hoc cost is accurate (`ai-spend.ts:47`) but per-user/day *rates* are assumed (active_frac 30%, 4 turns/day — `13-CLAUDE §4`).
- **Why:** Every Largo $ line depends on three assumed inputs (active fraction, turns/day, $/turn) that prod telemetry can replace with measured values. The `recordApiCall` ledger already logs every Anthropic call.
- **Impact at 500 / 1k / 5k:** the Largo line (the dominant cost) is an estimate band, not a point — and Largo is 50–85% of total, so this is the second-biggest confidence gap after the FIXED plans.
- **Recommended fix:** Query the API dashboard for real per-user Largo turn counts + token distributions; replace §4.3's assumptions. Budget by **tokens** (the heavy tail) not queries.
- **Example:** if real active_frac is 15% not 30%, every Largo figure halves; if it's 50%, they rise 1.7×.

---

## 15. Summary numbers (the headline)

| Metric | Value |
|---|---|
| **Total $/mo @ 500 / 1k / 5k (typical)** | **~$2,700–3,900 / ~$4,700–6,500 / ~$18,700–23,000** |
| **Total $/mo @ 500 / 1k / 5k (heavy Largo)** | **~$14,500–16,700 / ~$28,300–32,000 / ~$137,000–152,000** |
| **Dominant cost driver (all tiers)** | **Anthropic-Largo** (50–60% @500 typ → 75–85% @5k typ; ~90%+ heavy) |
| **#2 cost cluster @5k** | Real-time tier: Railway compute + Redis op-rate + egress (~$1–4k/mo combined) |
| **Services that DON'T scale with users** | UW (flat-rate), Polygon (flat-rate), all non-Largo AI (cache-reader), crons | 
| **Biggest single $ lever** | Largo prompt caching (L-2): −$5–8k/mo @5k |
| **Cheapest high-value lever** | GEX-explain → haiku (L-4): −$142/mo flat |
| **Hard backstop / launch blocker** | Arm `DAILY_AI_SPEND_KILL_USD` (L-1) — the only hard $ ceiling |
| **Widest uncertainty** | The 4 FIXED plan invoices (UW/Polygon/PG/Redis) + the typical-vs-heavy Largo spread |

> **All $ figures use list/published rates and char-derived token + assumed usage estimates. Every FIXED plan line is `NOT VERIFIED — needs the invoice` with a stated range. The model's shape, ratios, and the "Largo is the entire cost story" conclusion are reliable; the absolute totals will move with (1) the four real plan tiers and (2) the real Largo active-fraction and turn distribution from the `recordApiCall` prod ledger.**

### Counts (this section)
- **Critical:** 0
- **High:** 2 (CM-1 Largo dominates; CM-4 FIXED plans all unverified)
- **Medium:** 3 (CM-2 providers flat-rate/rate-bound; CM-3 real-time tier is the #2 cluster; CM-5 token estimates unmeasured)
- **Low:** 0
