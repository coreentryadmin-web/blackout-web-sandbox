# Massive STOCKS API (Equities Advanced) — Docs-Grounded Audit

Scope: Massive **Stocks** REST + WebSocket surface only (not Options, Indices, FX, Crypto).
Base URL we call: `https://api.massive.com` (env `POLYGON_API_BASE`, key `POLYGON_API_KEY`).
Method: every endpoint below was read line-by-line from the official docs at
`https://massive.com/docs/rest/stocks/*` and `https://massive.com/docs/websocket/stocks/*`
(via the `.md` source pages, enumerated from `https://massive.com/docs/llms.txt`). Plan/recency
strings are quoted from those pages. **No behavior is inferred from our code comments.**

> DOC-LOAD CAVEAT: The human-facing pages (`/overview`, `/quickstart`, the KB articles) are
> JS-rendered and returned an empty shell to WebFetch — only the per-endpoint `.md` files render.
> So the per-endpoint **plan/recency** facts below are docs-verified; the **account-wide rate
> limit** numbers (req/min, req/s) come from a Massive KB *search snippet*, not the rendered
> article body, and are marked **NOT VERIFIED (exact wording)** where that applies.

Legend: ✅ USED (file:line) · ⬜ AVAILABLE-UNUSED · ❓ NEEDS-PLAN/ACCESS or PATH-MISMATCH.

---

## 1. Aggregates / Bars

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Custom Bars (OHLC) | `GET /v2/aggs/ticker/{ticker}/range/{mult}/{timespan}/{from}/{to}` | Aggregated OHLCV over custom range/interval (ET) | `adjusted`,`sort`,`limit`(max 50000) | ✅ polygon.ts:441 (1min),450 (5min),464/473 (1day) | "Included in all Stocks plans"; RT on Advanced | Keep. We use 1m/5m/1d; **custom multi-day & other timespans unused** for backtests. |
| Daily Market Summary (grouped) | `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` | All-US-stocks OHLCV+VWAP for one date | `adjusted`,`include_otc` | ✅ polygon.ts:203 | "Included in all Stocks plans" | Keep. |
| Daily Ticker Summary (open-close) | `GET /v1/open-close/{ticker}/{date}` | Open/close + **preMarket/afterHours** prints | `adjusted` | ✅ (scope-listed `/v1/open-close/{t}/{d}`) | "Included in all Stocks plans" | Keep — `afterHours`/`preMarket` fields useful for gap logic. |
| Previous Day Bar | `GET /v2/aggs/ticker/{ticker}/prev` | Prior session OHLC | `adjusted` | ✅ (scope-listed "ticker prev") | "Included in all Stocks plans" | Keep. |

---

