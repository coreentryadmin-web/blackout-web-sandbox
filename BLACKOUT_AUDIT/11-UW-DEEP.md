# 11 · Unusual Whales Deep-Dive (UW-DEEP)

**Auditor pass:** Pass-2 deep-dive extending the core audit (01-API, 04-DATABASE-REDIS, 05-CRON-JOBS, 07-TOOLS-INTEGRATIONS, 09-SCALABILITY, 10-PRODUCT-UX, 00-RUNTIME-FINDINGS).
**Scope:** Every UW REST endpoint + WebSocket channel the code calls; what UW offers that is unused; % of UW capability used; missed trading-intelligence opportunities; per-endpoint rate-limit / latency / caching / cost.
**Method:** READ-ONLY. Every claim grounded in a file:line I read. UW plan facts that need an invoice/account confirmation are marked **NOT VERIFIED — needs X**. No invented numbers; estimates show formula + inputs.

**Canonical files reviewed:**
`src/lib/providers/unusual-whales.ts` (1888 lines, 116 exported fetchers), `src/lib/ws/uw-socket.ts` (754 lines), `src/lib/providers/uw-rate-limiter.ts`, `src/lib/providers/uw-shared-cache.ts`, `src/lib/live-api-integrations.ts`, `src/lib/api-provider-catalog.ts`, `src/lib/cursor-api-analysis-data.ts`, `scripts/uw-docs-index.md` (the scraped OpenAPI catalog), `src/lib/largo/tool-defs.ts` + `run-tool.ts`, `src/app/api/cron/uw-cache-refresh/route.ts`, `src/lib/ws/init-data-sockets.ts`, `src/lib/providers/spx-desk.ts`, `src/lib/providers/flow-ingest.ts`.

---

## 0. Executive summary & key numbers

| Metric | Value | Source |
|---|---|---|
| UW plan tier | `advanced` ($375/mo per catalog text) | `unusual-whales.ts:27`; `api-provider-catalog.ts:92` — **NOT VERIFIED — needs invoice** for tier + exact price + whether 120/min is the real plan cap |
| Hard rate ceiling enforced in code | **2 RPS cluster-wide** (`UW_GLOBAL_MAX_RPS=2`) + 2 RPS local bucket/replica | `uw-rate-limiter.ts:12-14` |
| Documented UW REST endpoints (OpenAPI scrape) | **172** GET ops across 32 categories | `scripts/uw-docs-index.md` (counted) |
| Documented UW WebSocket channels | **13** (incl. `/api/socket` listing meta) → **12 real channels** | `uw-docs-index.md:382-399` |
| REST path-templates wired in `unusual-whales.ts` | **~90–97 distinct** (116 exported fetchers; some share a path / have v1+v2 fallbacks) | `unusual-whales.ts` (grep) |
| WS channels actually joined | **7 of 12** | `live-api-integrations.ts:7-15` |
| **% of documented REST capability wired** | **≈ 52–56%** (90–97 / 172) | derived |
| **% of REST capability that is LIVE-reachable at runtime** (not just defined) | **much lower — see §3**; the majority of wired fetchers are reachable ONLY through Largo tool-calls, not any always-on surface | `tool-defs.ts`, reachability grep §3 |
| **% of WS capability used** | **58%** (7/12) — and the 5 unused are the highest-value real-time feeds (`option_trades`, `lit_trades`, `price`, `news`) | §4 |
| UW REST calls per *user request* (steady state) | **~0** — cache-reader rule: users read Redis/in-proc, crons + WS populate | `09-SCALABILITY.md:19`; `uw-cache-refresh/route.ts` |
| UW base load (market hours) | **23 UW REST tasks / 2 min** from `uw-cache-refresh` + 1 WS multiplex/replica + per-desk-refresh fan-out | `uw-cache-refresh/route.ts:42-100`; `railway.uw-cache-refresh.toml:10` |

**Headline conclusions:**

1. **Capability utilization is breadth-wide but depth-shallow.** ~53% of REST endpoints are *wired*, but the cache-reader architecture means only a tiny hot set (tide, dark pool, NOPE, net-prem-ticks, flow-per-strike, GEX, flow-alerts) is actually exercised continuously. The other ~80 wired fetchers fire only when a Largo user asks a question that routes to them — many are effectively dormant.
2. **The biggest competitive miss is real-time WebSocket coverage.** 5 of the highest-signal channels — `option_trades` (full options tape), `lit_trades` (lit equity prints), `price`, `news` — are documented and the multiplex manager could join them with one line each, but they are not joined. Today the platform *polls* REST equivalents (flow-per-strike, net-prem-ticks every 2 min) for data UW will stream for free over the already-open socket. This is the single highest-leverage change: it both improves freshness AND removes REST calls from the scarce 2-RPS budget.
3. **Entire UW product surfaces are completely unwired** and represent net-new product opportunities: `politician_portfolios` (8 endpoints), `private_markets` (9), `crypto` (4), `forex` (3), `commodities`, `volatility/anomaly` + `vix-term-structure`, `analytics/sliding|window`, `option-trades/full-tape`, `option-trades/exchange-breakdown`, earnings-call transcripts, `stock-volume-price-levels`. See §5.
4. **The `/api/socket/news` channel + `news/headlines` REST are wired-but-deprecated-away** in favor of Benzinga (Polygon plan). The `darkpool/recent` WS (`off_lit_trades`) is the one place real-time is fully exploited well.

