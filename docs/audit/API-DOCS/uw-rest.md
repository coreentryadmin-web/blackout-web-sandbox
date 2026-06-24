# Unusual Whales Advanced REST API — Docs-Grounded Audit

**Scope:** Unusual Whales Advanced REST + WebSocket. Cross-referenced against our usage in
`src/lib/providers/unusual-whales.ts` (all UW REST goes through this single provider; rate limiting in
`src/lib/providers/uw-rate-limiter.ts`; WS channels in `src/lib/ws/`).

**Method:** Endpoint catalog read from the OFFICIAL docs index at `https://api.unusualwhales.com/docs`
(the canonical category listing — 100+ endpoints across REST/WS/Kafka/MCP) and the official
`https://unusualwhales.com/skill.md` agent guide (auth + base URL + key paths, quoted verbatim below).
Per-endpoint params come from the docs index "Key Parameters" column where present; exact query-string
keys we send are taken from our code. **Where the docs page would not render (JS-only pages, truncated
OpenAPI), it is marked `NOT VERIFIED` with the source that needs a live probe.**

**Auth (verbatim from `skill.md`):** `Authorization: Bearer <API_TOKEN>` + `UW-CLIENT-API-ID: 100001`,
GET-only, base URL `https://api.unusualwhales.com`. This matches our provider exactly
(`unusual-whales.ts` lines 22–24, 99–103).

Legend: ✅ USED (where) · ⬜ AVAILABLE-UNUSED · ❓ NEEDS-PLAN/ACCESS

---

## GEX / Greek Exposure (docs category: "Gex/Greeks", 11 endpoints)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| GEX Levels | `/api/stock/{t}/gex-levels` | Aggregate gamma exposure levels | ticker, limit | ✅ `fetchUwGexLevels` | shared 120/min* | Keep |
| Greek Exposure | `/api/stock/{t}/greek-exposure` | Delta/gamma/vega across chain | ticker, date | ⬜ | shared | **OPPORTUNITY: full dealer delta/vega exposure series → vanna/charm desk panel, not just gamma** |
| Greek Exposure By Expiry | `/api/stock/{t}/greek-exposure/expiry` | Greeks by expiration | ticker | ✅ `fetchUwGreekExposureExpiry` | shared | Keep |
| Greek Exposure By Strike | `/api/stock/{t}/greek-exposure/strike` | Greeks by strike (cumulative) | ticker, limit | ✅ `fetchUwGreekExposureStrike` (GEX-ladder fallback) | shared | Keep |
| Greek Exposure By Strike & Expiry | `/api/stock/{t}/greek-exposure/expiry/strike` (path NOT VERIFIED — needs docs/OpenAPI) | Greeks in strike×expiry matrix | ticker, strike, expiry | ⬜ | shared | **OPPORTUNITY: per-strike-per-expiry greek surface → true 0DTE vs back-month dealer split** |
| Greek flow | `/api/stock/{t}/greek-flow` | Flow-weighted greeks | ticker, limit | ✅ `fetchUwGreekFlow` | shared | Keep |
| Greek flow by expiry | `/api/stock/{t}/greek-flow/{expiry}` | Flow greeks per expiry | ticker, expiry | ✅ `fetchUwGreekFlow(expiry)` | shared | Keep |
| Spot GEX per 1min | `/api/stock/{t}/spot-exposures` | 1-min gamma snapshots (time series) | ticker | ✅ `fetchUwSpotExposures` | shared | Keep |
| Spot GEX by strike & expiry | `/api/stock/{t}/spot-exposures/expiry-strike` | Strike×expiry spot gamma (0DTE-correct) | `expirations[]`, limit | ✅ `fetchUwOdteGex`, `fetchUwSpotExposuresExpiryStrike` | shared | Keep (primary 0DTE GEX) |
| Spot GEX by strike | `/api/stock/{t}/spot-exposures/strike` | Strike-level spot gamma | ticker, limit | ✅ `fetchUwSpotExposuresByStrike` | shared | Keep |
| Spot GEX by `{expiry}`/strike | `/api/stock/{t}/spot-exposures/{expiry}/strike` | Spot gamma for one expiry | ticker, expiry | ✅ `fetchUwSpotExposuresByExpiry` | shared | Keep |

## Alerts (docs category: "Alerts", 2 endpoints) — BOTH UNUSED

