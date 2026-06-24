# BLACKOUT — Master API Reference & Rate-Limit Master Plan

> **Status:** Canonical, docs-grounded. This file is the single source of truth for our market-data
> API surface. It supersedes the messy internal docs (`api-provider-catalog.ts`,
> `cursor-api-analysis-data.ts`, and the `/docs/polygon/*` + `/docs/...` pages) — **those should be
> regenerated from this file**, not edited independently.
> **Method:** Synthesized from five docs-grounded section audits under
> `blackout-web/BLACKOUT_AUDIT/API-DOCS/` (massive-stocks, massive-options, massive-indices, uw-rest,
> websockets), each read **line-by-line from the official provider docs** — never inferred from our
> code comments (that exact mistake caused incident **RT-5**).
> **Audited:** 2026-06-24. **Plan posture:** Massive **Advanced** (Stocks + Options + Indices, with
> Financials & Ratios entitlement); Unusual Whales **Advanced**.
> Anything not confirmable from a rendered doc page is tagged **`NOT VERIFIED — needs <doc/probe>`**.

---

## 1. Overview

### Providers, base URLs, auth

| Provider / surface | REST base | WS base | Auth | Env key |
|---|---|---|---|---|
| **Massive Stocks** (Equities Advanced) | `https://api.massive.com` | `wss://socket.massive.com/stocks` | `apiKey` query / Bearer; WS legacy `auth` frame | `POLYGON_API_KEY` / `POLYGON_API_BASE` |
| **Massive Options** (Options Advanced) | `https://api.massive.com` | `wss://socket.massive.com/options` | same as above; FMV cluster `/business/options/FMV` | `POLYGON_API_KEY` |
| **Massive Indices** (Indices Advanced) | `https://api.massive.com` | `wss://socket.massive.com/indices` | same; WS auth with `POLYGON_API_KEY` first | `POLYGON_API_KEY` |
| **Unusual Whales** (Advanced) | `https://api.unusualwhales.com` | `wss://api.unusualwhales.com/socket?token=<TOKEN>` | `Authorization: Bearer <token>` + `UW-CLIENT-API-ID: 100001`, **GET-only** | UW token env |

> **Auth caveat (RT-class):** The Massive **WS** connect→`auth`→`auth_success` handshake we implement
> (`polygon-socket.ts` / `options-socket.ts`) is the **legacy Polygon protocol** and is **NOT in the
> Massive docs** (no WS auth/getting-started page exists in `llms.txt`). It works empirically.
> **NOT VERIFIED — needs a Massive WebSocket getting-started/auth doc or a live probe.**

### At-a-glance utilization

Utilization = cleanly-used endpoints/channels ÷ documented surface. "Used" counts only endpoints we
call for that asset class (e.g. an aggregate path used for stocks but not options counts as unused for
options). Path-mismatched calls are excluded from "clean used."

| API surface | Documented (REST + WS) | Used (clean) | Utilization | Notes |
|---|---|---|---|---|
| **Massive Stocks** | 30 (23 REST + 7 WS) | 15 | **~50%** | ~57% if 2 path-mismatched calls count as used; 0 of 7 stocks-WS channels used. |
| **Massive Options** | 20 (15 REST + 5 WS) | 6 | **~30%** | Only Q-WS of 5 channels; chain snapshot is the GEX backbone. |
| **Massive Indices** | 16 (13 REST + 3 WS) | 9 | **~56%** | Indicators are the RT-5 fix; `V` (Value) WS unused. |
| **Unusual Whales** | ~123 (~109 REST + 14 WS) | ~82 (~75 REST + 7 WS) | **~65–70%** | Far broader than assumed; gap is WS + a few vol/greek endpoints, not breadth. |
| **— WS subtotal (Massive in-scope + UW)** | 30 (16 Massive + 14 UW) | 10 (3 Massive + 7 UW) | **~33%** | Massive WS ~19%; UW WS 50%. |

> **NOT VERIFIED:** the UW surface count (~123) is from the docs *category index*; several rows render
> JS-only, so the exact endpoint total and a handful of paths are `NOT VERIFIED — needs OpenAPI/category
> page render or live probe`.

---

## 2. Clean USED / UNUSED reference

Legend: ✅ USED · ⬜ AVAILABLE-UNUSED · ❓ NEEDS-PLAN/ACCESS or PATH-MISMATCH.

### 2.1 Massive STOCKS (`wss://socket.massive.com/stocks`)

