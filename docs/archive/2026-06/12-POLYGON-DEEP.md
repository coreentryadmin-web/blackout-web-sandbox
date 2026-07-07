# 12 — Polygon / Massive Deep-Dive (Pass 2)

**Auditor scope:** every Polygon/Massive REST + WebSocket call in the codebase — purpose, usage pattern, request volume, caching, rate-limit exposure, latency. UNUSED endpoints we could adopt, endpoints we SHOULD add, and data we may be paying for but not using. Verdict on Polygon efficiency and what breaks at 500 / 1,000 / 5,000 users.

**Method:** grounded in real code (read `providers/polygon.ts`, `polygon-options-gex.ts` [2,444 lines], `polygon-largo.ts`, `polygon-rate-limiter.ts`, `gap-proxy.ts`, `gex-positioning.ts`, `spx-desk.ts`, `spx-play-options.ts`, `spx-lotto-options.ts`, `spx-power-hour-engine.ts`, `ws/polygon-socket.ts`, `ws/options-socket.ts`, `ws/init-data-sockets.ts`, `server-cache.ts`, `config.ts`, `cron-registry.ts`, plus the `polygon-docs-*.ts` reference catalog). Where a fact needs prod/an invoice/a plan tier to confirm, it is marked **NOT VERIFIED**.

**Builds on:** RT-5 (00-RUNTIME-FINDINGS) — `/v1/indicators/{ema,sma}` reject `I:SPX`, fixed by local MA math. Verified that fix is live in `polygon.ts:625-641` + `ma-math.ts`.

---

## 0. Plan / cost assumptions (verify before relying on RPS math)

- **Base URL:** configured via env in `providers/polygon.ts` (Polygon.io rebranded → Massive). Same key.
- **Rate ceiling used by the limiter:** `POLYGON_MAX_RPS=40`, `POLYGON_GLOBAL_MAX_RPS=40`, `POLYGON_MAX_CONCURRENCY=24`, `MIN_SPACING_MS=0` (`polygon-rate-limiter.ts:31-40`). The task brief says "~40 RPS"; the limiter agrees. **NOT VERIFIED — needs the actual Massive plan invoice/contract.** If the true ceiling is higher (Advanced plans are often effectively unmetered) we are leaving headroom on the table; if lower we are over-driving it. Everything below uses 40 RPS as the working ceiling.
- **Plan tier claimed in code:** "Massive Options Advanced plan … real-time" (`polygon-options-gex.ts:14-15`), "unlimited calls on paid plan" (`polygon-largo.ts:3`). **NOT VERIFIED — needs the plan tier.** Several scaling conclusions hinge on whether per-call billing or a hard RPS cap applies.
- **WS connection limits (from code/docs):** options Q feed `≤1000 contracts/connection`, `~10 connections` (`options-socket.ts:42-51`). Indices = a single shared connection. **NOT VERIFIED — needs the Massive WS plan limits.**

---

## 1. Complete endpoint inventory (REST)

Every distinct Polygon/Massive REST path in the codebase. "Funnel" = goes through `polygonTrackedFetch` (token bucket + circuit breaker). "Cached" = a shared/server cache collapses N users to 1 upstream.