---

## 1. Architecture recap (verified)

```
                         ┌─────────────────────────────────────────┐
 User request ──▶ route ─┤ Redis uw_cache:* (TTL 1–60 min)         │  ← cache-reader rule
                         │ in-proc uwResponseCache (economy/tide…)  │
                         │ WS in-memory stores (tideStore, gexStore)│
                         └───────────────┬─────────────────────────┘
                                         │ miss
                    ┌────────────────────▼───────────────────────┐
   uw-cache-refresh │ uw-rate-limiter: local 2 RPS bucket +       │
   cron (*/2 min)   │ Redis-global sliding-window 2 RPS + breaker │──▶ UW REST (api.unusualwhales.com)
                    └────────────────────────────────────────────┘
   uwSocket multiplex (per replica) ─▶ wss://api.unusualwhales.com/socket ─▶ stores + Postgres flow persist
```

- **Pacing owner:** `uw-rate-limiter.ts`. Two-layer: per-process token bucket (`MAX_RPS=2`, `uw-rate-limiter.ts:12`) + Redis-global Lua sliding window (`RATE_LIMIT_LUA`, `:151-166`, `GLOBAL_MAX_RPS=2`). Circuit breaker trips at 8×429/60s for 45s (`:17-18`) and is broadcast to peers via pub/sub (`:281-287`).
- **Caching:** Redis `uw_cache:*` via `uwCacheGet` (`uw-shared-cache.ts:77`), TTLs 1–60 min (`:14-36`); plus an in-process L1 (`uwResponseCache`, `unusual-whales.ts:49`) for economy/market-tide/net-flow/group-flow/economic-calendar with stale-serve fallback when the breaker is open (`:66-80`). The two-layer overlap is intentional and documented (`:36-47`).
- **Coalescing:** `throttleUwCoalesced` dedups identical in-flight GETs on the parsed JSON (`uw-rate-limiter.ts:311`); `uwCacheGet` also has a cold-miss in-flight Map (`uw-shared-cache.ts:45`).
- **WS process model:** `ensureDataSockets()` is `initialized`-guarded once per process (`init-data-sockets.ts:44`) but is invoked from **per-request route handlers** (`market/quote`, `spx/desk`, `spx/flow`, `spx/pulse`, …) AND `instrumentation.ts` AND `spx-desk.ts`. ⇒ **one UW multiplex socket per replica.** Cross-referenced to 09-SCALABILITY C.1 and 07 I-6.

---

## 2. Inventory — UW REST endpoints CALLED by the code

The 32 documented categories map to the wired fetchers as follows. "Live-reachable" = how a runtime path reaches it (Cron = `uw-cache-refresh`; WS = streamed; Desk = `spx-desk.ts`; Largo = Largo tool-call only; FlowIngest = `flow-ingest.ts`). Caching column = the TTL the response is held at.

### 2.1 Hot path — exercised continuously (the real UW workload)

| Endpoint | Fetcher | Live-reachable via | Cache TTL | RL exposure vs 2 RPS | Notes |
|---|---|---|---|---|---|
| `/api/market/market-tide` | `fetchUwMarketTide` | Cron + WS(`market_tide`) + Desk + Largo | Redis 180s **+** in-proc L1 300s | Low (1 call/2min cron; WS primary) | Dual-cached on purpose (`:43-47`). WS keeps `tideStore` hot (`uw-socket.ts:595`). |
| `/api/darkpool/{ticker}` | `fetchUwDarkPool` | Cron (SPX/SPY/QQQ/IWM) + WS(`off_lit_trades`) + Desk + Largo | Redis 120s | Low | 4 index tickers warmed/2min; WS `off_lit_trades` populates `darkPoolStore`. |
| `/api/darkpool/recent` | `fetchUwDarkPoolRecent` | Cron + Largo | Redis 120s | Low | Market-wide prints. |
| `/api/stock/{t}/nope` | `fetchUwNope` | Cron (4 idx) + Desk + Largo | Redis 300s | Low | |
| `/api/stock/{t}/net-prem-ticks` | `fetchUwNetPremTicks` | Cron (4 idx) + Desk + Largo | Redis 60s | **Med** — 60s TTL × 4 tickers = the most-refreshed REST endpoint | "most real-time irreplaceable signal" (`uw-shared-cache.ts:21`). Candidate to move to WS `net_flow`/`price`. |
| `/api/stock/{t}/flow-per-strike-intraday` | `fetchUwFlow0dte`, `fetchUwFlowPerStrikeRows` | Cron (SPX/SPY) + Desk + Largo (heatmap 250-row) | Redis 120s | **Med** — "high-call-cost endpoint" (cron comment `:95`) | Two fetchers, **two distinct cache keys** by design (`flow_per_strike` aggregate vs `flow_per_strike_rows` array, `unusual-whales.ts:975-997`). |
| `/api/market/top-net-impact` | `fetchUwMarketTopNetImpact` | Cron + Desk + Largo | Redis 300s | Low | |
| `/api/market/{sector}/sector-tide` | `fetchUwSectorTide` | Cron (5 sectors) + Desk + Largo | Redis 180s | Low | 5 calls/2min. |
| `/api/congress/recent-trades` | `fetchUwCongressTrades` | Cron + Largo | Redis 1800s | Low | |
| `/api/option-trades/flow-alerts` | `fetchMarketFlowAlertRows`/`Alerts`/`fetchUwGlobalFlowAlerts` | **WS(`flow_alerts`) primary**, REST fallback in `flow-ingest` | in-proc 15s + Redis `uw:market_flow_alerts` | Low normally; **paginates up to 3 pages (limit 200×3)** on a cold cache miss with no ticker filter (`:563-615`) → a 3-call burst | WS is the primary writer (`flow-persist.ts`); REST only on WS-stale. |