| Endpoint | Path | Purpose | Key params | Used? | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Alerts | `/api/alerts` (path NOT VERIFIED — needs docs/OpenAPI) | Retrieve user's triggered trade alerts | alert type, ticker | ⬜ | shared | **OPPORTUNITY: surface a user's own UW-configured alerts inside BlackOut → unifies their UW + our personalized-alerts feed** |
| Alert configurations | `/api/alerts/configuration` (path NOT VERIFIED) | Read/manage alert rule settings | user, rule params | ❓ may need account scope | shared | **OPPORTUNITY: let users push BlackOut watch rules into UW alerting; investigate whether the API key can write configs** |

## Volatility / IV (docs categories: "Volatility" 6 + Stock IV endpoints) — MOSTLY UNUSED

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| IV Rank (snapshot) | `/api/stock/{t}/volatility/stats` | IV rank/percentile | ticker | ✅ `fetchUwIvRank` | shared | Keep |
| IV Rank (series) | `/api/stock/{t}/iv-rank` | Daily IV-rank time series | ticker | ✅ `fetchUwIvRankSeries` | shared | Keep |
| Volatility Statistics | `/api/stock/{t}/volatility/stats` | Vol percentiles/distribution | ticker | ✅ (via `fetchUwIvRank`) | shared | Keep |
| Realized Volatility | `/api/stock/{t}/volatility/realized` | Historical realized vol | ticker | ✅ `fetchUwRealizedVol` | shared | Keep |
| Implied Vol Term Structure | `/api/stock/{t}/volatility/term-structure` | IV curve across expiries | ticker | ✅ `fetchUwIvTermStructure` (with `/implied-volatility-term-structure` fallback) | shared | Keep |
| Interpolated IV | `/api/stock/{t}/interpolated-iv` | IV-surface interpolation/percentile | ticker, strike, expiry | ✅ `fetchUwInterpolatedIv` | shared | Keep |
| Historical Risk Reversal Skew | `/api/stock/{t}/historical-risk-reversal-skew` | 25-delta skew over time | ticker | ✅ `fetchUwRiskReversalSkew` | shared | Keep |
| Volatility Anomaly Score | NOT VERIFIED — needs Volatility docs page | Vol-deviation scoring | ticker, period | ⬜ | shared | **OPPORTUNITY: pre-earnings/event vol-spike screener** |
| Volatility Character | NOT VERIFIED — needs Volatility docs page | Vol behavior classification | ticker | ⬜ | shared | **OPPORTUNITY: tag tickers "mean-revert vs trend" to qualify lotto/0DTE setups** |
| Variance Risk Premium | NOT VERIFIED — needs Volatility docs page | IV−RV term premium | ticker | ⬜ | shared | **OPPORTUNITY: VRP gauge → systematic premium-selling signal for the desk** |
| Top Volatility Anomalies | NOT VERIFIED — needs Volatility docs page | Market-wide highest vol anomalies | count, date | ⬜ | shared | **OPPORTUNITY: daily "vol movers" leaderboard for the morning brief** |
| Top Volatility Character | NOT VERIFIED — needs Volatility docs page | Vol-character rankings | ranking type | ⬜ | shared | Low priority |
| VIX Term Structure | NOT VERIFIED — needs Volatility docs page | VIX futures curve (contango/backwardation) | date | ⬜ | shared | **OPPORTUNITY: VIX contango/backwardation regime flag on the SPX desk — complements our I:VIX WS** |