| # | Endpoint | Caller(s) | Purpose | Funnel? | Cache (TTL) | Per-user escape risk |
|---|----------|-----------|---------|---------|-------------|----------------------|
| 1 | `/v2/snapshot/locale/us/markets/stocks/tickers/{sym}` | `fetchStockSnapshot` | single stock quote | ✅ | none here (callers cache) | low |
| 2 | `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=` | `fetchStockSnapshots`, `fetchStockSnapshotPerformance` (leaders/breadth/sectors) | batch quote | ✅ | via pulse-structure (5s) / desk (10s) | low |
| 3 | `/v2/snapshot/locale/us/markets/stocks/gainers` + `/losers` | `fetchMarketMovers` | movers | ✅ | caller-dependent | low |
| 4 | `/v3/snapshot/indices?ticker.any_of=` | `fetchIndexSnapshots/Snapshot` | SPX/VIX/VIX9D/VIX3M/TICK/TRIN/ADD batch | ✅ | desk 10s / pulse 1s / GEX spot | **medium** (every desk+pulse+GEX build) |
| 5 | `/v2/aggs/grouped/locale/us/market/stocks/{date}` | `fetchDailyMarketSummary`, `fetchPriorDayCloses` | full-market OHLC breadth | ✅ | caller | low (1–5 calls/run) |
| 6 | `/v2/aggs/ticker/{sym}/range/1/minute/{from}/{to}` | `fetchIndexMinuteBars` | SPX minute bars (VWAP/session/MA) | ✅ | pulse-structure 5s | medium |
| 7 | `/v2/aggs/ticker/{sym}/range/5/minute/...` | `fetchIndex5MinBars` | 5-min bars | ✅ | caller | low |
| 8 | `/v2/aggs/ticker/{sym}/range/1/day/{from}/{to}` | `fetchIndexDailyBars`, `fetchStockDailyBars`, `indexClosesAsc` (MA), VIX IV-rank | daily bars / MA seed | ✅ | caller + 5min VIX cache | low |
| 9 | `/v2/aggs/ticker/{sym}/range/{m}/{ts}/...` | `fetchAggBars` (Largo MTF) | multi-timeframe bars | ✅ | run-tool cache | low |
| 10 | `/v2/aggs/ticker/{sym}/prev` | `fetchPreviousDayBar` | prior bar | ✅ | caller | low |
| 11 | `/v1/indicators/{ema,sma,rsi,macd}/{sym}` | `fetchTickerEma/Rsi`, Largo `fetchPolygon{Ema,Sma,Rsi,Macd}` | indicators (STOCKS only — index rejected, RT-5) | ✅ | caller | low |
| 12 | `/v1/indicators/rsi/{I:SPX}` | `fetchIndexRsi` | index RSI (works; ema/sma do NOT — RT-5) | ✅ | desk | low |
| 13 | `/stocks/v1/short-interest`, `/stocks/v1/short-volume`, `/stocks/financials/v1/ratios`, `/stocks/v1/float` | Largo / fundamentals | reference data | ✅ | run-tool cache | low |
| 14 | `/v1/marketstatus/now` | `fetchMarketStatusNow` | RTH/extended/closed | ✅ | **60s module cache** | low |
| 15 | `/v1/marketstatus/upcoming` | `fetchMarketUpcomingStatus` | holidays | ✅ | caller | low |
| 16 | `/benzinga/v2/news` | `fetchBenzingaNews/Earnings/AnalystRatings` | news | ✅ | desk 10s / run-tool | low |
| 17 | `/v2/reference/news` | `fetchPolygonNews`, `fetchPolygonMarketNews` | news | ✅ | run-tool | low |
| 18 | `/v3/reference/tickers/{t}`, `/related`, `/v3/reference/tickers?search=`, `/dividends`, `/splits`, `/vX/reference/ipos` | Largo reference | ticker meta/search | ✅ | run-tool 5min–1h | low |
| 19 | `/v2/last/nbbo/{sym}`, `/v2/last/trade/{sym}`, `/v1/open-close/{sym}/{date}` | Largo last-quote/trade | last NBBO/trade | ✅ | caller | low |
| 20 | **`/v3/snapshot/options/{underlying}` (paginated)** | `fetchChainBand`, `fetchHeatmapBand`, `fetchPolygonIvTermStructure`, `spx-play-options`, `spx-lotto-options`, `spx-power-hour-engine` | **options chain snapshot — THE core options primitive (GEX/VEX/DEX/CHARM/max-pain/IV-term/0DTE ticket)** | ✅ | GEX heatmap 20s / 0DTE 15s / positioning 30s / IV-term 5min / NW chain cache | **HIGH — see §3** |
| 21 | `/v3/reference/options/contracts` (paginated) | `fetchPolygonOiByExpiry` | OI by expiry | ✅ | run-tool / nighthawk | medium (≤12 pages/run) |

**Finding INV-1 — every REST path funnels through the limiter EXCEPT three.** `gap-proxy.ts:24` (`fetchSpyGapPct`) and `admin-api-dashboard.ts:143` (`probePolygon`) call `trackedFetch("polygon", …)` **directly**, bypassing the token bucket AND the circuit breaker. See HIGH-2 + LOW-1.

---

## 2. WebSocket inventory