### 2.2 Desk-only path (SPX desk refresh, `spx-desk.ts`)

| Endpoint | Fetcher | Cache | RL exposure |
|---|---|---|---|
| `/api/stock/{t}/spot-exposures/expiry-strike` | `fetchUwOdteGexLadder`→`fetchUwOdteSpotExposuresByStrike` | uncached fetcher (Polygon GEX is primary; UW is last-resort fallback, `:359-393`) | Low (fallback only; observed 503 in prod per code comment `:364`) |
| `/api/stock/{t}/greek-exposure/strike` | `fetchUwGreekExposureStrike` | uncached | Low (2nd-tier GEX fallback) |
| `/api/stock/{t}/greek-exposure/expiry` | `fetchUwGreekExposureExpiry` | uncached | Low |
| `/api/stock/{t}/max-pain` | `fetchUwMaxPain` | uncached | Low |
| `/api/stock/{t}/volatility/stats` | `fetchUwIvRank` | uncached | Low |
| `/api/stock/{t}/flow-alerts` | `fetchUwTickerFlowAlerts` | uncached | Low |
| `/api/stock/{t}/flow-per-expiry` | `fetchUwFlowPerExpiry` | Redis 120s | Low |
| `/api/net-flow/expiry` | `fetchUwNetFlowExpiry` | in-proc L1 120s | Low |
| `/api/group-flow/{group}/greek-flow[/{expiry}]` | `fetchUwGroupGreekFlow` | in-proc L1 180s | Low |
| `/api/economy/{indicator}` | `fetchUwMacroIndicators`→`fetchUwEconomyIndicator` | in-proc L1 3600s | Low (sequential, `runUwSequential`) |

### 2.3 Largo-only path (reachable ONLY via an LLM tool-call)

Roughly **70 fetchers** sit behind Largo tools and never run unless a user question routes to them through `getToolsForIntent` (`tool-defs.ts:483`). Each is a single `uwGetSafe` call, most Redis-cached. Full list collapsed by category (all `unusual-whales.ts`):

- **Greeks/GEX:** `fetchUwGexLevels`, `fetchUwGreeksByStrike`, `fetchUwGreekFlow`, `fetchUwSpotExposuresByStrike`, `fetchUwSpotExposuresExpiryStrike`, `fetchUwSpotExposuresByExpiry`.
- **Flow:** `fetchUwFlowRecent`, `fetchUwFlowPerStrike`, `fetchUwOiChange`, `fetchUwOiPerStrike`, `fetchUwOiPerExpiry`, `fetchUwOptionVolumeOiExpiry`, `fetchUwOptionsVolume`, `fetchUwOptionContracts`, `fetchUwOptionChains`, `fetchUwAtmChains`, `fetchUwOptionContractFlow`, `fetchUwOptionContractIntraday`, `fetchUwOptionContractVolumeProfile`, `fetchUwExpiryBreakdown`.
- **Vol:** `fetchUwIvTermStructure`, `fetchUwIvRankSeries`, `fetchUwInterpolatedIv`, `fetchUwRealizedVol`, `fetchUwRiskReversalSkew`.
- **Market:** `fetchUwMarketOiChange`, `fetchUwMarketMovers`★, `fetchUwMarketTotalOptionsVolume`, `fetchUwMarketCorrelations`, `fetchUwMarketSectorEtfs`, `fetchUwMarketEconomicCalendar`.
- **Screeners/predictions:** `fetchUwScreenerStocks`, `fetchUwScreenerContracts`, `fetchUwScreenerOptionContracts`, `fetchUwScreenerAnalysts`★, `fetchUwUnusualTrades`, `fetchUwPredictions{Insiders,SmartMoney,Unusual,Whales,Consensus}`.
- **Shorts:** `fetchUwShortScreener`, `fetchUwShortsData`, `fetchUwShortFloat`★, `fetchUwShortVolume`★, `fetchUwShortVolumesByExchange`, `fetchUwFtds`.
- **ETF/Institution/Insider/Congress:** `fetchUwEtf{Tide,InOutflow,Holdings,Exposure,Info,Weights}`, `fetchUwInstitution{Activity,Holdings,Ownership}`, `fetchUwInstitutionsLatestFilings`, `fetchUwInsider{Flow,Ticker,SectorFlow,Transactions}`, `fetchUwCongress{LateReports,Politicians,UnusualTrades}`.
- **Fundamentals/news/seasonality (mostly `@deprecated` → Polygon/Benzinga primary):** `fetchUwFinancials`, `fetchUwIncomeStatements`, `fetchUwBalanceSheets`, `fetchUwCashFlows`, `fetchUwFundamentalBreakdown`, `fetchUwEarnings`★, `fetchUwEarningsEstimates`, `fetchUwEarnings{Premarket,Afterhours}`, `fetchUwCompanies{Profile,Dividends★,Splits★}`, `fetchUwOwnership`, `fetchUwStockInfo`★, `fetchUwStockState`, `fetchUwOhlc`★, `fetchUwTechnicalIndicator`★, `fetchUwNewsHeadlines`★, `fetchUwMarketNewsHeadlines`★, `fetchUwSeasonality`, `fetchUwSeasonalityMarket`, `fetchUwFdaCalendar`, `fetchUwOptionPriceLevels`, `fetchUwSpotExposures`, `fetchUwLitFlow`, `fetchUwLitFlowRecent`.