## 2. Snapshots

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Full Market Snapshot | `GET /v2/snapshot/locale/us/markets/stocks/tickers` | One-shot snapshot of 10,000+ tickers (day/min/prevDay + last trade/quote) | `tickers`,`include_otc` | ✅ polygon.ts:131,151 | Starter/Dev/Adv/Business (NOT Basic); RT on Advanced | Keep — but see Opportunity #1 (we fetch a tickers subset; full-market scan is one call). |
| Single Ticker Snapshot | `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | Latest trade+quote+min/day/prevDay for one ticker | path `ticker` | ✅ polygon.ts:108 | Starter/Dev/Adv/Business; RT on Advanced | Keep. |
| Top Market Movers | `GET /v2/snapshot/locale/us/markets/stocks/{direction}` | Top-20 gainers **or** losers | `direction`(gainers/losers),`include_otc` | ✅ polygon.ts:300 (gainers),303 (losers) | Starter/Dev/Adv/Business; RT on Advanced | Keep. |
| Unified Snapshot | `GET /v3/snapshot` | Cross-asset snapshot (stocks/options/fx/crypto/indices) in ONE call; `ticker.any_of` up to 250 | `ticker.any_of`(≤250),`type`,`order`,`limit`(≤250) | ⬜ (we use the index-only `/v3/snapshot/indices` variant in polygon.ts:352, not the unified one for stocks) | Starter/Dev/Adv/Business (NOT Basic) | **OPPORTUNITY #2** — single call to co-snapshot SPX index + its component basket + key options in one round-trip; cuts our per-pulse call count under the ~limit. |

---

## 3. Trades & Quotes (tick + last)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Trades (tick) | `GET /v3/trades/{ticker}` | Tick-level trades: price,size,exchange,**conditions**,tape,SIP+participant+TRF timestamps | `timestamp[.gte/gt/lte/lt]`,`order`,`limit`(≤50000),`sort` | ⬜ UNUSED | Developer/Advanced/Business (NOT Basic/Starter); RT on Advanced | **OPPORTUNITY #3** — tick tape + condition codes ⇒ build our own block/sweep/dark-print classifier for equities (today flow intel is UW-only). |
| Quotes / NBBO (tick) | `GET /v3/quotes/{ticker}` | Historical NBBO: bid/ask price+size+exchange, conditions, indicators, sequence, tape | `timestamp[.gte/...]`,`order`,`limit`(≤50000) | ⬜ UNUSED | **Advanced + Business only**; RT on Advanced | **OPPORTUNITY #4** — spread/liquidity + quote-stuffing signals around SPX-proxy names; powers a microstructure panel. ❓ confirm Advanced. |
| Last Trade | `GET /v2/last/trade/{ticker}` | Single latest trade | path `ticker` | ✅ (scope-listed `/v2/last/trade/{t}`) | Developer/Advanced/Business (NOT Basic/Starter); RT on Advanced | Keep. |
| Last Quote (NBBO) | `GET /v2/last/nbbo/{ticker}` | Single latest NBBO bid/ask | path `ticker` | ✅ (scope-listed `/v2/last/nbbo/{t}`) | **Advanced + Business only** (NOT Basic/Starter/Developer) | Keep — confirms we are on an **Advanced** plan (this endpoint gates it). |

---

## 4. Technical Indicators

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| EMA | `GET /v1/indicators/ema/{ticker}` | Exponential moving average | `window`,`timespan`,`series_type`,`expand_underlying`,`timestamp[.gte/...]`,`limit`(≤5000) | ✅ polygon.ts:500,638 | "Included in all Stocks plans"; RT on Advanced | Keep. |
| SMA | `GET /v1/indicators/sma/{ticker}` | Simple moving average | same as EMA | ✅ polygon.ts:657 | "Included in all Stocks plans" | Keep. |
| RSI | `GET /v1/indicators/rsi/{ticker}` | Relative Strength Index (0–100) | `window`,`timespan`,`series_type`,`limit`(≤5000) | ✅ polygon.ts:511,693 | "Included in all Stocks plans" | Keep. |
| MACD | `GET /v1/indicators/macd/{ticker}` | MACD line/signal/histogram | `short_window`,`long_window`,`signal_window`,`series_type` | ✅ (scope-listed `/v1/indicators/macd`) | "Included in all Stocks plans" | Keep. |

> ⚠️ **RT-5 RE-CHECK (the incident endpoint).** The **Stocks** indicator pages for EMA/SMA/RSI/MACD
> do **NOT** mention index tickers (`I:SPX`). Each says only "Included in all Stocks plans". The
> "indices ARE supported / Included in all Indices plans" fact (cited in our code at polygon.ts:600)
> lives in the **Indices** indicator docs, a different product line — **out of this scope**.
> ACTION: this audit confirms the Stocks docs alone do NOT prove `I:TICKER` indicator support;
> that claim must be sourced from `https://massive.com/docs/rest/indices/technical-indicators/*`
> (a separate audit file). **NOT VERIFIED here — needs the Indices indicator doc page.**
> VWAP: there is **no** `/v1/indicators/vwap` documented in the Stocks surface — our code
> already derives VWAP from minute aggregates (polygon.ts:669), which the docs corroborate (no such endpoint).

---