| Endpoint / Channel | Used? | What we use it for / Why unused | Recommendation |
|---|---|---|---|
| `GET /v2/aggs/ticker/{t}/range/{m}/{ts}/{from}/{to}` (Custom Bars) | ✅ | 1m/5m/1d bars (polygon.ts:441/450/464/473) | Keep; multi-day/other timespans unused for backtests. |
| `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` (Daily Market Summary) | ✅ | All-US OHLCV+VWAP one date (polygon.ts:203) | Keep. |
| `GET /v1/open-close/{t}/{date}` (Daily Ticker Summary) | ✅ | Open/close + preMarket/afterHours | Keep — gap logic. |
| `GET /v2/aggs/ticker/{t}/prev` (Previous Day Bar) | ✅ | Prior session OHLC | Keep. |
| `GET /v2/snapshot/locale/us/markets/stocks/tickers` (Full Market Snapshot) | ✅ | Subset snapshot (polygon.ts:131/151) | Keep; full-market scan is one call (Opp). |
| `GET /v2/snapshot/.../tickers/{t}` (Single Snapshot) | ✅ | Per-ticker trade+quote+min/day (polygon.ts:108) | Keep. |
| `GET /v2/snapshot/.../{direction}` (Top Movers) | ✅ | Top-20 gainers/losers (polygon.ts:300/303) | Keep. |
| `GET /v3/snapshot` (Unified Snapshot) | ⬜ | Cross-asset, `ticker.any_of` ≤250 | **OPP** — co-snapshot SPX+basket+options in one call. |
| `GET /v3/trades/{t}` (Tick Trades) | ⬜ | Tick tape + condition codes | **OPP** — own equities sweep/block/dark classifier off the UW 2 RPS bottleneck. |
| `GET /v3/quotes/{t}` (NBBO history) | ⬜ ❓ | NBBO bid/ask history | **OPP** — microstructure panel; Advanced-gated (we qualify). |
| `GET /v2/last/trade/{t}` (Last Trade) | ✅ | Latest trade | Keep. |
| `GET /v2/last/nbbo/{t}` (Last Quote) | ✅ | Latest NBBO; **gates Advanced** | Keep. |
| `GET /v1/indicators/{ema,sma,rsi,macd}/{t}` | ✅ | TA (polygon.ts:500/511/638/657/693) | Keep. |
| `GET /v3/reference/tickers` (All Tickers) | ✅ | Ticker search | Keep. |
| `GET /v3/reference/tickers/{t}` (Ticker Overview) | ⬜ | Shares out/float/mktcap/logo | **OPP** — richer cards; replaces a UW round-trip. |
| `GET /v3/reference/tickers/types` | ⬜ | Type enum | Low value; reference only. |
| `GET /v1/related-companies/{t}` | ⬜ | Peers (news + corr) | **OPP** — "peers also moving" rail, free on plan. |
| `GET /stocks/v1/dividends` (Dividends) | ❓ | We call `/v3/reference/dividends` (polygon-largo.ts:429) | **PATH MISMATCH** — live-probe both; may 404. |
| `GET /stocks/v1/splits` (Splits) | ❓ | We call `/v3/reference/splits` (polygon-largo.ts:453) | **PATH MISMATCH** — live-probe. |
| `GET /vX/reference/ipos` (IPOs) | ⬜ | IPO/listing calendar | **OPP** — "new tradables" feed for Night Hawk. |
| `GET /stocks/financials/v1/ratios` | ✅ | Valuation ratios (polygon.ts:559); gates Advanced/F&R | Keep. |
| `GET /stocks/v1/short-interest` | ✅ | FINRA bi-weekly SI (polygon.ts:524) | Keep. |
| `GET /stocks/v1/short-volume` | ✅ | Daily short-sale vol (polygon.ts:583) | Keep; per-venue/exempt fields underused. |
| `GET /stocks/financials/v1/{income,cash-flow,balance}` | ⬜ | Fundamentals statements | Low priority for a flow platform; skip. |
| `GET /v1/marketstatus/now` | ✅ | Live session status (polygon.ts:757) | Keep (60s cache). |
| `GET /v1/marketstatus/upcoming` | ✅ | Holiday/early-close | Keep. |
| `GET /v3/reference/exchanges` | ⬜ | Exchange directory | **OPP** — decode tape/exchange IDs (prereq for tick classifier). |
| `GET /v3/reference/conditions` | ⬜ | Trade/quote condition dictionary | **Prereq** for tick-trades classifier (dark/odd-lot/ISO). |
| `GET /v2/reference/news` (News) | ✅ | Articles + per-ticker sentiment (polygon-largo.ts:157/342) | Keep. |
| `GET /benzinga/v2/news` | ❓ | Called (polygon.ts:397) — **not in Stocks docs index** | **Probe**; migrate to `/v2/reference/news` if dropped. |
| WS `T` Trades · `Q` Quotes · `AM` 1-min · `A` 1-sec | ⬜ | Not used on stocks cluster (T/Q used on options/index) | **OPP** — push aggregates replace polled minute-bar REST; live equities tape. |
| WS `FMV` (`/business/stocks/FMV`) | ❓ | Business-only | NEEDS-PLAN — not on Advanced. |
| WS `NOI` (Net Order Imbalance) | ❓ | Imbalances Expansion add-on only | NEEDS-PLAN — MOC/LOC close alpha; flag for purchase. |
| WS `LULD` | ⬜ | Halt/limit-band stream — on our Advanced tier | **OPP** — cleaner equities halt source than UW. |