## Options Flow & Tape (docs: "Option Trade" 5, "Option Contract" 6, Stock flow)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Flow Alerts (global) | `/api/option-trades/flow-alerts` | Unusual options activity feed | limit, ticker_symbol, min_premium, newer_than/older_than | ✅ `fetchMarketFlowAlertRows`, `fetchUwGlobalFlowAlerts` | shared (paginates ≤3 pages) | Keep (core HELIX feed) |
| Flow Alert by ID | `/api/option-trades/flow-alerts/{id}` (NOT VERIFIED) | Single alert detail | id | ⬜ | shared | **OPPORTUNITY: deep-link a HELIX row → full alert provenance** |
| Full Tape | `/api/option-trades/full-tape/{date}` (NOT VERIFIED — needs Option Trade docs) | Complete option transaction tape | date, time range | ❓ historical-tape add-on ($250/mo per docs) | paid add-on | **OPPORTUNITY: full unfiltered tape replay for backtests; gated by paid plan — probe access first** |
| Exchange & Trade-Code Breakdown | NOT VERIFIED — needs Option Trade docs | Trade-source/exchange split | date range | ⬜ | shared | **OPPORTUNITY: route/exchange breakdown to grade sweep aggressiveness** |
| Optionable Tickers | NOT VERIFIED — needs Option Trade docs | Tradeable option symbols universe | exchange | ⬜ | shared | Useful for screener universe seeding |
| Per-ticker Flow Alerts | `/api/stock/{t}/flow-alerts` | Flow alerts for one ticker | ticker, limit | ✅ `fetchUwTickerFlowAlerts` | shared | Keep |
| Recent flows (ticker) | `/api/stock/{t}/flow-recent` | Latest option trades for ticker | ticker, limit | ✅ `fetchUwFlowRecent` | shared | Keep |
| Flow per strike | `/api/stock/{t}/flow-per-strike` | Options flow by strike | ticker, limit | ✅ `fetchUwFlowPerStrike` | shared | Keep |
| Flow per strike (intraday) | `/api/stock/{t}/flow-per-strike-intraday` | Intraday strike flow | ticker | ✅ `fetchUwFlow0dte`, `fetchUwFlowPerStrikeRows` | shared (cache-reader) | Keep |
| Flow per expiry | `/api/stock/{t}/flow-per-expiry` | Options flow by expiration | ticker | ✅ `fetchUwFlowPerExpiry` | shared | Keep |
| Net premium ticks | `/api/stock/{t}/net-prem-ticks` | Tick-level net-premium velocity | ticker | ✅ `fetchUwNetPremTicks` | shared | Keep |
| NOPE | `/api/stock/{t}/nope` | Net Options Pricing Effect | ticker | ✅ `fetchUwNope` | shared | Keep |
| Option Contract — Flow | `/api/option-contract/{id}/flow` | Directional flow for one contract | id, limit | ✅ `fetchUwOptionContractFlow` | shared | Keep |
| Option Contract — Intraday | `/api/option-contract/{id}/intraday` | Day-level contract metrics | id, limit | ✅ `fetchUwOptionContractIntraday` | shared | Keep |
| Option Contract — Volume Profile | `/api/option-contract/{id}/volume-profile` | Strike/expiry volume distribution | id | ✅ `fetchUwOptionContractVolumeProfile` | shared | Keep |
| Option Contract — Historic | `/api/option-contract/{id}/historic` (NOT VERIFIED) | Historical contract snapshots | id, date range | ⬜ | shared | **OPPORTUNITY: contract-level history → "how did this exact strike trade into expiry" replay for journal** |
| Option Contract — Expiry Breakdown | `/api/option-contract/{id}/...` (NOT VERIFIED) | Expiration-structure analysis | id | ⬜ | shared | Low priority |
| Option contracts directory | `/api/option-contract/...` / `/api/stock/{t}/option-contracts` | Available contracts | ticker, type | ✅ `fetchUwOptionContracts` (live NBBO chain) | shared | Keep |