| Socket | File | URL (env) | Subscriptions | Pattern | Marginal cost / user |
|--------|------|-----------|---------------|---------|----------------------|
| **Indices** | `ws/polygon-socket.ts` | `wss://socket.massive.com/indices` | `A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M,A.I:TICK,A.I:TRIN,A.I:ADD` (7 aggregate streams, ONE connection) | one app-wide socket → `indexStore` → Redis `spx:pulse:snapshot` (30s TTL) → SSE/pulse | **ZERO** (cluster-shared) |
| **Options (Night's Watch live marks)** | `ws/options-socket.ts` | `wss://socket.massive.com/options` (env-gated `OPTIONS_WS_ENABLED`) | `Q.{OCC}` for the UNION of all open user positions, sharded ≤1000/conn × ≤10 conns | reconcile loop (30s) diffs `user_positions` → subscribe/unsubscribe → `optionMarks` + Redis `nw:optmark:` (15s) | **ZERO** (union, not per-user) |

Both are correct cache-reader architecture: one connection feeds a shared store; per-user reads never touch upstream. The indices socket is the backbone of the 1s pulse (REST `fetchIndexSnapshots` is only the fallback when the WS store is stale — `spx-desk.ts:91-93`, `mergeWsIndexSnapshots`).

**Finding WS-1 (verify) — options WS may be OFF in prod.** `optionsWsEnabled()` requires `OPTIONS_WS_ENABLED` truthy. If unset, Night's Watch marks fall back to the REST chain snapshot for **every** valuation. **NOT VERIFIED — needs the Railway env.** If off at scale, this converts a zero-cost WS into per-position REST pressure (see §3 / HIGH-1).

---

## 3. The one hot path that matters: `/v3/snapshot/options/{underlying}`

This is the single highest-volume, highest-cost Polygon surface and the only one with real scaling exposure. Everything else is either WS-fed, low-frequency, or trivially cached.

### 3a. How many upstream calls per matrix build

`fetchGexHeatmap` → `fetchHeatmapBand(root, spot, 0.04)` paginates `/v3/snapshot/options/{underlying}` at `limit=250`, `guard < 16` pages (`polygon-options-gex.ts:827-854`). So **1–16 REST calls per fresh matrix compute**, per ticker. `fetchChainBand` (0DTE desk / NW / play) uses `guard < 8`; IV-term uses `guard < 20`.

**Cost driver = number of expiries × banded strikes × 2 (call+put) ÷ 250.** For SPX `I:SPX` with the daily expiry cadence and a ±4% band, this realistically lands at **~4–10 pages per compute** (the `guard<16` is a safety ceiling, not the norm). Observe via telemetry before committing to a number — **NOT VERIFIED — needs a prod page-count sample** (the `[gex-heatmap]`/`[polygon-gex]` logs only fire on empty, so add a page-count metric, see MED-3).

### 3b. What collapses N users to 1 (the good news)

The matrix is computed ONCE and shared three ways:
1. **In-memory** `cachedHeatmaps` Map (`polygon-options-gex.ts:815`), TTL `GEX_HEATMAP_CACHE_SEC=20`s.
2. **Redis** `gex-heatmap:{ticker}` via `sharedCacheSet`.
3. **Route throttle** — `force=1` is server-throttled to 1/8s/ticker (`gex-heatmap/route.ts:180-188`).

`withServerCache` (`server-cache.ts:98-149`) adds **single-flight in-flight dedup** + Redis layer for the desk/pulse/flow lanes — so 500 simultaneous desk GETs in the same TTL window trigger **one** upstream build, not 500. **This is the architecture that makes the platform survivable.** Verified.

`getGexPositioning` / `position-context.ts` / `gex-positioning.ts` are strict CACHE-READERS over `fetchGexHeatmap` (no `forceRefresh`) — they never open a second upstream. Verified (`gex-positioning.ts:95-109`).

### 3c. Where it can still escape cache at scale

The shared cache protects the **same (ticker)** within a **TTL window**. Escapes:

- **Multi-ticker fan-out.** `fetchGexHeatmap(ticker)` and the Heat Map UI accept arbitrary tickers. Each DISTINCT ticker = its own cache key = its own 1–16-page fetch every 20s. At 500 users each viewing the same SPY/SPX → fine. At 5,000 users spread across, say, 200 distinct tickers → **200 × ~6 pages / 20s ≈ 60 chain-calls/s sustained**, which **exceeds the 40-RPS ceiling on its own** before any desk/pulse traffic. The in-memory map is bounded at 200 keys (`cachedHeatmaps.size > 200 → clear()`), so a 201st ticker also **flushes the whole hot SPY/SPX entry**, forcing an immediate recompute thrash. See HIGH-3.
- **0DTE fast-move bypass.** `fetchPolygonOdteDeskBundle` bypasses BOTH the in-memory and Redis cache when `isSpxFastMove` (SPX moved >0.5% in 5 min) (`polygon-options-gex.ts:139-167`). During a fast tape this forces a fresh `loadOdteContracts` chain fetch on **every desk build**. The desk is `withServerCache`-deduped to one build per 10s, so it's bounded to ~6 fetches/min cluster-wide — acceptable — but it stacks on top of GEX + pulse during exactly the moments the chain API is most contended. See MED-1.
- **`force=1` per ticker.** Throttled to 1/8s/ticker but NOT global — 200 distinct tickers each forcing = 25 forced chain-builds/s. See HIGH-3.
- **Night's Watch with WS off.** If `OPTIONS_WS_ENABLED` is off (WS-1), valuation falls back to the chain snapshot per (underlying, expiry). `nights-watch-warm` cron pre-warms the shared `getNwChain` cache every 60s for all open positions, so GETs are cache hits — but only for chains the cron warmed. Net new (underlying, expiry) combos between cron runs hit upstream.

---

## 4. Per-issue findings

### CRITICAL — none

No Critical findings. The shared-cache + single-flight + WS-fed architecture is fundamentally sound; nothing here hard-breaks the platform at the target tiers by itself.

---

### HIGH-1 · Night's Watch valuation has no global concurrency ceiling on the chain snapshot when WS is off
- **Severity:** High
- **File:** `src/lib/ws/options-socket.ts:35-40` (`optionsWsEnabled`), `src/lib/nights-watch/chain-cache.ts`, `src/lib/providers/polygon-options-gex.ts:47-65` (`fetchNwOptionChain`)
- **Code:** `getNwChain()` wraps `fetchNwOptionChain` in `withServerCache` keyed by (underlying, expiry); `nights-watch-warm` cron warms it every 60s. But the WS live-mark path (`OPTIONS_WS_ENABLED`) is the zero-cost path; with it off, marks come from the chain snapshot.
- **Why:** The shared chain cache collapses users on the SAME (underlying, expiry). It does NOT collapse DISTINCT (underlying, expiry) combos — and a user base holding many different tickers/expiries produces many keys. The warm cron only covers what was open at cron time.
- **Impact:**
  - **500 users:** if positions cluster on SPX/SPY 0DTE, a handful of keys; fine. If WS is on, zero cost.
  - **1,000 users:** plausibly 50–150 distinct (underlying, expiry) keys; each a 1–8-page fetch every TTL. Bounded by the 60s warm cron + 30s NW cache → manageable but climbing.
  - **5,000 users:** hundreds of distinct keys. With WS OFF this is the most likely place to saturate the 40-RPS ceiling from background warming alone.
- **Fix:** (1) **Confirm `OPTIONS_WS_ENABLED=true` in prod** (turns this into zero marginal cost). (2) Migrate the per-(underlying, expiry) chain fetch to the single-contract endpoint `/v3/snapshot/options/{underlyingAsset}/{optionContract}` (already flagged as a future optimization in `fetchNwOptionChain`'s own comment, line 46) so warming N held contracts costs N tiny single-contract calls instead of paginated band scans — or better, rely entirely on the WS union. (3) Add a cluster-wide cap on warm-cron chain fetches per run.
- **Example:** at 5,000 users holding 300 distinct (underlying, expiry) combos, a 60s warm cron doing ~3 pages each = 900 calls in one burst → 900/40 = **22.5s of solid chain traffic every minute** just to warm, blocking the desk/GEX lanes.

### HIGH-2 · `fetchSpyGapPct` bypasses the rate limiter AND the circuit breaker
- **Severity:** High (correctness of the breaker contract, not volume)
- **File:** `src/lib/providers/gap-proxy.ts:24-32`
- **Code:**
  ```ts
  const res = await trackedFetch(
    "polygon",
    "/v2/snapshot/locale/us/markets/stocks/tickers",
    `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?${qs}`,
    { headers: { Accept: "application/json" }, cache: "no-store" }
  );
  ```
  It calls `trackedFetch` directly instead of `polygonTrackedFetch`. So this premarket gap call (a) is NOT smoothed by the 40-RPS token bucket and (b) does NOT respect `isPolygonCircuitOpen()` — when the breaker is OPEN (5 consecutive 429s, 60s pause) every other Polygon caller short-circuits, but this one keeps hammering, and its 429s/connect failures don't feed `notePolygon429`.
- **Why:** Bypasses the single-funnel invariant the rate-limiter file explicitly documents ("The SINGLE Polygon REST funnel … all of it is smoothed … gated by the one reactive breaker", `polygon-rate-limiter.ts:312-318`).
- **Impact:** Low call volume today (premarket only, `resolveDeskGap`), so the **volume** impact is small at all tiers — but it pokes a hole in the breaker exactly when the cluster is already rate-limited, and at 1,000–5,000 users the premarket desk fan-out makes even a low-frequency uncapped call a liability during a Massive blip (compounds RT-2's 502 storm).
- **Fix:** Replace `trackedFetch("polygon", …)` with `polygonTrackedFetch(endpointKey, url, init)`. One-line change; reuses the existing snapshot path. Better: route gap through the already-cached `fetchStockSnapshots(["SPY"])`.
- **Example:** `const res = await polygonTrackedFetch("/v2/snapshot/locale/us/markets/stocks/tickers", \`${BASE}…?${qs}\`, { headers: { Accept: "application/json" }, cache: "no-store" });`

### HIGH-3 · GEX heatmap cache is unbounded in distinct-ticker dimension; the 200-key in-memory clear thrashes the hot entry
- **Severity:** High
- **File:** `src/lib/providers/polygon-options-gex.ts:815, 1497, 1830, 1912`
- **Code:** `if (cachedHeatmaps.size > 200) cachedHeatmaps.clear();` (full clear, not LRU eviction), repeated at every insert. Redis keys `gex-heatmap:{ticker}` have no per-ticker admission control. `force=1` throttle is per-ticker, not global (`gex-heatmap/route.ts:183`).
- **Why:** Distinct tickers each create a key + a 1–16-page upstream fetch every 20s. A `clear()` (not eviction of the oldest) wipes SPY/SPX too, forcing an immediate cold recompute of the busiest ticker.
- **Impact:**
  - **500 users:** if concentrated on SPY/SPX/QQQ, a few keys; the 200-cap is never hit; fine.
  - **1,000 users:** browsing across ~50–100 tickers — within the cap, but every 20s each distinct ticker is a fresh multi-page fetch. 100 tickers × ~6 pages / 20s ≈ **30 calls/s** baseline, ~75% of the 40-RPS ceiling, before desk/pulse.
  - **5,000 users:** >200 distinct tickers → `clear()` storms wipe the cache mid-window; SPY/SPX recompute on nearly every request → unbounded chain calls → breaker trips repeatedly → flagship desk degrades for everyone.
- **Fix:** (1) Replace `clear()` with **LRU eviction of the oldest single entry** (the `server-cache.ts` `setStoreEntry` already implements insertion-order eviction — reuse that pattern). (2) Add a **global** force throttle (not per-ticker). (3) Restrict the GEX heatmap ticker allow-list to a curated universe (SPX, SPY, QQQ, NDX, IWM, top-N) at the route, and require an explicit premium gate for arbitrary tickers. (4) Consider a `universal snapshot` batch for the curated set.
- **Example:** evict oldest: `if (cachedHeatmaps.size > 200) { const k = cachedHeatmaps.keys().next().value; cachedHeatmaps.delete(k); }`

### HIGH-4 · `spx-power-hour-engine.ts` hardcodes `legacy-polygon-host` (ignores `polygon-base-env`) AND uses wrong query-param syntax
- **Severity:** High (silent feature failure)
- **File:** `src/lib/spx-power-hour-engine.ts:164-171`
- **Code:**
  ```ts
  const url =
    `https://legacy-polygon-host/v3/snapshot/options/I:SPX` +
    `?contract_type=${optType}` +
    `&expiration_date=${exp}` +
    `&strike_price_gte=${Math.floor(minStrike)}` +   // ← underscore, not dot
    `&strike_price_lte=${Math.ceil(maxStrike)}` +
    `&limit=30` +
    `&apiKey=${process.env.POLYGON_API_KEY}`;
  ```
  Two bugs: (1) the base is hardcoded to `https://legacy-polygon-host` instead of `process.env.polygon-base-env ?? "https://market-data-api-host"` — every other file uses the env base. If the Massive key is NOT valid against `legacy-polygon-host` (it is a Massive-issued key), this returns 401/403 and the engine silently falls back to a synthetic strike. (2) Polygon's chain snapshot filter params are **dotted** (`strike_price.gte` / `strike_price.lte`) everywhere else in this codebase (`fetchChainBand:1958-1964`, `fetchHeatmapBand:836-841`). `strike_price_gte`/`strike_price_lte` (underscores) are **not recognized** → the band filter is ignored, `limit=30` returns an arbitrary 30 contracts, and the candidate filter usually finds nothing → `fallback("No qualifying near-money contract")`.
- **Why:** Copy-paste from generic Polygon docs that pre-date the Massive rebrand + the dotted-filter convention.
- **Impact:** Power-hour option ticket is **likely always serving the synthetic fallback**, not a real liquid contract — at ALL tiers (this is a correctness bug, not a scale bug). It DOES go through `polygonTrackedFetch` so it's rate-limited, but it wastes a call per power-hour build for a result that's discarded.
- **Fix:** Use `BASE` from env and dotted params, mirroring `spx-play-options.ts`:
  ```ts
  const BASE = (process.env.polygon-base-env ?? "https://market-data-api-host").replace(/\/$/, "");
  const params = new URLSearchParams({ contract_type: optType, expiration_date: exp,
    "strike_price.gte": String(Math.floor(minStrike)), "strike_price.lte": String(Math.ceil(maxStrike)),
    limit: "30", apiKey: KEY });
  const url = `${BASE}/v3/snapshot/options/I:SPX?${params}`;
  ```
- **Verify:** spot-check that power-hour returns `blocked:false` with a real `ticker` after the fix — **NOT VERIFIED at runtime here.**

### MED-1 · 0DTE fast-move cache bypass stacks chain fetches during the most-contended moments
- **Severity:** Medium
- **File:** `src/lib/providers/polygon-options-gex.ts:139-185`
- **Why:** During a >0.5%/5-min SPX move, `fetchPolygonOdteDeskBundle` skips in-memory AND Redis cache, forcing `loadOdteContracts` (a fresh `fetchChainBand("I:SPX", …)`, ≤8 pages). It IS bounded by the desk's 10s `withServerCache` dedup, so cluster-wide it's ~6 fresh chain builds/min — but it lands exactly when GEX (also potentially fast-moving) and pulse are busiest.
- **Impact:** 500/1,000: negligible (10s dedup holds). 5,000: combined with HIGH-3 ticker fan-out during a volatile open, the fast-move bypass + GEX recompute can co-occur and briefly push past 40 RPS → breaker trips → desk GEX walls blank for ~60s during a fast move (the worst time).
- **Fix:** Keep the fast-move freshness but cap it: serve cache if younger than e.g. 5s even during a fast move (a 5s-old 0DTE GEX is still actionable), and ensure the GEX-heatmap and 0DTE-desk fast-move bypasses can't both fire un-throttled in the same second.

### MED-2 · No connect-level retry/backoff; connect failures don't feed the breaker (compounds RT-2)
- **Severity:** Medium
- **File:** `src/lib/providers/polygon-rate-limiter.ts:325-347` (`polygonTrackedFetch`), all `polygonGet` wrappers
- **Why:** The breaker only counts HTTP 429 (`notePolygon429`). Connect-level failures (`UND_ERR_CONNECT_TIMEOUT`, `EHOSTUNREACH` — see RT-2) throw out of `trackedFetch` and are NOT recorded against the breaker, and there is no retry/jittered backoff. Each failed request pays the full 10s undici connect timeout.
- **Impact:** 500: a Massive blip → a wall of 10s-timeout requests on every desk/GEX/play build. 1,000/5,000: thread/connection pool exhaustion as thousands of in-flight requests each block 10s; the breaker never trips (it only sees 429s) so nothing sheds load. This is the scale-up of RT-2's single-route 502.
- **Fix:** (1) Wrap upstream fetch with a short connect timeout (2–3s) + 1 jittered retry for connect-class errors. (2) Feed connect failures into the breaker (a new `notePolygonConnectError()` that trips on N consecutive connect failures, same as 429s) so a Massive outage trips once and every caller short-circuits instead of each paying 10s. (3) Pair with RT-2's stale-serve.

### MED-3 · No page-count / chain-call telemetry — the dominant cost is unmeasured
- **Severity:** Medium (observability)
- **File:** `polygon-options-gex.ts` (`fetchHeatmapBand`, `fetchChainBand` loops); logs only fire on `0 contracts`.
- **Why:** The single biggest Polygon cost (pages per chain build × distinct tickers) is invisible. The `guard<16`/`<8`/`<20` ceilings mean a single build can silently cost up to 16/8/20 calls and we'd never know which tickers are expensive.
- **Impact:** Can't size the plan, can't predict the 5,000-user breakpoint, can't tell if a ticker is pathological. Every RPS number in this doc is consequently an estimate, not a measurement.
- **Fix:** Increment an `api_endpoint_stats`-style counter per page (the telemetry harness already exists via `trackedFetch`); emit `pages` + `contracts` per build to the admin SLA dashboard. Then re-derive §3a from real data.

### MED-4 · IV-term-structure paginates up to 20 pages of the FULL chain (all strikes, all expiries)
- **Severity:** Medium
- **File:** `src/lib/providers/polygon-options-gex.ts:2281-2321` (`fetchPolygonIvTermStructure`)
- **Why:** Unlike GEX/0DTE (which band strikes around spot), IV-term passes NO `strike_price` filter — it walks `/v3/snapshot/options/{root}` with `limit=250, guard<20` to collect every contract's IV. That's up to **20 × 250 = 5,000 contracts (≈20 calls)** per cold ticker. Cached 5 min and per-ticker-bounded, so amortized cost is low — but each cold ticker (Largo tools) is a 20-call burst.
- **Impact:** 500/1,000: a few Largo users requesting IV-term on cold tickers → occasional 20-call bursts, smoothed by the bucket. 5,000: many cold tickers → repeated 20-call bursts are a meaningful slice of the 40-RPS budget and a latency cliff (20 sequential paginated calls ≈ 2–4s wall time).
- **Fix:** Band the IV-term chain to ATM ±N% (term structure only needs near-the-money IV per expiry, not deep wings), cutting pages ~4–8×. Or adopt the `universal snapshot` / a server-side IV-term endpoint if Massive exposes one.

### LOW-1 · Admin probe bypasses the funnel (acceptable but inconsistent)
- **Severity:** Low
- **File:** `src/lib/admin-api-dashboard.ts:143` — `trackedFetch("polygon", "/v1/marketstatus/now", …)` directly.
- **Why:** Same bypass as HIGH-2 but admin-only, on-demand, single call. Harmless volume-wise; only flagged for the single-funnel invariant. Fix opportunistically with `polygonTrackedFetch`.

### LOW-2 · `marketStatusCache` / `cachedVixIvRank` / pulse-structure are MODULE-LEVEL (per-replica), not cluster-shared
- **Severity:** Low
- **File:** `polygon.ts:716` (`marketStatusCache`), `polygon.ts:675` (`cachedVixIvRank`), `spx-desk.ts` (`cachedPulseStructure`).
- **Why:** These short caches live in process memory, so each Railway replica refreshes independently. With 1 replica (current — per 00-RUNTIME) it's irrelevant. At 2–4 replicas (needed for 5,000 users) each replica multiplies these refreshes (e.g. market-status: 1 call/60s/replica).
- **Impact:** Trivial at 60s/5-min TTLs even with 4 replicas (≤4 calls/min). Flagged only so the multi-replica plan accounts for per-replica cache multiplication across ALL module-level caches (the GEX in-memory map is the one that actually matters — see HIGH-3).
- **Fix:** Already correct for the hot paths (GEX/desk use Redis via `withServerCache`/`sharedCacheSet`). For these three, the Redis-backed `withServerCache` pattern would dedup across replicas if/when they matter.

---

## 5. UNUSED Polygon/Massive endpoints we could adopt

From the `polygon-docs-*.ts` catalog (documented, not yet wired):

| Endpoint | What it gives us | Why adopt |
|----------|------------------|-----------|
| **`/v3/snapshot/options/{underlyingAsset}/{optionContract}`** (single-contract) | one contract's greeks/quote/OI in a tiny call | **Biggest win.** Replace the paginated band scan for Night's Watch warming + power-hour ticket lookup. N held contracts → N small calls instead of M paginated band scans. Already noted as a TODO in `fetchNwOptionChain` (line 46). Directly mitigates HIGH-1. |
| **Universal snapshot `/v3/snapshot`** | batch quotes across asset classes in one call | Collapse the curated GEX ticker set (SPX/SPY/QQQ/NDX/IWM) and the desk's index+stock snapshots into fewer calls. Mitigates HIGH-3. |
| **`/v3/trades/{optionsTicker}` + `/v3/quotes/{optionsTicker}`** | tick-level option trades/quotes | Real time-and-sales for Night's Watch / play fills, more precise than the NBBO mid. |
| **Options technical-indicator EMA** (`/rest/options/technical-indicators/…`) | server-side option-contract indicators | Offload per-contract MA math. |
| **Trades/Quotes WS channels (`T.`, `Q.` on stocks; `FMV`)** | fair-market-value + trades on the indices/stocks sockets | The indices socket only subscribes `A.*` aggregates today; FMV/trade channels would sharpen the live tape with zero extra connections. |

## 6. Endpoints we SHOULD add (gaps)

- **Connect-level health into the breaker** (MED-2) — not an endpoint but a breaker input.
- **Page-count telemetry** (MED-3) — instrument existing calls.
- **A curated multi-ticker GEX batch** using universal snapshot (HIGH-3).

## 7. Data we may be paying for but not using
**NOT VERIFIED — needs the Massive plan line items.** Candidates, given the code: if the plan includes **options trades/quotes (T./Q.) and FMV** we are using only `Q.` (and only for held contracts) — the broader real-time options tape is unused. If it includes **stocks WS** (`MASSIVE_WS_STOCKS` is defined in `polygon-docs-nav.ts:77` but **no client subscribes to it** — confirmed: only indices + options sockets exist), we're paying for a real-time stocks feed we poll via REST snapshots instead. Recommend reconciling the plan's included feeds against the two live sockets (indices, options) before renewal.

---

## 8. Scaling verdict — what breaks at each tier

**Are we using Polygon efficiently?** Mostly **yes** for the hot paths: the indices WS + `withServerCache` single-flight + shared GEX matrix is textbook cache-reader design — 500 users on SPX/SPY cost the same upstream as 1 user. The inefficiencies are at the **edges**: distinct-ticker fan-out (HIGH-3), unbanded IV-term (MED-4), the limiter/breaker bypasses (HIGH-2), and the broken power-hour call (HIGH-4).

| Tier | What holds | What breaks / needs change |
|------|-----------|---------------------------|
| **500 users** | Everything, IF traffic concentrates on SPX/SPY and `OPTIONS_WS_ENABLED=true`. Shared caches absorb the load; well under 40 RPS. | Fix HIGH-4 (correctness, tier-independent) and HIGH-2 (breaker hole). Confirm WS-1. No architecture change. |
| **1,000 users** | Hot paths still fine. | Distinct-ticker GEX fan-out (HIGH-3) starts to consume a large fraction of 40 RPS; add the curated allow-list + LRU eviction + global force throttle. Add page-count telemetry (MED-3) to actually size it. Verify the 40-RPS plan ceiling. |
| **5,000 users** | Only with: (a) curated GEX ticker universe, (b) WS-fed Night's Watch (HIGH-1), (c) connect-breaker + stale-serve (MED-2 / RT-2), (d) ≥2 replicas with Redis-shared caches (LOW-2). | Without those, the chain-snapshot ceiling is breached by background work alone (warming + ticker fan-out + fast-move bypasses), the 200-key `clear()` storms, and a single Massive blip becomes a cluster-wide 10s-timeout pile-up. Likely need a **plan-tier bump or a dedicated chain-snapshot micro-cache service** (one process owns the chain fetch for the curated universe; everything else reads Redis). |

**Architecture changes by tier:**
1. **Now (pre-launch):** HIGH-4 (power-hour url/params), HIGH-2 (gap-proxy funnel), confirm `OPTIONS_WS_ENABLED` (WS-1) + the 40-RPS plan ceiling.
2. **By ~1,000:** HIGH-3 (LRU + curated tickers + global force throttle), MED-3 (page telemetry), MED-4 (band IV-term).
3. **By ~5,000:** HIGH-1 (single-contract endpoint / WS-only NW marks), MED-2 (connect-breaker + stale-serve, with RT-2), multi-replica Redis-shared caches, and a likely plan bump / chain micro-cache.