★ = explicitly `@deprecated` in favor of Polygon/Benzinga (zero-rate-limit). These UW fetchers exist as fallbacks only.

---

## 3. Inventory — UW WebSocket channels CALLED by the code

| Channel | Joined? | Handler / store | Used for | `unusual-whales.ts` normalizer |
|---|---|---|---|---|
| `flow_alerts` | ✅ | `persistAndPublishFlowAlert` → Postgres `flow_events` + SSE | HELIX flow tape (primary writer) | `parseUwFlowAlert` (`:165`) |
| `market_tide` | ✅ | `tideStore` (`uw-socket.ts:457`) | desk flow lane | inline (`:595`) |
| `off_lit_trades` | ✅ | `darkPoolStore` (`:465`) | desk dark pool | `normalizeDarkPoolWsPayload` (`:747`) |
| `gex` | ✅ | `gexStore` (`:470`) | desk GEX strikes | `normalizeGexWsPayload` (`:799`) |
| `net_flow` | ✅ | `netFlowStore` (`:475`) | 0DTE net flow | `normalizeNetFlowWsPayload` (`:821`) |
| `interval_flow` | ✅ | `intervalFlowStore` (`:483`) | strike-level intraday flow | `normalizeIntervalFlowWsPayload` (`:849`) |
| `trading_halts` | ✅ | `tradingHaltsStore` + **play gates** (`:488`, `shouldBlockForTradingHalt:522`) | halt-gating live entries | `normalizeTradingHaltsWsPayload` (`:876`) |
| `option_trades` | ❌ | — | **UNUSED** | — |
| `lit_trades` | ❌ | — | **UNUSED** | — |
| `price` | ❌ | — | **UNUSED** | — |
| `news` | ❌ | — | **UNUSED** | — |
| `contract_screener` | ❌ | — | **UNUSED** | — |
| `custom_alerts` | ❌ | — | **UNUSED** | — |

WS resilience is **excellent** and worth noting as a strength: half-open stall watchdog (`reconnectIfStalled`, 75s, `uw-socket.ts:343` + `uw-socket-stall.ts:8`), auth-fail 5-min backoff (`:39`), graceful SIGTERM close=1000 to release the UW slot (`:363`), per-channel freshness tracking (`isUwChannelFresh:713`), error-frame guarding (`isUwErrorFrame:173`).

---

## 4. Capability utilization — what % of UW are we using?

**REST:** ~90–97 / 172 path-templates wired = **52–56% of documented REST surface wired.** But wired ≠ exercised. Continuously-exercised hot set (§2.1) is **~11 endpoints (~6%)**. Everything else fires only on a Largo question or desk refresh.

**WS:** 7 / 12 channels = **58%**, and the 5 unused are disproportionately valuable real-time feeds.

**Capability-weighted estimate (qualitative):** if you weight by trading-intelligence value rather than endpoint count, the platform extracts **maybe 35–45% of what an Advanced UW plan can deliver.** The flow/GEX/dark-pool/tide core is well-exploited; the entire alternative-data, real-time-tape, volatility-anomaly, and prediction-market surfaces are barely touched. This is a flat-rate plan (§7) — **every unused endpoint is paid-for capability left on the table.**

---

## 5. Issues & opportunities (per-issue blocks)

### UW-1 · Real-time `option_trades` + `lit_trades` WS channels unused — platform polls REST for streamable data · **Severity: High**