### 2.2 Massive OPTIONS (`wss://socket.massive.com/options`)

| Endpoint / Channel | Used? | What we use it for / Why unused | Recommendation |
|---|---|---|---|
| `GET /v3/snapshot/options/{underlying}` (Chain Snapshot) | ✅ | **GEX backbone** (polygon-options-gex.ts:844, spx-play/lotto/power-hour); greeks+IV+OI+quotes inline, limit ≤250 | Keep. Confirm we read greeks/IV/OI off payload, not recompute. |
| `GET /v3/snapshot/options/{u}/{contract}` (Contract Snapshot) | ⬜ | Per-contract greeks/IV/OI/mark | **HIGH-VALUE GAP** — Night's Watch live mark; our own code calls it a "future optimization" (polygon-options-gex.ts:45) but never wired. |
| `GET /v3/snapshot` (Unified) | ⬜ | ≤250 mixed tickers w/ greeks inline | **HIGH-VALUE GAP** — collapses per-position REST fan-out into one call. |
| `GET /v3/reference/options/contracts` (All Contracts) | ✅ | Contracts ref (cursor-api-analysis-data.ts:444/450); `as_of` for backtests | Keep. |
| `GET /v3/reference/options/contracts/{t}` (Contract Overview) | ⬜ | Metadata + `shares_per_contract` | Low priority — guards adjusted-multiplier GEX corruption. |
| `GET /v2/aggs/.../{optionsTicker}/...` (Custom Bars / prev / open-close) | ⬜ | Used for stocks/indices, not `O:` tickers | **OPP** — per-contract intraday chart + EOD valuation for Night's Watch. |
| `GET /v2/last/trade/{optionsTicker}` | ⬜ | Used for stocks, not options | **OPP** — light last-print mark; WS-quiet fallback (RT-1). |
| `GET /v3/trades/{optionsTicker}` (Tick) | ⬜ | Server-side time & sales (hist to 2014) | **OPP** — fill reconstruction; **404 in our probe** (docs/polygon/rest/options:121) — re-probe with URL-encoded `O:`. |
| `GET /v3/quotes/{optionsTicker}` (NBBO hist) | ⬜ ❓ | Advanced-only; hist to 2022-03 | Spread-history; same 404-probe caveat. |
| `GET /v1/indicators/{sma,ema,macd,rsi}/{optionsTicker}` | ⬜ | Used for stocks/indices, not options | Low priority — option-price TA is noisy. |
| `GET /v1/marketstatus/{now,upcoming}` | ✅ | Session status (shared) | Keep. |
| `GET /v3/reference/conditions` | ⬜ | Decode trade `c[]` conditions | **OPP** — drop odd-lot/multi-leg prints from GEX/flow volume. |
| `GET /v3/reference/exchanges` (options) | ⬜ | Label `x` IDs | Low priority. |
| WS `Q.<OCC>` (Quotes) | ✅ | Night's Watch live marks (options-socket.ts:292); reads `bp/ap` | Keep; 1000/conn cap respected. |
| WS `T.<OCC>` (Trades) | ⬜ | Live prints + conditions | **HIGH-VALUE GAP** — true last-trade marks + sweep detection; **fixes RT-1** (distinguish "no quotes" vs "no trades"). |
| WS `AM.<OCC>` (1-min aggs) | ⬜ | Live 1-min option bars | **OPP** — sparklines/volume-surge without REST polling. |
| WS `A.<OCC>` (1-sec aggs) | ⬜ | Live 1-sec bars (heavy) | Lower priority — power-hour 0DTE only. |
| WS `FMV.<OCC>` (`/business/options/FMV`) | ❓ | Business-only synthetic mid | NEEDS-PLAN — best mark for illiquid SPXW; out of plan on Advanced. |

### 2.3 Massive INDICES (`wss://socket.massive.com/indices`)