## OI / Open Interest & Chains (Stock category)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| OI Change (ticker) | `/api/stock/{t}/oi-change` | Intraday OI change by strike | ticker | ✅ `fetchUwOiChange` | shared | Keep |
| OI Change (market) | `/api/market/oi-change` | Market-wide OI change | limit | ✅ `fetchUwMarketOiChange` | shared | Keep |
| OI per Strike | `/api/stock/{t}/oi-per-strike` | OI by strike | ticker, limit | ✅ `fetchUwOiPerStrike` | shared | Keep |
| OI per Expiry | `/api/stock/{t}/oi-per-expiry` | OI by expiration | ticker | ✅ `fetchUwOiPerExpiry` | shared | Keep |
| Volume & OI per Expiry | `/api/stock/{t}/option/volume-oi-expiry` | Vol+OI by expiry | ticker, limit | ✅ `fetchUwOptionVolumeOiExpiry` | shared | Keep |
| Option Chains | `/api/stock/{t}/option-chains` | Full chain | ticker, limit | ✅ `fetchUwOptionChains` | shared | Keep |
| ATM Chains | `/api/stock/{t}/atm-chains` | At-the-money chains | ticker, expiration_date, limit | ✅ `fetchUwAtmChains` | shared | Keep |
| Greeks (by strike) | `/api/stock/{t}/greeks` | Option greeks snapshot | ticker, expiry, limit | ✅ `fetchUwGreeksByStrike` | shared | Keep |
| Max Pain | `/api/stock/{t}/max-pain` | Max-pain strike per expiry | ticker | ✅ `fetchUwMaxPain` | shared | Keep |
| Options Volume | `/api/stock/{t}/options-volume` | Daily options volume / PCR | ticker | ✅ `fetchUwOptionsVolume` | shared | Keep |
| Expiry Breakdown | `/api/stock/{t}/expiry-breakdown` | Expiration-structure analysis | ticker | ✅ `fetchUwExpiryBreakdown` | shared | Keep |
| Option Price Levels | `/api/stock/{t}/option/stock-price-levels` | Price-level clustering | ticker | ✅ `fetchUwOptionPriceLevels` | shared | Keep |
| Off/Lit Price Levels | NOT VERIFIED — needs Stock docs page | Exchange vs off-exchange price levels | ticker | ⬜ | shared | **OPPORTUNITY: lit-vs-dark price-level magnet map alongside our GEX walls** |
| Stock State | `/api/stock/{t}/stock-state` | Current price snapshot | ticker | ✅ `fetchUwStockState` | shared | Keep |

## Net Flow / Tide / Market (docs: "Market" 12, "Net Flow")

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Market Tide | `/api/market/market-tide` | Market-wide call/put premium tide | interval_5m | ✅ `fetchUwMarketTide` | shared (Redis+L1 cache) | Keep |
| Sector Tide | `/api/market/{sector}/sector-tide` | Sector-level tide | sector | ✅ `fetchUwSectorTide` | shared | Keep |
| ETF Tide | `/api/etf/{etf}/tide` | ETF-level tide | etf | ✅ `fetchUwEtfTide` | shared | Keep |
| Net Flow Expiry | `/api/net-flow/expiry` | Net option flow by expiration | limit | ✅ `fetchUwNetFlowExpiry` | shared | Keep |
| Total Options Volume | `/api/market/total-options-volume` | Aggregate market options volume | — | ✅ `fetchUwMarketTotalOptionsVolume` | shared | Keep |
| Top Net Impact | `/api/market/top-net-impact` | Highest net-premium-impact names | limit | ✅ `fetchUwMarketTopNetImpact` | shared | Keep |
| Correlations | `/api/market/correlations` | Asset correlation matrix | limit | ✅ `fetchUwMarketCorrelations` | shared | Keep |
| Economic Calendar | `/api/market/economic-calendar` | Macro event schedule | limit | ✅ `fetchUwMarketEconomicCalendar` | shared (1h cache) | Keep |
| FDA Calendar | `/api/market/fda-calendar` | Regulatory/PDUFA dates | ticker, limit | ✅ `fetchUwFdaCalendar` | shared | Keep |
| Sector ETFs | `/api/market/sector-etfs` | Sector fund listings | — | ✅ `fetchUwMarketSectorEtfs` | shared | Keep |
| Movers | `/api/market/movers` | Top gainers/losers | limit | ✅ `fetchUwMarketMovers` (deprecated → Polygon) | shared | Keep as fallback |
| Total Insider Buy & Sells | NOT VERIFIED — needs Market docs | Aggregate insider sentiment | market, timeframe | ⬜ | shared | **OPPORTUNITY: market-wide insider-sentiment gauge for daily brief** |

## Dark Pool / Lit Flow (docs: "Darkpool" 2, "Lit Flow" 2)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Ticker Darkpool | `/api/darkpool/{t}` | Large off-exchange prints per ticker | limit, min_premium | ✅ `fetchUwDarkPool` | shared | Keep |
| Recent Darkpool | `/api/darkpool/recent` | Market-wide recent dark-pool prints | limit | ✅ `fetchUwDarkPoolRecent` | shared | Keep |
| Recent Lit Flow | `/api/lit-flow/recent` | Latest exchange-listed trades | limit | ✅ `fetchUwLitFlowRecent` | shared | Keep |
| Ticker Lit Flow | `/api/lit-flow/ticker` | Exchange volume by ticker | ticker, limit | ✅ `fetchUwLitFlow` | shared | Keep |