## 5. Reference / Tickers

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| All Tickers | `GET /v3/reference/tickers` | List/search tickers across asset classes | `type`,`market`,`exchange`,`cusip`,`cik`,`search`,`active`,`limit`(≤1000) | ✅ (scope-listed `/v3/reference/tickers`) | "Included in all Stocks plans" | Keep. |
| Ticker Overview (details) | `GET /v3/reference/tickers/{ticker}` | Company details: **market cap, shares outstanding, SIC, branding logo/icon, address** | `date` (point-in-time) | ⬜ UNUSED | "Included in all Stocks plans" | **OPPORTUNITY #5** — float/shares-outstanding + market-cap + logo for richer position cards & our float tool; replaces a UW round-trip. |
| Ticker Types | `GET /v3/reference/tickers/types` | Enum of ticker type codes | `asset_class`,`locale` | ⬜ UNUSED | "Included in all Stocks plans" | Low value; keep as reference only. |
| Related Companies | `GET /v1/related-companies/{ticker}` | Peers via news + returns correlation | path `ticker` | ⬜ UNUSED | "Included in all Stocks plans"; updated daily | **OPPORTUNITY #6** — auto-build a "peers also moving" rail and contagion/rotation context for any alerted name, free on our plan. |

---

## 6. Corporate Actions

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Dividends | docs: `GET /stocks/v1/dividends` | Dividend history: ex-date, cash_amount, frequency, pay_date, adj factor | `ticker[.any_of]`,`ex_dividend_date`,`frequency`,`distribution_type`,`limit`(≤5000) | ❓ polygon-largo.ts:429 calls **`/v3/reference/dividends`** | "Included in all Stocks plans" | **PATH MISMATCH** — docs show `/stocks/v1/dividends`; we call the Polygon-legacy `/v3/reference/dividends`. Verify Massive aliases v3 → if not, this 404s. **NOT VERIFIED — needs a live probe of both paths.** |
| Splits | docs: `GET /stocks/v1/splits` | Split history: execution_date, split_from/to, adj factor | `ticker`,`execution_date`,`adjustment_type`,`limit`(≤5000) | ❓ polygon-largo.ts:453 calls **`/v3/reference/splits`** | "Included in all Stocks plans" | **PATH MISMATCH** (same as dividends). **NOT VERIFIED — live probe needed.** |
| IPOs | `GET /vX/reference/ipos` | Upcoming + historical IPOs (since 2008): listing_date, ipo_status, share/price ranges | `ticker`,`ipo_status`,`listing_date[.gte/...]`,`limit`(≤1000) | ⬜ UNUSED | "Included in all Stocks plans"; updated daily | **OPPORTUNITY #7** — IPO/direct-listing calendar feed ("new tradables") for the Night Hawk scanner; pending/rumor states included. |

---

## 7. Fundamentals

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Ratios | `GET /stocks/financials/v1/ratios` | Valuation/profitability/liquidity/leverage ratios (P/E, EV/EBITDA, ROE, D/E, FCF) | `ticker[.any_of]`,numeric `.gt/.gte/.lt/.lte`,`limit`(≤50000) | ✅ polygon.ts:559 | **Advanced / Financials&Ratios Expansion / Business only** | Keep — confirms an Advanced (or F&R expansion) entitlement. |
| Short Interest | `GET /stocks/v1/short-interest` | FINRA bi-weekly short interest + days_to_cover | `ticker`,`days_to_cover`,`settlement_date`,`limit`(≤50000) | ✅ polygon.ts:524 | "Included in all Stocks plans"; updated every 2 weeks | Keep. |
| Short Volume | `GET /stocks/v1/short-volume` | Daily FINRA off-exchange short-sale volume + per-venue breakdown | `ticker[.any_of]`,`date`,`short_volume_ratio`,`limit`(≤50000) | ✅ polygon.ts:583 | "Included in all Stocks plans"; daily; hist from 2024-02-06 | Keep — **per-venue + exempt/non-exempt fields underused** (we likely read only the headline ratio). |
| Income Statements | `GET /stocks/financials/v1/income-statements` | Revenue/EPS/EBITDA per period | `tickers`,`cik`,`period_end`,`timeframe`,`limit`(≤50000) | ⬜ UNUSED | Advanced / F&R Expansion / Business (NOT Basic/Starter/Dev) | ⬜ Low priority for a flow platform; skip unless earnings-fundamentals product. |
| Cash Flow Statements | `GET /stocks/financials/v1/cash-flow-statements` | Operating/investing/financing cash flows | `tickers`,`cik`,`period_end`,`timeframe` | ⬜ UNUSED | Advanced / F&R Expansion / Business | ⬜ Low priority; skip. |
| Balance Sheets | `GET /stocks/financials/v1/balance-sheets` | Assets/liabilities/equity per period | `tickers`,`cik`,`period_end`,`timeframe` | ⬜ UNUSED | Advanced / F&R Expansion / Business | ⬜ Low priority; skip. |