- **File / code reference:** `src/lib/live-api-integrations.ts:7-15` (joined set omits both); `uw-docs-index.md:392,397` document `option_trades` and `lit_trades`; cron polls the REST equivalents at `uw-cache-refresh/route.ts:80-99` (`net-prem-ticks` 60s, `flow-per-strike` 120s).
- **Why:** UW streams the full options trade tape (`option_trades`) and lit equity prints (`lit_trades`) over the *already-open* multiplex socket. The platform instead polls `flow-per-strike-intraday` (SPX+SPY) and `net-prem-ticks` (4 tickers) every 1–2 minutes via REST, spending the scarce 2-RPS budget on data that would arrive push-based for zero incremental rate cost. Adding these channels is one `uwSocket.subscribe(...)` block each plus a normalizer (the pattern already exists 7×).
- **Impact at 500 / 1,000 / 5,000 users:**
  - **500:** Freshness improves from 60–120s to sub-second on tape/flow; ~6 REST calls/2min reclaimed from the budget.
  - **1,000:** The reclaimed budget is the difference between comfortably under 2 RPS and bumping the cron-drain window (09-SCALABILITY C.2 — ~13s/run).
  - **5,000:** WS scales per-replica, not per-user, so a streamed tape is the only way to give every user truly live flow without REST fan-out. This is the architecturally-correct lever at scale.
- **Recommended fix:** Join `option_trades` + `lit_trades`; write `optionTradesStore` / `litTradesStore` like the existing stores; have `spx-desk` + flow tape read the stores first and fall back to REST only on staleness (mirror the `flow_alerts` WS-primary / REST-fallback split in `flow-ingest.ts`).
- **Example:**
```ts
// uw-socket.ts initUwSocket()
uwSocket.subscribe("option_trades", (payload) => {
  const rows = normalizeOptionTradesWsPayload(payload);
  if (rows.length) { lastMessageAt.option_trades = Date.now();
    optionTradesStore.rows = rows; optionTradesStore.updatedAt = Date.now(); }
});
// add "option_trades","lit_trades" to UW_WS_CHANNELS in live-api-integrations.ts
```

### UW-2 · Entire UW datasets completely unwired — net-new product surfaces left unbuilt · **Severity: High (opportunity)**

- **File / code reference:** Documented in `uw-docs-index.md` but **no fetcher exists** in `unusual-whales.ts`:
  - `politician_portfolios` — 8 endpoints (`:237-245`): per-politician portfolios, holders-by-ticker, annual disclosures. (Code uses only the older `congress/*` surface.)
  - `private_markets` — 9 endpoints (`:263-275`): pre-IPO company profiles, funding rounds, investors, pricing history.
  - `crypto` — 4 (`:77-84`): whale transactions, OHLC, pair state.
  - `forex` — 3 (`:130-136`); `commodities` — 1 (`:79`); `digital_currencies` — 2 (`:95-100`).
  - `volatility/anomaly` + `/character` + `/variance-risk-premium` + `volatility/vix-term-structure` + `volatility/anomaly/top` (`:370-379`).
  - `intel`: `analytics/sliding`, `analytics/window`, `calendar/ipo`, `companies/listings` (`:170-178`). (`get_ipo_calendar` is dispatched in run-tool but routes to a non-UW source — verify.)
  - `option-trades/full-tape/{date}`, `option-trades/exchange-breakdown/{date}`, `option-trades/optionable-tickers` (`:230-234`).
  - `stock/{t}/stock-volume-price-levels` (off/lit price levels, `:346`), `companies/{t}/transcripts/{quarter}` (earnings-call transcripts, `:64`), `congress/congress-trader` (`:71`), `institution/{name}/activity/v2` + `/sectors` (`:162-164`), `predictions/market/*` detail+liquidity+positions (`:253-259`), `alerts` + `alerts/configuration` (`:33-35`).
- **Why:** These are paid-for-but-idle. The highest-value for a 0DTE/flow product:
  - **`volatility/vix-term-structure` + `volatility/anomaly`** — directly feeds the SPX desk's vol regime; today the desk computes IV rank from `volatility/stats` only and pulls VIX term from Polygon. A native UW vol-anomaly score is a differentiated signal.
  - **`option-trades/full-tape/{date}`** — the complete day's options tape for backtesting / replay / outcome attribution (Night Hawk outcomes, win-rate). No equivalent is wired.
  - **`stock-volume-price-levels`** — off/lit volume-at-price → a true volume profile overlay for the desk levels.
  - **`politician_portfolios` / `private_markets`** — net-new alt-data products (a "Capitol Flow" or "Pre-IPO" tool) that competitors charging for UW-derived data already ship.
- **Impact at 500 / 1,000 / 5,000:** Pure upside; each is cache-warmable (slow-moving data → 30-min+ TTL) so adds negligible 2-RPS load at any scale. The constraint is product/eng time, not rate budget.
- **Recommended fix:** Prioritize `vix-term-structure` + `volatility/anomaly` (desk-relevant, low effort), then `option-trades/full-tape` (outcomes/backtest), then alt-data products (`politician_portfolios`, `private_markets`) as new tools.
- **Example:** add `fetchUwVixTermStructure()` → `uwCacheGet(redis, 'uw:vix_term', 300, …)` and surface in the desk vol lane next to the existing Polygon VIX9D/3M.

### UW-3 · Capability utilization measured ~53% REST / ~6% continuously-exercised — paid plan under-leveraged · **Severity: Medium**