| Endpoint / Channel | Used? | What we use it for / Why unused | Recommendation |
|---|---|---|---|
| `GET /v1/indicators/sma/{indicesTicker}` | ✅ | Server SMA on `I:` (polygon.ts:657) — RT-5 fix | Keep. Fix stale "unsupported" comment in `ma-math.ts`. |
| `GET /v1/indicators/ema/{indicesTicker}` | ✅ | Server EMA (polygon.ts:500/638) | Keep (primary; bars-math fallback OK). |
| `GET /v1/indicators/rsi/{indicesTicker}` | ✅ | Server RSI (polygon.ts:693) — but **not** in spx-play-technicals (hand-rolled) | Route SPX-play 5m RSI through `fetchIndexRsi('I:SPX',14,'minute')`. |
| `GET /v1/indicators/macd/{indicesTicker}` | ✅ | Used for Largo; **not** on SPX desk | **OPP** — add MACD to SPX desk momentum panel. |
| VWAP (no indices endpoint) | ✅ | Derived from bars (polygon.ts:670) | Correct — no `/v1/indicators/vwap` exists for indices. |
| `GET /v3/snapshot/indices` | ✅ | Desk spot source (polygon.ts:352); `timeframe` field = runtime plan guard | Keep. |
| `GET /v3/snapshot` (Unified) | ⬜ | Cross-asset hydrate | **OPP** — `I:SPX` value + option chain + SPY in one call. |
| `GET /v2/aggs/ticker/{indicesTicker}/range/...` (Custom Bars) | ✅ | Minute/daily bars (VWAP, desk) | Keep. Indices bars have **no `v`/`vw`**. |
| `GET /v2/aggs/ticker/{indicesTicker}/prev` | ✅ | Prev-close source | Keep. |
| `GET /v1/open-close/{indicesTicker}/{date}` | ✅ | Single-day OHLC | Keep. |
| `GET /v3/reference/tickers?market=indices` | ⬜ | Used for stocks/options, not `market=indices` | **OPP** — auto-discover index universe (sector sub-indices, breadth internals). |
| `GET /v3/reference/tickers/{ticker}` (index) | ⬜ | Used for equities, not `I:` | Minor — desk label metadata. |
| `GET /v1/marketstatus/now` (`indicesGroups`) | ✅ | Status (admin-api-dashboard.ts:145) — but only top-level `market` read | **OPP** — gate on `indicesGroups.s_and_p`. |
| `GET /v1/marketstatus/upcoming` | ✅ | Holiday schedule | Keep. |
| WS `A.I:TICKER` (1-sec) | ✅ | Desk pulse (polygon-socket.ts:109): SPX/VIX/VIX9D/VIX3M/TICK/TRIN/ADD | Keep (Advanced+). |
| WS `AM.I:TICKER` (1-min) | ✅ | Passive fallback (spx-broadcaster.ts:92) | Keep. |
| WS `V.I:TICKER` (Value) | ⬜ | **NOT subscribed** — true tick-by-tick value | **OPP (highest)** — removes sub-second lag + reconnect bar-gap; we already pay for it. |

### 2.4 Unusual Whales (`https://api.unusualwhales.com`)

Breadth is high; the table lists the **gaps + WS** (everything else is ✅ used — see uw-rest.md for the full per-endpoint list of ~75 used REST functions across GEX, OI, flow, dark-pool, congress/insider/institution, shorts, ETF, fundamentals).