---

## 8. Market Operations / Reference

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Market Status (now) | `GET /v1/marketstatus/now` | Live open/closed + early/after hours per exchange + index groups | none | ✅ polygon.ts:757 | "Included in all Stocks plans"; real-time | Keep (cached 60s per code comment polygon.ts:745). |
| Market Holidays (upcoming) | `GET /v1/marketstatus/upcoming` | Upcoming holidays + early-close times | none | ✅ (scope-listed `/v1/marketstatus/upcoming`) | "Included in all Stocks plans" | Keep. |
| Exchanges | `GET /v3/reference/exchanges` | Exchange directory (MIC, operating_mic, type) | `asset_class`,`locale` | ⬜ UNUSED | "Included in all Stocks plans" | **OPPORTUNITY #8** — map exchange IDs → names to decode tape/exchange fields in trades/quotes (prereq for any tick-tape classifier). |
| Condition Codes | `GET /v3/reference/conditions` | Unified trade/quote condition dictionary (sip_mapping, update_rules) | `asset_class`,`data_type`,`sip`,`id`,`limit`(≤1000) | ⬜ UNUSED | "Included in all Stocks plans" | **Prereq for Opp #3** — needed to interpret `conditions[]` on trades (mark dark/odd-lot/ISO prints). |

---

## 9. News

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| News | `GET /v2/reference/news` | Articles + publisher + **insights/sentiment per ticker** | `ticker`,`published_utc[.gte/...]` | ✅ polygon-largo.ts:157,342 | "all individual and business plans"; refreshes hourly | Keep. We also call `/benzinga/v2/news` (polygon.ts:397) which is **NOT in the Stocks docs index** — see note below. |

> **NOTE (news path).** Our code hits two news paths: `/v2/reference/news` (documented, ✅) and
> `/benzinga/v2/news` (polygon.ts:397). The Benzinga path is **not listed anywhere in the Stocks
> docs index** (`llms.txt`) — it's a Polygon-era Benzinga partner route. **NOT VERIFIED — needs a
> live probe** to confirm Massive still serves `/benzinga/v2/news`, else it should migrate to
> `/v2/reference/news`.

---

## 10. WebSocket — Stocks cluster

WS endpoints are per-channel (`WS /stocks/{CHANNEL}`); FMV uses `WS /business/stocks/FMV`.
Subscribe via `ticker` = single, comma-list, or `*`.