- **File / code reference:** §2 + §4 above; `api-provider-catalog.ts:90-222` lists only 22 UW endpoints as "cataloged" vs 172 documented — the admin API dashboard therefore *under-reports* what UW offers, so the gap is invisible to operators.
- **Why:** The provider catalog (`api-provider-catalog.ts`) — the source for the admin "APIs" dashboard and the docs page — hand-lists 22 UW endpoints. The real wired set is ~90 and the documented universe is 172. Operators looking at the dashboard cannot see the 80-endpoint gap, so the opportunity is structurally hidden.
- **Impact:** No runtime impact; a product/visibility gap. At any user scale the under-utilization is the same $/value leak.
- **Recommended fix:** Regenerate `api-provider-catalog.ts` UW block from `uw-docs-index.md` (there is already a generator: `scripts/generate-uw-docs-catalog.mjs`), tagging each endpoint `wired | unwired | deprecated`. Surface "% capability used" on the admin dashboard so the gap is tracked.

### UW-4 · `flow-alerts` cold-miss paginates 3× (limit 200 each) — a 3-call burst against a 2-RPS budget · **Severity: Medium**

- **File / code reference:** `unusual-whales.ts:563-615` — `paginate = !ticker && desired > 200`; loops up to 3 pages of `limit:200` via raw `uwGet` (no per-page retry/stale fallback).
- **Why:** A cold cache miss on the market-wide flow feed (no ticker filter, desired>200) issues up to **3 sequential UW calls** in one logical request. At 2 RPS that is ~1.5s of the global budget consumed by a single cache-warm, and on page-2/3 failure it can `noteUw429` toward the breaker (`:588`).
- **Impact at 500 / 1,000 / 5,000:** Low normally (WS is the primary flow writer; this REST path is the fallback). But if the WS auth-fails (5-min backoff) during a high-traffic window, every replica's flow fallback can fire the 3-call burst → compounds the C.1 fail-open risk.
- **Recommended fix:** Cap fallback pagination to 1 page when the breaker has any recent 429s; or gate multi-page pagination behind market-hours + WS-down only. Confirm consumers actually need >200 market-wide alerts (the UI tape shows far fewer).
- **Example:** `const maxPages = recent429s > 0 ? 1 : 3;`

### UW-5 · `net-prem-ticks` (60s TTL × 4 tickers) is the heaviest steady REST consumer; streamable via `net_flow`/`price` WS · **Severity: Medium**

- **File / code reference:** `uw-shared-cache.ts:21` (`netPremTicks: 60`); `uw-cache-refresh/route.ts:80-84` warms 4 tickers (SPX/SPY/QQQ/IWM) every 2 min, but the 60s Redis TTL means desk reads between cron cycles trigger a live fetch.
- **Why:** 60s TTL but 120s cron cadence ⇒ a guaranteed mid-cycle expiry → on-demand UW call from whichever desk/Largo request lands in the gap. This is the single most rate-sensitive REST endpoint (labelled "most real-time irreplaceable signal" in code).
- **Impact at 500 / 1,000 / 5,000:** At 500 the mid-cycle refetch is occasional. At 1,000+ with more desk traffic, the 60s-TTL/120s-cron mismatch means near-continuous on-demand `net-prem-ticks` calls for 4 tickers → measurable budget pressure during the cron-drain window.
- **Recommended fix:** Either (a) align the cron cadence to the TTL (warm `net-prem-ticks` every 60s, or raise TTL to ≥120s), or (b) derive the same signal from the `net_flow` WS store (already joined) and drop the REST endpoint for index tickers entirely.

### UW-6 · `100001` magic `UW-CLIENT-API-ID` default duplicated in REST + WS — usage may mis-meter · **Severity: Low** (extends 07 I-13)

- **File / code reference:** `unusual-whales.ts:24` and `uw-socket.ts:42`: `process.env.UW_CLIENT_API_ID ?? "100001"`.
- **Why:** A placeholder-looking client id is hard-defaulted in two places. If UW meters the 2-RPS / 120-min budget or entitlements by client-api-id, a wrong/shared id could mis-attribute usage or throttle differently.
- **Impact:** Low directly; potentially material if `100001` is not your real id (could share a bucket). **NOT VERIFIED — needs UW account confirmation of the correct client-api-id and whether rate accounting keys on it.**
- **Recommended fix:** Centralize in `config.ts`; fail loudly (or log) if the env is unset rather than defaulting to a magic constant.

### UW-7 · UW GEX/spot-exposures observed returning 503 in prod — fallback chain is correct but un-cached · **Severity: Low**

- **File / code reference:** `unusual-whales.ts:359-393` (`fetchUwOdteGexLadder` comment: "UW spot-exposures endpoints have been observed returning 503 in production"); the ladder fetchers (`fetchUwOdteSpotExposuresByStrike`, `fetchUwGreekExposureStrike`) are **not** Redis-cached.
- **Why:** UW GEX is the *last-resort* fallback (Polygon/Massive chain is primary per memory `gex_source`), so un-cached is mostly fine. But when UW *is* hit (Polygon empty), an un-cached fetch spends a live UW call every desk refresh with no coalescing across the 503-retry attempts.
- **Impact:** Low (rare path). At 5,000 users a correlated Polygon-chain gap during a fast tape could fan these un-cached UW GEX fallbacks out, each a live call.
- **Recommended fix:** Wrap the ladder fallback in `uwCacheGet` (short TTL ~30–60s) so a Polygon outage doesn't turn into a per-replica UW GEX stampede.