| Endpoint / Channel | Used? | What we use it for / Why unused | Recommendation |
|---|---|---|---|
| GEX (spot/strike/expiry families) | ✅ | `fetchUwGexLevels`, spot-exposures, greek-flow, greek-exposure/{strike,expiry} | Keep. |
| `/api/stock/{t}/greek-exposure` (full series) | ⬜ | Delta/gamma/vega across chain | **OPP** — vanna/charm dealer-positioning panel. |
| `/api/stock/{t}/greek-exposure/expiry/strike` (matrix) | ⬜ | Strike×expiry greek surface (path NOT VERIFIED) | **OPP** — true 0DTE-vs-back-month dealer split. |
| Volatility: IV-rank, realized, term-structure, skew, interpolated-IV | ✅ | `fetchUwIvRank`, `fetchUwRealizedVol`, `fetchUwIvTermStructure`, etc. | Keep. |
| Variance Risk Premium / Vol Anomaly Score / Vol Character / VIX Term Structure | ⬜ | NOT VERIFIED — needs Volatility docs page | **OPP** — premium-selling + regime signals; "vol movers" board. |
| Flow/Tape (flow-alerts, per-strike/expiry, net-prem-ticks, NOPE, contract flow) | ✅ | HELIX core (`fetchMarketFlowAlertRows` + family) | Keep. |
| Full Tape `/api/option-trades/full-tape/{date}` | ❓ | Historical add-on ($250/mo per docs) | **OPP** — backtest replay; probe access. |
| OI families (oi-change/per-strike/per-expiry, chains, atm, greeks, max-pain) | ✅ | `fetchUwOiPerStrike` + family | Keep. |
| Off/Lit Price Levels | ⬜ | NOT VERIFIED — needs Stock docs page | **OPP** — lit-vs-dark magnet map alongside GEX walls. |
| Market/Tide/NetFlow (market-tide, sector-tide, net-flow, top-net-impact, calendars) | ✅ | `fetchUwMarketTide` + family | Keep. |
| Dark pool / lit flow | ✅ | `fetchUwDarkPool`, `fetchUwLitFlow` | Keep. |
| Screeners + Unusual Trades | ✅ | `fetchUwScreener*`, `fetchUwUnusualTrades` | Keep; aggregate-stats unused (OPP — daily heat summary). |
| Congress / Insider / Institution / Predictions | ✅ | `fetchUwCongress*`, `fetchUwInsider*`, `fetchUwInstitution*` | Keep. |
| Earnings/Companies/Fundamentals/Shorts/ETF/News/Economy | ✅ | broad coverage; many are Polygon/Benzinga-deprecated fallbacks | Keep as fallbacks. |
| Alerts + Alert configurations | ⬜ ❓ | Paths NOT VERIFIED; configs may need account scope | **OPP** — bridge user UW alerts into BlackOut personalized-alerts. |
| Crypto / Forex / Commodities / Private Markets | ⬜ | Out of scope for SPX/options product | Skip. |
| WS `flow_alerts` / `market_tide` / `off_lit_trades` / `gex` / `net_flow` / `interval_flow` / `trading_halts` | ✅ | HELIX writers (uw-socket.ts) | Keep. **Wire-name gotcha** below. |
| WS `option_trades` (`:TICKER`) | ⬜ | Raw 6–10M/day tape | **OPP (biggest)** — own sweep/block rules; resolve `flow-alerts.trade_ids`. |
| WS `gex_strike` / `gex_strike_expiry:SPX` | ⬜ | Native per-strike dealer gamma w/ bid/ask-side | **OPP (top)** — replaces self-computed GEX walls; 0DTE/monthly split. |
| WS `price:TICKER` | ⬜ | UW-native live underlying | **OPP** — time-aligned price+flow on one socket. |
| WS `news` (`is_trump_ts`) | ⬜ | Live headlines incl. Truth Social | **OPP** — catalyst tape; high-signal/low-volume. |
| WS `lit_trades` | ⬜ | Live lit equity prints | **OPP** — lit-vs-dark ratio with off_lit. |
| WS `contract_screener` | ⬜ | Live hot-contracts (Greeks + OI-growth) | **OPP** — shippable screener without REST polling. |
| WS `custom_alerts` | ⬜ | Per-user alert stream | OPP (internal/desk only — per-token, can't fan out). |

---

## 3. Top missed-data opportunities (ranked)

| # | Unused endpoint / channel | Provider | BLACKOUT feature it unlocks |
|---|---|---|---|
| 1 | **UW WS `gex_strike` / `gex_strike_expiry:SPX`** | UW | Native per-strike dealer gamma walls (bid/ask-side attribution + 0DTE-vs-monthly split) — replaces/validates self-computed GEX walls. Single highest-value SPX-desk add. |
| 2 | **UW WS `option_trades:SPX` (+ `:SPY`)** | UW | Raw 6–10M/day print tape → our OWN sweep/block/repeat-hit rules, exact-time sweep reconstruction, and resolution of `flow-alerts.trade_ids`. |
| 3 | **Massive options Unified Snapshot `GET /v3/snapshot` (`any_of` ≤250)** | Massive | Batch greeks+IV+OI+quote for 250 mixed tickers in ONE call — collapses Night's Watch per-position REST fan-out; biggest rps/latency win. |
| 4 | **Massive options WS `T.<OCC>` (Trades)** | Massive | Live option prints + conditions → true last-trade marks + aggressor/sweep; **directly fixes RT-1** stall-watchdog false-fire (distinguish "no quotes" vs "no trades"). |
| 5 | **Massive indices WS `V.I:SPX` / `V.I:VIX` (Value)** | Massive | True tick-by-tick SPX/VIX value vs 1-sec-bar `c` derivation — removes sub-second lag + reconnect bar-gap on the pulse/desk. Already on Advanced. |
| 6 | **UW Greek Exposure By Strike & Expiry (+ full greek-exposure series)** | UW | Full delta/vega/vanna/charm surface (we only have spot gamma) → dealer-positioning desk panel. |
| 7 | **Massive options Contract Snapshot `GET /v3/snapshot/options/{u}/{contract}`** | Massive | Per-held-contract greeks/IV/OI/mark in one cheap call — Night's Watch live valuation + WS-quiet fallback. Our own code flags it as a "future optimization." |
| 8 | **UW VIX Term Structure + Variance Risk Premium / Vol Anomaly Score / Vol Character** | UW | Contango/backwardation regime flag + premium-selling/mean-reversion signals + daily "vol movers" board. |
| 9 | **Massive stocks WS `LULD` (+ `T`/`Q` tape, `/v3/trades`, `/v3/reference/conditions`)** | Massive | Second independent halt/volatility-band signal (de-risks single-source `trading_halts` fail-closed gate) **and** our own equities sweep/block/dark classifier off the UW 2-RPS bottleneck. |
| 10 | **UW WS `news` (`is_trump_ts`) + `contract_screener` + `price:SPY`** | UW | Real-time catalyst tape (Truth Social filter), live hot-contracts screener, and UW-native time-aligned underlying on the flow socket. |

> Gated (confirm plan first): Massive **FMV** (Business — clean synthetic mid for illiquid SPXW strikes),
> Massive **NOI** (Imbalances Expansion — MOC/auction-imbalance close edge), UW **Full Tape** ($250/mo add-on).

---

## 4. RATE-LIMIT MASTER PLAN

### 4.1 Consolidated documented limits → our enforcement

| Limit (documented unless noted) | Provider / scope | Source confidence | Our enforcement | Status |
|---|---|---|---|---|
| **2 req/s cluster cap (~120/min)** | UW REST (whole cluster) | Self-imposed; matches *rumored* UW ceiling | `uw-rate-limiter.ts` `UW_MAX_RPS=2` | ✅ enforced |
| **120 req/min default, tiered** | UW REST | **NOT VERIFIED — needs live `x-uw-*` header probe** | (our 2 RPS = ~120/min, at the rumored ceiling) | ⚠️ probe to confirm |
| Headers `x-uw-minute-req-counter` / `-remaining` / `-reset` | UW REST | **NOT VERIFIED — needs probe** | not read today | ⚠️ adopt (read off any 200) |
| `403` = plan-blocked | UW REST | docs/code behavior | `uwGetSafe` → null + `PLAN_BLOCKED` log | ✅ handled |
| **~40 req/s** | Massive REST (all products) | **Self-imposed — NOT a documented Massive number** | `polygon-rate-limiter.ts` ~40 rps | ✅ enforced (well under ~100/s guidance) |
| Free ≈ 5 req/min; paid "unlimited," recommend **<~100 req/s** | Massive REST | **NOT VERIFIED (exact wording)** — KB search snippet only, article body JS-rendered | our ~40 rps sits under the ~100/s guidance | ⚠️ confirm KB article |
| **1,000 option contracts per WS connection** | Massive Options WS (Q/T/AM/A/FMV) | **DOC-VERIFIED (verbatim)** | `options-socket.ts` `MAX_CONTRACTS_PER_CONN=1000` | ✅ DOC-CORRECT |
| **`MAX_CONNECTIONS=10` per key** (options pool) | Massive WS | **NOT VERIFIED — folklore; no doc** | `options-socket.ts:48` | ⚠️ probe before scaling past 10 shards |
| WS stocks/indices connection & symbol caps | Massive WS | **NOT VERIFIED — no per-cluster limits page** | none enforced | ⚠️ needs WS limits page/probe |
| REST page maxima: chain snapshot 250; `any_of` 250; contracts ref 1000; aggs/trades/quotes 50000; RSI 5000 | Massive REST | **DOC-VERIFIED** | used to minimize call counts | ✅ |
| `option_trades` throughput **6–10M records/day** | UW WS | **DOC-VERIFIED (verbatim)** | n/a (unused) — use `:TICKER` form when adopting | ⚠️ scope to SPX/SPY |
| WS heartbeat / keepalive / close codes | Massive **and** UW WS | **NOT documented anywhere** | empirical watchdog + `1008/4401/4403=auth`, `1006=transient` | ⚠️ NOT VERIFIED — probe |
| WS auth handshake | Massive WS | **NOT documented** (legacy Polygon `auth`→`auth_success`) | works empirically | ⚠️ NOT VERIFIED — probe |
| UW WS plan gate: **Advanced only** | UW WS | **DOC-VERIFIED (verbatim)** | we are Advanced | ✅ |

### 4.2 Mapping past incidents → doc-grounded fix

**RT-1 — Options WS stall / keepalive (watchdog false-fires on quiet contracts):**
- **What the docs say:** Massive WS docs contain **no heartbeat, no keepalive, no close-code page** anywhere
  (`NOT VERIFIED — needs Massive close-code/keepalive doc or live probe`). The only documented WS limit is
  1,000 contracts/connection. So our 5-min `WATCHDOG_STALL_MS`, any-inbound-frame liveness, and 3s reopen
  delay rest on **empirics, not docs**.
- **Concrete fix:** Subscribe **`T.<OCC>` (Trades)** alongside `Q` so the watchdog can distinguish *"no Q
  frames at all"* (real stall) from *"no trades, but quotes flowing"* (a genuinely quiet contract). This is
  the doc-grounded resolution to the false-fire — opportunity #4. Until a Massive keepalive doc exists, keep
  the empirical watchdog but **run a live-probe to record actual close codes** and pin `stallMs`.

**RT-2 — Massive connect-timeout / retry / circuit-breaker (silent 404 on aliased paths):**
- **What the docs say:** Massive blesses `/stocks/v1/dividends`, `/stocks/v1/splits`, and `/v2/reference/news`.
  We currently call the **Polygon-legacy** `/v3/reference/dividends`, `/v3/reference/splits`, and
  `/benzinga/v2/news` — **none confirmed by the Massive docs index**. If an alias is silently dropped these
  **404 with no retry**.
- **Concrete fix:** add a **doc-probe test** (below) that live-hits each path and fails CI on a 404; add
  connect-timeout + bounded retry/backoff + a circuit-breaker on Massive REST so a silent path 404 or
  connect error doesn't fail open into stale data. Migrate the three legacy paths to the documented ones once
  the probe confirms.

**RT-5 — Read-the-docs discipline (don't infer behavior from code comments):**
- **What the docs say (CONFIRMED CORRECTION):** all four indicator endpoints **DO** accept index tickers —
  `/v1/indicators/{sma,ema,rsi,macd}/{indicesTicker}`, each doc page shows an `I:NDX` sample and states
  *"Included in all Indices plans."* `polygon.ts` already uses them as PRIMARY for `I:SPX`.
- **Residual drift to fix:** `src/lib/providers/ma-math.ts` (header comment "do NOT support index tickers")
  and `src/lib/spx-play-technicals.ts` (hand-rolled `rsi()`, line 63) still carry the **pre-RT-5 false belief**.
- **Concrete fix:** a **doc-probe test** that asserts `I:SPX` indicator calls return 200 (encoding the RT-5
  lesson in CI), plus delete/correct the two stale comments and route SPX-play RSI through `fetchIndexRsi`.

**2-RPS cluster ceiling vs cron + user fan-out:**
- The UW limiter caps the **entire cluster** at 2 req/s. Crons + per-user features share that single budget,
  so an unbounded user fan-out (one UW call per user-ticker) will starve the crons and trip 429/`PLAN_BLOCKED`.
- **Concrete fix:** every per-user UW feature must be a **cache-reader** off the cron-populated L1+Redis store
  (never a direct fan-out call), and user tickers must be **allowlisted** so an arbitrary symbol can't punch a
  live UW request. Most UW reads already serve from the two-layer cache; enforce this as a rule (below).

### 4.3 Rules we must follow

1. **One WS connection per key, via a socket worker.** Do not open ad-hoc sockets from request handlers;
   route all WS through the dedicated socket clients (`polygon-socket.ts`, `options-socket.ts`, `uw-socket.ts`).
2. **≤1,000 contracts per options Q/T connection** (DOC-VERIFIED). Shard the options pool by this cap.
   **Do NOT scale past `MAX_CONNECTIONS=10` shards** until the per-key connection cap is probed — that number
   is folklore (`NOT VERIFIED`).
3. **Retry/backoff + circuit-breaker on connect errors** (REST and WS). UW skill page recommends
   *"reconnect loop with exponential backoff, resubscribe on reconnect"*; apply the same to Massive WS.
4. **Allowlist user tickers** before any live UW/Massive call; per-user features are **cache-readers** off the
   cron-populated store, never live fan-out (protects the 2-RPS cluster ceiling).
5. **Massive REST ≤ ~40 rps** (self-imposed, under the ~100/s guidance) and **UW REST ≤ 2 rps** cluster-wide —
   both already enforced; keep them as the hard cluster budgets.
6. **Use documented page maxima to batch:** `any_of` ≤250, chain snapshot ≤250, contracts ref ≤1000,
   aggs/trades/quotes ≤50000 — one batched call instead of N small ones.
7. **Scope firehose channels:** subscribe `option_trades:TICKER` (SPX/SPY), never the unscoped 6–10M/day stream.
8. **Read the docs, not the code comments** (RT-5): any path/param/limit not confirmed from a rendered doc
   page is `NOT VERIFIED` and must be live-probed before code relies on it.

---

## 5. Action list (doc-grounded changes)

**Adopt (high-value, in-plan):**
1. Adopt **UW WS `gex_strike` / `gex_strike_expiry:SPX`** → native per-strike dealer gamma walls (replaces self-computed walls).
2. Adopt **UW WS `option_trades:SPX`/`:SPY`** → own flow rules + resolve `flow-alerts.trade_ids` (scope by `:TICKER`).
3. Adopt **Massive options `T.<OCC>` Trades WS** → live prints; **wire into the RT-1 stall watchdog** (no-Q vs no-T).
4. Adopt **Massive options Unified Snapshot `/v3/snapshot` (`any_of` ≤250)** → batch Night's Watch position greeks/IV/OI/mark in one call.
5. Wire **Massive options Contract Snapshot `/v3/snapshot/options/{u}/{contract}`** (the "future optimization" at polygon-options-gex.ts:45) for per-held-contract marks + WS-quiet fallback.
6. Subscribe **Massive indices `V.I:SPX`/`V.I:VIX`** → tick-level value; drive the desk `price` off `V` instead of 1-sec-bar `c`.
7. Add **UW VIX Term Structure + Variance Risk Premium + Vol Anomaly Score / Character** to the SPX desk + a "vol movers" board.
8. Add **UW Greek Exposure By Strike & Expiry** (+ full `greek-exposure` series) → vanna/charm dealer panel (verify path).
9. Add **Massive stocks `LULD` WS** as a second halt source to de-risk the single-source `trading_halts` fail-closed gate.
10. Add **UW WS `news` (`is_trump_ts`)**, **`contract_screener`**, and **`price:SPY`** desk feeds.

**Fix (correctness / RT-class):**
11. **RT-2 path mismatches** — live-probe and migrate `/v3/reference/dividends`→`/stocks/v1/dividends`,
    `/v3/reference/splits`→`/stocks/v1/splits`, and `/benzinga/v2/news`→`/v2/reference/news` (or confirm aliases).
12. **RT-5 drift** — delete/correct the stale "indices unsupported" comment in `src/lib/providers/ma-math.ts`
    and route `spx-play-technicals.ts` RSI through `fetchIndexRsi('I:SPX',...)`.
13. **UW WS wire-name** — confirm `flow_alerts` (underscore) is an accepted join alias vs docs' `flow-alerts`
    (hyphen); a silent no-op starves the flow pipeline. (`NOT VERIFIED` — probe.)
14. **Massive options Q fields** — drop the unnecessary `bid`/`ask` aliasing; `bp`/`ap`/`bs`/`as` are DOC-CANONICAL.
15. Confirm GEX reads **greeks/IV/OI off the chain-snapshot payload** rather than recomputing (accuracy/CPU risk).

**Add tests / infra:**
16. **Doc-probe test (RT-5 + RT-2):** CI test that live-hits the key gated/aliased paths (`I:SPX` indicators,
    dividends/splits/news paths, options `/v3/trades` & `/v3/quotes`) and fails on 404/plan-block drift.
17. **Header probe (UW rate limit):** read `x-uw-minute-req-counter` / `-remaining` / `-reset` off any 200 to
    confirm the 120/min ceiling (currently `NOT VERIFIED`).
18. **WS limits probe:** live-probe the real Massive per-key connection cap and close codes before scaling the
    options pool past 10 shards or trusting the `1008/4401/4403`/`1006` mappings.
19. Add **connect-timeout + bounded retry/backoff + circuit-breaker** on Massive REST (RT-2).

**Regenerate internal docs:**
20. **Regenerate `api-provider-catalog.ts`, `cursor-api-analysis-data.ts`, and the `/docs/polygon/*` + `/docs/...`
    pages from THIS file.** They are stale/inferred; this reference is canonical. Mark them generated-not-edited.

**Plan / purchase evaluations (gated):**
21. Evaluate Massive **Business** (FMV synthetic mid for illiquid SPXW marks) and **Imbalances Expansion**
    (NOI MOC/auction-imbalance edge), and UW **Full Tape** add-on ($250/mo) for backtest replay.