## Screeners (docs: "Screener" 3 + Unusual Trades 4)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Stock Screener | `/api/screener/stocks` | Custom equity filtering | limit, criteria | ✅ `fetchUwScreenerStocks` | shared | Keep |
| Hottest Chains (option contracts) | `/api/screener/option-contracts` | Most-active/bullish-bearish chains | limit | ✅ `fetchUwScreenerOptionContracts` | shared | Keep |
| Contracts screener | `/api/screener/contracts` | Contract screener | limit | ✅ `fetchUwScreenerContracts` | shared | Keep |
| Analyst Rating | `/api/screener/analysts` | Consensus ratings | limit | ✅ `fetchUwScreenerAnalysts` (deprecated → Benzinga) | shared | Keep as fallback |
| Unusual Trades (recent) | `/api/unusual-trades/recent` | Anomalous option activity | limit | ✅ `fetchUwUnusualTrades` | shared | Keep |
| Unusual Trades — Chart Data | NOT VERIFIED — needs Unusual Trades docs | Visual unusual-activity data | ticker, timeframe | ⬜ | shared | Low priority |
| Unusual Trades — Aggregate Stats | NOT VERIFIED — needs Unusual Trades docs | Summary stats | period | ⬜ | shared | **OPPORTUNITY: daily unusual-activity heat summary** |

## Congress / Insider / Institutions / Predictions

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Congress recent trades | `/api/congress/recent-trades` | Latest congressional trades | limit, ticker | ✅ `fetchUwCongressTrades` | shared | Keep |
| Congress late reports | `/api/congress/late-reports` | Delayed filings | limit | ✅ `fetchUwCongressLateReports` | shared | Keep |
| Congress politicians | `/api/congress/politicians` | Politician directory | limit | ✅ `fetchUwCongressPoliticians` | shared | Keep |
| Congress unusual trades | `/api/congress/unusual-trades` | Anomalous political trades | limit, ticker | ✅ `fetchUwCongressUnusualTrades` | shared | Keep |
| Politician Portfolios (5 eps) | `/api/...portfolio...` (NOT VERIFIED — needs Politician Portfolios docs) | Holdings/annual disclosures/by-ticker | politician, ticker, year | ⬜ | shared | **OPPORTUNITY: "which politicians hold this ticker" panel on the stock overview** |
| Insider transactions | `/api/insider/transactions` | Individual insider trades | ticker, limit | ✅ `fetchUwInsiderTransactions` | shared | Keep |
| Insider buy/sells (ticker) | `/api/stock/{t}/insider-buy-sells` | Insider summary per ticker | ticker | ✅ `fetchUwInsiderFlow` | shared | Keep |
| Insider ticker flow | `/api/insider/{t}` | Insider buys/sells per ticker | ticker, limit | ✅ `fetchUwInsiderTicker` | shared | Keep |
| Insider sector flow | `/api/insider/{sector}/sector-flow` | Aggregate insider activity by sector | sector, limit | ✅ `fetchUwInsiderSectorFlow` | shared | Keep |
| Institution activity | `/api/institution/{name}/activity` | Fund transactions | name, limit | ✅ `fetchUwInstitutionActivity` | shared | Keep |
| Institution holdings | `/api/institution/{name}/holdings` | Fund positions | name, limit | ✅ `fetchUwInstitutionHoldings` | shared | Keep |
| Institution ownership | `/api/institution/{t}/ownership` | Shareholder concentration | ticker, limit | ✅ `fetchUwInstitutionOwnership` | shared | Keep |
| Institutions latest filings | `/api/institutions/latest_filings` | Recent 13F/13G | limit | ✅ `fetchUwInstitutionsLatestFilings` | shared | Keep |
| Institution sector exposure | NOT VERIFIED — needs Institution docs | Fund sector allocation | fund | ⬜ | shared | Low priority |
| List of Institutions | NOT VERIFIED — needs Institution docs | Fund directory | filter | ⬜ | shared | Low priority |
| Predictions: insiders/smart-money/unusual/whales | `/api/predictions/{insiders,smart-money,unusual,whales}` | Prediction-market consensus | limit | ✅ `fetchUwPredictions*` + consensus | shared | Keep |
| Predictions: market details/liquidity/positions/users | NOT VERIFIED — needs Predictions docs | Per-market depth/positions/user search | market id, user | ⬜ | shared | Low priority (niche) |