### UW-8 · `news`/`news-headlines` UW surface wired but deprecated — dead UW quota reservation · **Severity: Low**

- **File / code reference:** `unusual-whales.ts:1094-1110` (`fetchUwNewsHeadlines`, `fetchUwMarketNewsHeadlines` both `@deprecated` → Benzinga); WS `news` channel unused (`live-api-integrations.ts`).
- **Why:** News is fully served by Benzinga (Polygon plan, unlimited). The UW news REST fetchers are dead fallbacks and the UW `news` WS channel is unused. No harm, but it is clutter that implies UW news is part of the budget when it should be explicitly off.
- **Impact:** None at any scale. Cleanup only.
- **Recommended fix:** Delete the deprecated UW news fetchers or annotate clearly; never join `/api/socket/news` (Benzinga owns news).

### UW-9 · No UW-specific cost/usage telemetry surfaced against the 120/min plan cap · **Severity: Medium**

- **File / code reference:** `api-tracked-fetch.ts:59` (`trackedFetch("unusual_whales", …)`) records every call to `recordApiCall`; `uwRateLimiterStats()` (`uw-rate-limiter.ts:356`) exposes tokens/inFlight/recent429s. But there is no rollup of **calls/min vs the 120/min plan cap** or **fail-open events** (when `acquireGlobalRedisSlot` returns true on Redis error, `:192`).
- **Why:** The 2-RPS bucket and 120/min cap are enforced but not *observed* against the ceiling. Operators cannot see how close to the cap they run, nor when the Redis-global ceiling silently fell open (the C.1 risk). The breaker logs only on trip.
- **Impact at 500 / 1,000 / 5,000:** Increasingly important — at 1,000+ a Redis blip that doubles UW load (C.1) is invisible until 429s appear. A "UW calls/min vs 120 cap + fail-open count" gauge is the early-warning the scaling plan needs.
- **Recommended fix:** Emit a metric from `acquireGlobalRedisSlot`'s catch (`:192`) and a per-minute UW-call counter; alarm at >80/min and on any fail-open during market hours. (Cross-ref 09-SCALABILITY C.1 fix.)

### UW-10 · `option-trades/full-tape` + `exchange-breakdown` unused — no flow backtest/replay/outcome-attribution dataset · **Severity: Medium (opportunity)**

- **File / code reference:** `uw-docs-index.md:230,233` (`full-tape/{date}`, `exchange-breakdown/{date}`); Night Hawk outcomes (`nighthawk-outcomes` cron) and win-rate UI exist but have no day-level options tape to attribute against.
- **Why:** The platform persists its *own* flow events from the WS, but has no access to UW's authoritative full day tape for backtesting plays or computing realized outcomes vs the actual tape. `full-tape/{date}` is a once-per-day pull (huge TTL) → trivial rate cost.
- **Impact:** Opportunity — would materially strengthen the win-rate / setup-stats products (a real differentiator for a paid trading tool). Zero ongoing rate pressure (1 call/day/ticker, cache forever).
- **Recommended fix:** A nightly cron that pulls `full-tape` for tracked symbols into Postgres/object storage; feed Night Hawk outcomes + a backtest tool.

---

## 6. Per-endpoint rate-limit / latency / caching / cost matrix (hot + desk paths)

Cost note: UW Advanced is **flat-rate** (no per-call billing per the catalog) — so "cost implication" is **rate-budget**, not $. The scarce resource is the 2 RPS / 120-min cap, not dollars.

| Endpoint | Refresh source | Effective freshness | Cache layer | 2-RPS budget cost | Latency sensitivity |
|---|---|---|---|---|---|
| market-tide | WS + cron 2min | sub-sec (WS) / 3min (cache) | Redis 180 + L1 300 | ~0 (WS) | Low — slow signal |
| flow-alerts | WS primary | sub-sec | in-proc 15s + Redis | 0 normally; 3-call burst on cold fallback (UW-4) | High — tape |
| net-prem-ticks | cron 2min, TTL 60s | 60–120s, mid-cycle live (UW-5) | Redis 60 | **highest steady** | High — velocity |
| flow-per-strike-intraday | cron 2min | 120s | Redis 120 (2 keys) | Med ("high-call-cost") | Med |
| darkpool/{ticker} | WS + cron 2min ×4 | sub-sec / 2min | Redis 120 | Low | Med |
| nope | cron ×4 | 5min | Redis 300 | Low | Low |
| sector-tide ×5 | cron 2min | 3min | Redis 180 | Low | Low |
| top-net-impact | cron 2min | 5min | Redis 300 | Low | Low |
| congress-recent | cron | 30min | Redis 1800 | ~0 | Low |
| spot-exposures/greek-exposure (GEX) | desk, Polygon-primary | on-demand | **none** (UW-7) | Low (fallback) | Med |
| economy/{indicator} ×3 | desk, sequential | 1hr | L1 3600 | ~0 | Low |
| group-flow greek-flow | desk | 3min | L1 180 | Low | Low |
| Largo-only (~70 fetchers) | tool-call | per-call | mostly Redis | spiky — see §3 | varies |