| Channel | Path / prefix | Purpose | Msg fields (key) | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Trades **T** | `WS /stocks/T` (`T.AAPL`,`T.*`) | Real-time prints | `p`,`s`,`x`,`z`,`c`(conditions),`t`,`pt`,`trfi`,`trft`,`q` | ⬜ UNUSED for equities (we run T only on options/index clusters per scope) | Developer/Advanced/Business; RT on Advanced | **OPPORTUNITY** — live equities tape for SPX-proxy + mega-caps drives a real-time prints/sweeps feed without UW. |
| Quotes **Q** | `WS /stocks/Q` | Real-time NBBO | `bp`,`ap`,`bs`,`as`,`bx`,`ax`,`c`,`i`,`z`,`t` | ⬜ UNUSED on stocks (we use Q on the **options** cluster for held contracts) | **Advanced + Business only**; RT on Advanced | Live spread/liquidity on key names; pairs with Opp #4. |
| Agg-Minute **AM** | `WS /stocks/AM` | Rolling 1-min bars | `o,h,l,c`,`v`,`vw`,`av`,`op`,`s`,`e` | ⬜ UNUSED | Starter/Dev/Adv/Business; RT on Advanced | **OPPORTUNITY** — push-based 1-min bars replace our polled `/v2/aggs .../1/minute` calls ⇒ fewer REST hits, lower latency on the SPX desk. |
| Agg-Second **A** | `WS /stocks/A` | Rolling 1-sec bars | same shape as AM | ⬜ UNUSED | Starter/Dev/Adv (NOT base Business — "Business + Expansion"); RT on Advanced | High-res intrabar momentum for 0DTE timing. |
| Fair Market Value **FMV** | `WS /business/stocks/FMV` | Proprietary fair-value tick | `fmv`,`sym`,`t`(ns) | ⬜ UNUSED | **Business plan ONLY** (all individual plans "Not included") | ❓ NEEDS-PLAN — Business tier only; not on Advanced. Flag for upgrade eval, do not assume access. |
| Net Order Imbalance **NOI** | `WS /stocks/NOI` | Auction (open/close) order imbalances, NYSE-listed | `at`,`a`(auction type),`o`(imbalance qty),`p`(paired),`b`(book-clear price) | ⬜ UNUSED | **"Imbalances Expansion" add-on ONLY** (not Basic/Starter/Dev/Adv/Business) | ❓ NEEDS-PLAN — **MOC/LOC imbalance** is gold for 3:50pm close positioning; gated behind a paid expansion. Flag for purchase eval. |
| Limit Up-Limit Down **LULD** | `WS /stocks/LULD` | Price-band approach/breach + halts | `h`,`l`,`i`(indicators),`z`,`t`,`q` | ⬜ UNUSED | Advanced (individual) / Business + Expansion; real-time | **OPPORTUNITY** — real-time halt/limit-band detection (cleaner than UW `trading_halts` for equities); already on our Advanced tier. |

> Channels in the docs index NOT separately broken out above: none missed — the WS Stocks index
> lists exactly **7** channels (T, Q, AM, A, FMV, NOI, LULD). "Launchpad" is a delivery mode, not a
> separate Stocks channel in this index. **NOT VERIFIED:** any Launchpad business-feed variant —
> needs `https://massive.com/docs/websocket` business pages.

---

## Top missed-data opportunities (concrete product unlocks)

1. **Full-Market / Unified Snapshot scan** (`/v2/snapshot/.../tickers`, `/v3/snapshot` ≤250 any_of) — one call returns the whole equities tape state; build a market-wide breadth/heat scanner and co-snapshot SPX + basket + options in a single round-trip (fewer pulses against the limiter).
2. **Tick Trades + Condition Codes** (`/v3/trades` + `/v3/reference/conditions` + `/v3/reference/exchanges`) — our own equities block/sweep/dark-print classifier; today equity flow intel is 100% UW-dependent (and UW is the 2 req/s bottleneck). This moves it onto the permissive Massive limiter.
3. **NBBO Quotes (REST `/v3/quotes` + WS `Q`)** — spread/liquidity + microstructure panel for SPX-proxy names; quote-imbalance as a short-term signal.
4. **Ticker Overview details** (`/v3/reference/tickers/{t}`) — shares outstanding, float inputs, market cap, branding/logo — enriches position cards and the float tool, removes a UW round-trip.
5. **Related Companies** (`/v1/related-companies/{t}`) — auto "peers also moving" / rotation-contagion rail on every alert, free on our plan.
6. **IPO calendar** (`/vX/reference/ipos`) — "new tradables" + pending/rumor feed for Night Hawk.
7. **NOI auction imbalances** (`WS /stocks/NOI`, paid expansion) — MOC/LOC imbalance for 3:50–4:00pm ET close positioning, the single highest-alpha equities feed we don't have. **Needs the Imbalances Expansion add-on — flag for purchase.**
8. **LULD halt/band stream** (`WS /stocks/LULD`, on our Advanced tier) — real-time halt + limit-band detection, cleaner equities source than UW `trading_halts`.

Honorable mention: **AM/A push aggregates** to replace polled minute-bar REST calls on the SPX desk (latency + call-count win), and **per-venue short-volume** fields we already pay for but underuse.