## Earnings / Companies / Fundamentals / Seasonality / Shorts / ETF / News / Economy

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit/plan | Recommendation |
|---|---|---|---|---|---|---|
| Earnings premarket | `/api/earnings/premarket` | Pre-market earnings | limit | ✅ `fetchUwEarningsPremarket` | shared | Keep |
| Earnings afterhours | `/api/earnings/afterhours` | Post-market earnings | limit | ✅ `fetchUwEarningsAfterhours` | shared | Keep |
| Earnings (ticker) | `/api/earnings/{t}`, `/api/stock/{t}/earnings` | Earnings history | ticker | ✅ `fetchUwEarnings` (deprecated → Benzinga) | shared | Keep as fallback |
| Earnings estimates | `/api/companies/{t}/earnings-estimates` | Forward analyst estimates | ticker | ✅ `fetchUwEarningsEstimates` | shared | Keep |
| Earnings Call Transcript | NOT VERIFIED — needs Companies docs | Searchable call text | ticker, date | ⬜ | shared | **OPPORTUNITY: transcript search → event-driven flow context; novel feature** |
| Company profile | `/api/companies/{t}/profile` | Corporate fundamentals | ticker | ✅ `fetchUwCompaniesProfile` | shared | Keep |
| Company dividends | `/api/companies/{t}/dividends` | Dividend history | ticker, limit | ✅ `fetchUwCompaniesDividends` (deprecated → Polygon) | shared | Keep as fallback |
| Company splits | `/api/companies/{t}/splits` | Split history | ticker, limit | ✅ `fetchUwCompaniesSplits` (deprecated → Polygon) | shared | Keep as fallback |
| Financials (full) | `/api/stock/{t}/financials` | Full financial statements | ticker | ✅ `fetchUwFinancials` | shared | Keep |
| Income / Balance / Cash-flow | `/api/stock/{t}/{income-statements,balance-sheets,cash-flows}` | Statements | ticker, report_type | ✅ `fetchUw{Income,Balance,CashFlows}` | shared | Keep |
| Fundamental breakdown | `/api/stock/{t}/fundamental-breakdown` | Key-metric summary | ticker | ✅ `fetchUwFundamentalBreakdown` | shared | Keep |
| Ownership | `/api/stock/{t}/ownership` | Shareholder structure | ticker | ✅ `fetchUwOwnership` | shared | Keep |
| OHLC | `/api/stock/{t}/ohlc/{size}` | Candles | ticker, candle size, limit | ✅ `fetchUwOhlc` (deprecated → Polygon) | shared | Keep as fallback |
| Technical Indicator | `/api/stock/{t}/technical-indicator/{fn}` | TA values (RSI/MACD/etc.) | ticker, interval, time_period | ✅ `fetchUwTechnicalIndicator` (deprecated → Polygon) | shared | Keep as fallback |
| Seasonality (monthly) | `/api/seasonality/{t}/monthly` | Monthly seasonality | ticker | ✅ `fetchUwSeasonality` | shared | Keep |
| Seasonality (market) | `/api/seasonality/market` | Market-wide seasonality | — | ✅ `fetchUwSeasonalityMarket` | shared | Keep |
| Seasonality: month-performers / avg-return / price-change | NOT VERIFIED — needs Seasonality docs | Best/worst months, monthly stats | year, ticker | ⬜ | shared | Low priority |
| Short interest/float v2 | `/api/shorts/{t}/interest-float/v2` | Short interest + float | ticker | ✅ `fetchUwShortFloat` (deprecated → Polygon) | shared | Keep as fallback |
| Short volume & ratio | `/api/shorts/{t}/volume-and-ratio` | Short-sale volume | ticker | ✅ `fetchUwShortVolume` (deprecated → Polygon) | shared | Keep as fallback |
| Short volumes by exchange | `/api/shorts/{t}/volumes-by-exchange` | Exchange-specific short volume | ticker | ✅ `fetchUwShortVolumesByExchange` | shared | Keep |
| Short data | `/api/shorts/{t}/data` | Current short position data | ticker | ✅ `fetchUwShortsData` | shared | Keep |
| Failures to Deliver | `/api/shorts/{t}/ftds` | FTD records | ticker | ✅ `fetchUwFtds` | shared | Keep |
| Short screener | `/api/shorts/screener` | Short-interest screener | limit | ✅ `fetchUwShortScreener` | shared | Keep |
| ETF holdings/exposure/info/weights | `/api/etfs/{etf}/{holdings,exposure,info,weights}` | ETF composition | etf, limit | ✅ `fetchUwEtf*` | shared | Keep |
| ETF in/outflow | `/api/etf/{etf}/in-outflow` | ETF capital flows | etf | ✅ `fetchUwEtfInOutflow` | shared | Keep |
| News headlines | `/api/news/headlines` | News feed | ticker, limit | ✅ `fetchUwNewsHeadlines`, `fetchUwMarketNewsHeadlines` (deprecated → Benzinga) | shared | Keep as fallback |
| Economy indicator | `/api/economy/{slug}` | Macro series (gdp/cpi/unemployment/etc.) | slug | ✅ `fetchUwEconomyIndicator` | shared (1h cache) | Keep |
| Group greek flow | `/api/group-flow/{group}/greek-flow[/{expiry}]` | Sector/index aggregated greek flow | group, expiry, limit | ✅ `fetchUwGroupGreekFlow` | shared | Keep |
| Stock info | `/api/stock/{t}/info` | Company profile/metrics | ticker | ✅ `fetchUwStockInfo` (deprecated → Polygon) | shared | Keep as fallback |