**Latency:** No UW endpoint is on a synchronous user-blocking path at steady state (cache-reader rule). The only user-facing UW latency is a Largo tool-call cold miss (single `uwGetSafe`, retried 2× with exp backoff, `unusual-whales.ts:234-281`) or a desk refresh that misses cache.

---

## 7. Plan/tier facts that need confirmation (NOT VERIFIED)

| Claim | Where asserted in code | Evidence needed |
|---|---|---|
| Tier = "advanced", $375/mo | `unusual-whales.ts:27`, catalog `:92` | UW invoice / account page |
| 120 calls/min plan cap | `uw-shared-cache.ts:3`, cron comments | UW plan doc — is 2 RPS == 120/min the real number? |
| 2 RPS is cluster-wide hard | `uw-rate-limiter.ts:13-14` comments | UW rate-limit policy doc |
| `UW-CLIENT-API-ID = 100001` is correct | `unusual-whales.ts:24` | UW account: real client id + whether metering keys on it |
| Kafka streaming + MCP server available on plan | `uw-docs-index.md:16-17` (`/public-api/kafka`, `/public-api/mcp`) | UW account — is Kafka/MCP entitled? It would be the **definitive** scale answer (push everything, drop REST polling) |

**Kafka note:** `uw-docs-index.md:16` advertises a **Kafka streaming** endpoint and an **MCP server**. If entitled, Kafka is the strategic answer to the 5,000-user scaling problem: a single ingest worker consumes Kafka → Redis, and *all* web replicas become pure cache-readers with zero per-replica WS fan-out (resolves 07 I-6 and the per-replica multiplex multiplication). **NOT VERIFIED — needs UW account confirmation of Kafka entitlement.**

---

## 8. What we should be using / competitive advantages we're missing

1. **Stream the tape, stop polling it (UW-1, UW-5).** Join `option_trades` + `lit_trades` + `price`; retire `net-prem-ticks` REST polling for index tickers. Free freshness + reclaimed budget. **Do first.**
2. **Add the vol-intelligence surface (UW-2).** `vix-term-structure` + `volatility/anomaly` + `variance-risk-premium` are desk-relevant, slow-moving (cache 5min), and differentiate the SPX desk vol lane. **Low effort, high signal.**
3. **Build the backtest/outcome dataset (UW-10).** Nightly `option-trades/full-tape` → outcome attribution for Night Hawk + win-rate. A paid trading tool that can show *realized* edge against the real tape is a durable advantage.
4. **Ship an alt-data product (UW-2).** `politician_portfolios` (8 eps) and/or `private_markets` (9 eps) are entirely unbuilt — net-new tools on already-paid data.
5. **Make capability visible (UW-3, UW-9).** Regenerate the provider catalog to all 172 endpoints with wired/unwired tags; surface "UW calls/min vs 120 cap" + fail-open count on the admin dashboard so the gap and the C.1 ceiling risk are observable.
6. **Investigate Kafka entitlement (§7).** If available, it is the cleanest path to 5,000 users — single ingest, zero per-replica fan-out.

---

## 9. Cross-references to the core audit (do not duplicate; this section extends)

- UW 2-RPS fail-open on Redis loss → **09-SCALABILITY C.1**, **07 I-1**. My UW-4/UW-5/UW-9 add the specific endpoints that amplify it and the missing telemetry.
- Singleton per-replica WS → **07 I-6**, **09 §17-18**. My UW-1 + §7 Kafka note give the architectural fix (stream-to-Redis ingest worker).
- Cron contention (~23–26 tasks, ~13s drain) → **09 C.2**. My UW-5 identifies `net-prem-ticks` TTL/cadence mismatch as a contributor; cron task count verified = **23 UW tasks/run** (5 sector + 12 index-triple + 2 flow-strike + 4 singletons; `uw-cache-refresh/route.ts:42-100`, the movers task is Polygon).
- `ws` package / `as unknown as string[]` cast → **07 I-15**. Unchanged; still a latent UW-WS-auth-drop risk.
- `UW_CLIENT_API_ID 100001` → **07 I-13**. My UW-6 restates with the metering-confirmation ask.

---

## 10. Severity roll-up (this section only)

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 2 | UW-1 (stream option/lit trades), UW-2 (unwired datasets) |
| Medium | 5 | UW-3 (utilization visibility), UW-4 (flow-alerts 3-call burst), UW-5 (net-prem-ticks TTL), UW-9 (no cap telemetry), UW-10 (no full-tape backtest set) |
| Low | 3 | UW-6 (client-id default), UW-7 (uncached GEX fallback), UW-8 (dead UW news) |

**Top recommendation:** UW-1 — join `option_trades` + `lit_trades` (and `price`) WS channels. It is the highest-leverage change: better freshness, reclaimed 2-RPS budget, and the only architecturally-correct way to serve live tape to 5,000 users. One subscribe-block + normalizer each, following the 7 existing patterns.