---

## Rate limits & gotchas (from the docs)

- **Account-wide request limit (NOT VERIFIED — exact wording; from Massive KB *search snippet*,
  not the rendered article).** Free tier ≈ **5 requests/minute**; **paid tiers ("Advanced"/"Business")
  = "unlimited API requests"** but usage is **monitored** and Massive **recommends staying under
  ~100 requests/second** so no single user degrades service. ❓ Confirm against the rendered KB
  article `https://massive.com/knowledge-base/article/what-is-the-request-limit-for-massives-restful-apis`
  (JS-rendered; WebFetch couldn't read the body) — this directly governs our `polygon-rate-limiter.ts`
  ~40 rps ceiling, which sits comfortably under the ~100/s recommendation.
- **Plan gates we depend on (docs-verified):** `/v2/last/nbbo`, `/v3/quotes`, and WS `Q` require
  **Advanced** (or Business). `/stocks/financials/v1/ratios` requires **Advanced or the
  Financials & Ratios Expansion**. Both endpoints are ✅ used in our code, which is consistent with us
  being on an **Advanced + F&R** entitlement. (No env/plan doc inspected — inferred only from which
  gated endpoints succeed in code; **not a docs fact**.)
- **Recency ladder (docs-verified, repeated on every page):** Basic = end-of-day; Starter/Developer
  = **15-minute delayed**; **Advanced/Business = real-time.** If SPX-desk numbers ever look 15m stale,
  it's a *plan/key* problem, not code.
- **WS connection limits:** the per-channel Stocks docs do **NOT** state a max-connections or
  max-symbols-per-connection number. Our enforced "10 conns × 1000 contracts/Q-conn" cap is an
  **options-cluster** rule and is **NOT VERIFIED for the stocks cluster** — needs the WS connection-
  limits doc page (not present in the per-channel `.md` files). **NOT VERIFIED — needs WS overview/limits page.**
- **Timestamps:** trades/quotes carry **three** timestamps — `sip_timestamp` (SIP receipt),
  `participant_timestamp` (exchange generation), `trf_timestamp` (TRF). For latency-sensitive logic
  use participant time, not SIP time (RT-1-style watchdog tuning).
- **Path discrepancies found (must live-probe):**
  - Dividends — docs `/stocks/v1/dividends` vs our `/v3/reference/dividends` (polygon-largo.ts:429).
  - Splits — docs `/stocks/v1/splits` vs our `/v3/reference/splits` (polygon-largo.ts:453).
  - News — we additionally call `/benzinga/v2/news` (polygon.ts:397), which is **absent from the
    Stocks docs index**. The documented news path is `/v2/reference/news` (✅ also used).
  These v3/benzinga paths are Polygon-legacy; Massive *may* alias them, but the docs only bless the
  paths above. **RT-2-style risk:** if an alias is silently dropped these 404 with no retry. Probe both.
- **`include_otc`** defaults to **false** on grouped/full-market/movers — OTC names are excluded
  unless we opt in (relevant if any scan expects OTC tickers).

---

### Source pages read (official docs)
- Index: `https://massive.com/docs/llms.txt`
- Aggregates: custom-bars, daily-market-summary, daily-ticker-summary, previous-day-bar `.md`
- Snapshots: full-market, single-ticker, top-market-movers, unified `.md`
- Trades/Quotes: trades, quotes, last-trade, last-quote `.md`
- Indicators: ema, sma, rsi, macd `.md`
- Tickers: all-tickers, ticker-overview, ticker-types, related-tickers `.md`
- Corporate actions: dividends, splits, ipos `.md`
- Fundamentals: ratios, short-interest, short-volume, income/cash-flow/balance `.md`
- Market ops: market-status, market-holidays, exchanges, condition-codes `.md`
- News: news `.md`
- WebSocket: trades, quotes, aggregates-per-minute, aggregates-per-second, fair-market-value, imbalances, luld `.md`
- Rate limit: Massive KB "request limit" article (search snippet only — body JS-rendered, NOT VERIFIED verbatim)