## Wholly-unused docs categories (high-level — paths NOT VERIFIED, need their docs pages)

| Category | Endpoints | Used? | Recommendation |
|---|---|---|---|
| Crypto (whale txns, recent whale, OHLC, pair state) | 4 | ⬜ | Out of scope for SPX/options product; skip |
| Forex (historical/intraday/spot) | 3 | ⬜ | Out of scope; skip |
| Commodities (commodity series) | 1 | ⬜ | Out of scope; skip |
| Digital Currencies (historical/intraday) | 2 | ⬜ | Out of scope; skip |
| Private Markets (9 eps: companies, funding rounds, investors, pricing history) | 9 | ⬜ | Out of scope for flow product; skip |
| Intel (sliding/fixed-window analytics, IPO calendar, active/delisted, top movers) | 5 | ⬜ | **OPPORTUNITY: IPO Calendar + Active/Delisted for universe hygiene; Sliding-Window Analytics for flow momentum** |
| Stock Directory (ticker↔exchange mapping) | 1 | ⬜ | Minor utility |

---

## WebSocket channels (docs: 14 channels)

| Channel | Purpose | Used? (where) | Recommendation |
|---|---|---|---|
| `flow_alerts` | Trade-anomaly stream | ✅ (HELIX primary writer) | Keep |
| `market_tide` | Sentiment stream | ✅ | Keep |
| `off_lit_trades` | Dark-pool trade feed | ✅ (`normalizeDarkPoolWsPayload`) | Keep |
| `gex` | Gamma-exposure updates | ✅ (`normalizeGexWsPayload`) | Keep |
| `net_flow` | Net-flow updates | ✅ (`normalizeNetFlowWsPayload`) | Keep |
| `interval_flow` (Ticker Interval flow) | Interval option flow | ✅ (`normalizeIntervalFlowWsPayload`) | Keep |
| `trading_halts` | Halt notifications | ✅ (`normalizeTradingHaltsWsPayload`) | Keep |
| `price` | Quote/price stream | ⬜ | **OPPORTUNITY: live underlying quote via UW WS (we use Polygon I:SPX/I:VIX today) — redundancy/cross-check** |
| `option_trades` | ALL option trades (full WS tape) | ⬜ | **OPPORTUNITY: raw real-time option tape → richest sweep/block detection vs the alert-only flow_alerts we use now** |
| `news` | News-feed stream | ⬜ | **OPPORTUNITY: push live headlines into the desk instead of polling** |
| `lit_trades` | Exchange trade feed | ⬜ | **OPPORTUNITY: live lit-tape to pair with off_lit for a complete prints picture** |
| `contract_screener` | Real-time option-contract alerts | ⬜ | **OPPORTUNITY: streaming "hottest chains" — push contracts as they heat up** |
| `custom_alerts` | User-defined alert stream | ⬜ | **OPPORTUNITY: stream a user's UW custom alerts into BlackOut personalized-alerts** |
| (WebSocket channels list) | discovery endpoint | n/a | — |

---

## Top missed-data opportunities (ranked for an options-flow / dealer-positioning / SPX product)

1. **`option_trades` WS (full real-time option tape)** — we only consume `flow_alerts` (UW's pre-filtered
   anomalies). The raw trade stream unlocks our OWN sweep/block/repeat-hit detection and 0DTE microstructure
   that UW's alert rules never surface.
2. **Greek Exposure By Strike & Expiry (full greek surface)** — we pull spot-GEX (gamma) but not the
   delta/vega/vanna/charm surface per strike×expiry. This is the single biggest dealer-positioning gap →
   vanna/charm-driven SPX desk panel.
3. **VIX Term Structure** — contango/backwardation regime flag for the SPX desk; we stream I:VIX spot but
   have no curve. Cheap, high-signal.
4. **Variance Risk Premium + Volatility Anomaly Score + Volatility Character** — turns our IV data into
   tradeable premium-selling / mean-reversion signals and a daily "vol movers" board.
5. **`contract_screener` WS + Unusual Trades aggregate stats** — streaming hottest-chains and a daily
   unusual-activity heat summary for the morning brief.
6. **Off/Lit Price Levels + `lit_trades` WS** — a lit-vs-dark magnet map alongside GEX walls, plus a
   complete live prints picture (we have off_lit only).
7. **Alerts + Alert configurations + `custom_alerts` WS** — bridge a user's UW alert config into BlackOut's
   personalized-alerts so the two alerting systems unify (needs an access probe — may require account scope).
8. **Full Tape (historical option tape, paid add-on)** — full unfiltered replay for backtesting the flow
   engine; gated behind UW's $250/mo historical add-on per the docs pricing note — probe plan access first.

---

## Rate limits & gotchas (from the docs)

- **Auth (verbatim, skill.md):** `Authorization: Bearer <API_TOKEN>` and `UW-CLIENT-API-ID: 100001`, GET-only,
  base `https://api.unusualwhales.com`. Our provider sends exactly these three headers — matches the docs.
- **Per-minute limit — NOT VERIFIED from a rendered doc page.** Web-search synthesis of UW pages reported a
  **default of 120 requests/minute** with tiered limits (free < premium < enterprise), tracked via response
  headers **`x-uw-minute-req-counter`, `x-uw-req-per-minute-remaining`, `x-uw-req-per-minute-reset`**. The
  authoritative pages (`/information/how-to-check-your-api-usage`, the API-subscriptions changelog,
  `/public-api`) are JS-rendered and returned no body to WebFetch, and `/api/openapi` truncated before the
  `info`/headers block. **NEEDS a live probe** (read the `x-uw-*` headers off any 200 response) or a render of
  those pages to confirm the 120/min number and per-tier ceilings.
- **Daily limits & historical look-back are tier-gated** (UW changelog "increased historical look-back +
  daily limits") — exact per-tier numbers NOT VERIFIED; needs the changelog page rendered or a live probe.
- **Historical option tape is a paid add-on** ($250/mo full-market, 10% off for 1yr+) per the docs index
  pricing note — relevant if we pursue Full Tape / Option Contract Historic.
- **Our enforced ceiling is far stricter than UW's:** `uw-rate-limiter.ts` caps the whole cluster at
  **2 req/s (`UW_MAX_RPS` default 2)** = ~120/min, i.e. we self-limit at roughly the rumored documented
  ceiling. Most reads are served from the two-layer cache (in-memory L1 + Redis L2), so live calls are rare.
- **Gotcha — `403` = plan-blocked:** `uwGetSafe` treats any `403` as "endpoint requires higher tier" and
  returns null (logs `PLAN_BLOCKED`). Several `NEEDS-PLAN-ACCESS` rows above would surface as 403 if our
  Advanced plan doesn't include them — probe before building.
- **Gotcha — spot-exposures 503s in production** (noted in code: `nighthawk/positioning.ts`, `spx-desk.ts`).
  Polygon is the primary GEX source; UW spot-exposures is a logged last-resort fallback.
- **Gotcha — WS `flow_alerts` sends OCC option symbols, not split strike/expiry** (caused the "0C -" HELIX
  bug). `parseUwFlowAlert` + `parseOccSymbol` handle this; any new WS consumer must do the same.
- **Reminder (RT-5 lesson):** several rows here are `NOT VERIFIED` because the exact path/params/limits are
  not in a doc page that rendered. Do **not** infer them from our code's field-name guessing — confirm
  against the OpenAPI/category docs or a live probe before relying on them.
