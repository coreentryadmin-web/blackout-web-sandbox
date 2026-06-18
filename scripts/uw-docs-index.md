# UnusualWhales API

The official Unusual Whales API gives you 100+ endpoints for options flow, dark pool, congressional trading, Greek exposure, volatility, and more.

## Quick Start

**Base URL:** `https://api.unusualwhales.com`

**Authentication:** Bearer token in header
```
Authorization: Bearer YOUR_API_KEY
```

## Resources

- **OpenAPI Spec:** https://api.unusualwhales.com/api/openapi
- **Kafka Streaming:** https://unusualwhales.com/public-api/kafka
- **MCP Server:** https://unusualwhales.com/public-api/mcp
- **SKILL.md:** https://unusualwhales.com/skill.md
- **Check API Usage:** https://unusualwhales.com/information/how-to-check-your-api-usage

## Endpoints

### Gex/Greeks

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/stock/{ticker}/gex-levels` | GEX Levels | `PublicApi.TickerController.gex_levels` |
| `GET` | `/api/stock/{ticker}/greek-exposure` | Greek Exposure | `PublicApi.TickerController.greek_exposure` |
| `GET` | `/api/stock/{ticker}/greek-exposure/expiry` | Greek Exposure By Expiry | `PublicApi.TickerController.greek_exposure_by_expiry` |
| `GET` | `/api/stock/{ticker}/greek-exposure/strike` | Greek Exposure By Strike | `PublicApi.TickerController.greek_exposure_by_strike` |
| `GET` | `/api/stock/{ticker}/greek-exposure/strike-expiry` | Greek Exposure By Strike And Expiry | `PublicApi.TickerController.greek_exposure_by_strike_expiry` |
| `GET` | `/api/stock/{ticker}/greek-flow` | Greek flow | `PublicApi.TickerController.greek_flow` |
| `GET` | `/api/stock/{ticker}/greek-flow/{expiry}` | Greek flow by expiry | `PublicApi.TickerController.greek_flow_expiry` |
| `GET` | `/api/stock/{ticker}/spot-exposures` | Spot GEX exposures per 1min | `PublicApi.TickerController.spot_exposures_one_minute` |
| `GET` | `/api/stock/{ticker}/spot-exposures/expiry-strike` | Spot GEX exposures by strike & expiry | `PublicApi.TickerController.spot_exposures_by_strike_expiry_v2` |
| `GET` | `/api/stock/{ticker}/spot-exposures/strike` | Spot GEX exposures by strike | `PublicApi.TickerController.spot_exposures_by_strike` |
| `GET` | `/api/stock/{ticker}/spot-exposures/{expiry}/strike` | Spot GEX exposures by strike & expiry (Deprecated) | `PublicApi.TickerController.spot_exposures_by_strike_expiry` |


### alerts

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/alerts` | Alerts | `PublicApi.AlertsController.alerts` |
| `GET` | `/api/alerts/configuration` | Alert configurations | `PublicApi.AlertsController.configs` |


### commodities

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/commodities/{name}` | Commodity Series | `PublicApi.CommoditiesController.show` |


### companies

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/companies/{ticker}/dividends` | Company Dividends | `PublicApi.CompaniesController.dividends` |
| `GET` | `/api/companies/{ticker}/earnings-estimates` | Forward Earnings Estimates | `PublicApi.CompaniesController.earnings_estimates` |
| `GET` | `/api/companies/{ticker}/profile` | Company Profile | `PublicApi.CompaniesController.profile` |
| `GET` | `/api/companies/{ticker}/splits` | Company Stock Splits | `PublicApi.CompaniesController.splits` |
| `GET` | `/api/companies/{ticker}/transcripts/{quarter}` | Earnings Call Transcript | `PublicApi.CompaniesController.transcript` |


### congress

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/congress/congress-trader` | Recent Reports By Trader | `PublicApi.CongressController.congress_trader` |
| `GET` | `/api/congress/late-reports` | Recent Late Reports | `PublicApi.CongressController.congress_late_reports` |
| `GET` | `/api/congress/politicians` | List of Politicians with Trade Data | `PublicApi.CongressController.congress_politicians` |
| `GET` | `/api/congress/recent-trades` | Recent Congress Trades | `PublicApi.CongressController.congress_recent_trades` |


### crypto

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/crypto/whale-transactions` | Crypto Whale Transactions | `PublicApi.CryptoController.whale_transactions` |
| `GET` | `/api/crypto/whales/recent` | Recent Crypto Whale Trades | `PublicApi.CryptoController.whales_recent` |
| `GET` | `/api/crypto/{pair}/ohlc/{candle_size}` | Crypto OHLC Candles | `PublicApi.CryptoController.ohlc` |
| `GET` | `/api/crypto/{pair}/state` | Crypto Pair State | `PublicApi.CryptoController.state` |


### darkpool

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/darkpool/recent` | Recent Darkpool Trades | `PublicApi.DarkpoolController.darkpool_recent` |
| `GET` | `/api/darkpool/{ticker}` | Ticker Darkpool Trades | `PublicApi.DarkpoolController.darkpool_ticker` |


### digital_currencies

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/digital-currencies/history` | Digital Currency Historical Series | `PublicApi.DigitalCurrenciesController.history` |
| `GET` | `/api/digital-currencies/intraday` | Digital Currency Intraday Series | `PublicApi.DigitalCurrenciesController.intraday` |


### earnings

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/earnings/afterhours` | Afterhours | `PublicApi.EarningsController.afterhours` |
| `GET` | `/api/earnings/premarket` | Premarket | `PublicApi.EarningsController.premarket` |
| `GET` | `/api/earnings/{ticker}` | Historical Ticker Earnings | `PublicApi.EarningsController.ticker` |


### economy

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/economy/{indicator}` | Economic Indicator | `PublicApi.EconomyController.show` |


### etfs

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/etfs/{ticker}/exposure` | Exposure | `PublicApi.EtfController.exposure` |
| `GET` | `/api/etfs/{ticker}/holdings` | Holdings | `PublicApi.EtfController.holdings` |
| `GET` | `/api/etfs/{ticker}/in-outflow` | Inflow & Outflow | `PublicApi.EtfController.in_outflow` |
| `GET` | `/api/etfs/{ticker}/info` | Information | `PublicApi.EtfController.info` |
| `GET` | `/api/etfs/{ticker}/weights` | Sector & Country weights | `PublicApi.EtfController.weights` |


### forex

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/forex/history` | FX Historical Series | `PublicApi.ForexController.history` |
| `GET` | `/api/forex/intraday` | FX Intraday Series | `PublicApi.ForexController.intraday` |
| `GET` | `/api/forex/rate` | FX Spot Rate | `PublicApi.ForexController.rate` |


### group_flow

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/group-flow/{flow_group}/greek-flow` | Greek flow | `PublicApi.GroupFlowController.greek_flow` |
| `GET` | `/api/group-flow/{flow_group}/greek-flow/{expiry}` | Greek flow by expiry | `PublicApi.GroupFlowController.greek_flow_expiry` |


### insiders

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/insider/transactions` | Transactions | `PublicApi.InsiderController.transactions` |
| `GET` | `/api/insider/{sector}/sector-flow` | Sector Flow | `PublicApi.InsiderController.sector_flow` |
| `GET` | `/api/insider/{ticker}` | Insiders | `PublicApi.InsiderController.insiders` |
| `GET` | `/api/insider/{ticker}/ticker-flow` | Ticker Flow | `PublicApi.InsiderController.ticker_flow` |


### institution

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/institution/{name}/activity` | Institutional Activity (Deprecated) | `PublicApi.InstitutionController.activity` |
| `GET` | `/api/institution/{name}/activity/v2` | Institutional Activity | `PublicApi.InstitutionController.activity_v2` |
| `GET` | `/api/institution/{name}/holdings` | Institutional Holdings | `PublicApi.InstitutionController.holdings` |
| `GET` | `/api/institution/{name}/sectors` | Sector Exposure | `PublicApi.InstitutionController.sectors` |
| `GET` | `/api/institution/{ticker}/ownership` | Institutional Ownership | `PublicApi.InstitutionController.ownership` |
| `GET` | `/api/institutions` | List of Institutions | `PublicApi.InstitutionController.list` |
| `GET` | `/api/institutions/latest_filings` | Latest Filings | `PublicApi.InstitutionController.latest_filings` |


### intel

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/analytics/sliding` | Sliding-Window Analytics | `PublicApi.IntelController.analytics_sliding` |
| `GET` | `/api/analytics/window` | Fixed-Window Analytics | `PublicApi.IntelController.analytics_window` |
| `GET` | `/api/calendar/ipo` | IPO Calendar | `PublicApi.IntelController.ipo_calendar` |
| `GET` | `/api/companies/listings` | Active or Delisted Securities | `PublicApi.IntelController.listings` |
| `GET` | `/api/market/movers` | Top Movers | `PublicApi.IntelController.movers` |


### lit-flow

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/lit-flow/recent` | Recent Lit Flow Trades | `PublicApi.LitFlowController.lit_flow_recent` |
| `GET` | `/api/lit-flow/{ticker}` | Ticker Lit Flow Trades | `PublicApi.LitFlowController.lit_flow_ticker` |


### market

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/market/correlations` | Correlations | `PublicApi.MarketController.correlations` |
| `GET` | `/api/market/economic-calendar` | Economic calendar | `PublicApi.MarketController.events` |
| `GET` | `/api/market/fda-calendar` | FDA Calendar | `PublicApi.MarketController.fda_calendar` |
| `GET` | `/api/market/insider-buy-sells` | Total Insider Buy & Sells | `PublicApi.MarketController.insider_buy_sells` |
| `GET` | `/api/market/market-tide` | Market Tide | `PublicApi.MarketController.market_tide` |
| `GET` | `/api/market/oi-change` | OI Change | `PublicApi.MarketController.oi_change` |
| `GET` | `/api/market/sector-etfs` | Sector Etfs | `PublicApi.MarketController.sector_etfs` |
| `GET` | `/api/market/top-net-impact` | Top Net Impact | `PublicApi.MarketController.top_net_impact` |
| `GET` | `/api/market/total-options-volume` | Total Options Volume | `PublicApi.MarketController.total_options_volume` |
| `GET` | `/api/market/{sector}/sector-tide` | Sector Tide | `PublicApi.MarketController.sec_indst` |
| `GET` | `/api/market/{ticker}/etf-tide` | ETF Tide | `PublicApi.MarketController.etf_tide` |
| `GET` | `/api/net-flow/expiry` | Net Flow Expiry | `PublicApi.NetFlowController.expiry` |


### news

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/news/headlines` | News Headlines | `PublicApi.NewsController.headlines` |


### option-contract

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/option-contract/{id}/flow` | Flow Data | `PublicApi.OptionContractController.flow` |
| `GET` | `/api/option-contract/{id}/historic` | Historic Data | `PublicApi.OptionContractController.history` |
| `GET` | `/api/option-contract/{id}/intraday` | Intraday Data | `PublicApi.OptionContractController.intraday` |
| `GET` | `/api/option-contract/{id}/volume-profile` | Volume Profile | `PublicApi.OptionContractController.volume_profile` |
| `GET` | `/api/stock/{ticker}/expiry-breakdown` | Expiry Breakdown | `PublicApi.OptionContractController.expiry_breakdown` |
| `GET` | `/api/stock/{ticker}/option-contracts` | Option contracts | `PublicApi.OptionContractController.option_contracts` |


### option-trade

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/option-trades/exchange-breakdown/{date}` | Exchange & Trade Code Breakdown | `PublicApi.OptionTradeController.exchange_breakdown` |
| `GET` | `/api/option-trades/flow-alerts` | Flow Alerts | `PublicApi.OptionTradeController.flow_alerts` |
| `GET` | `/api/option-trades/flow-alerts/{id}` | Flow Alert by ID | `PublicApi.OptionTradeController.flow_alert` |
| `GET` | `/api/option-trades/full-tape/{date}` | Full Tape | `PublicApi.OptionTradeController.full_tape` |
| `GET` | `/api/option-trades/optionable-tickers` | Optionable Tickers | `PublicApi.OptionTradeController.optionable_tickers` |


### politician_portfolios

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/politician-portfolios/disclosures` | Annual Disclosures List | `PublicApi.PoliticianPortfoliosController.disclosures` |
| `GET` | `/api/politician-portfolios/holders/{ticker}` | Politician Portfolio Holders by Ticker | `PublicApi.PoliticianPortfoliosController.holds_ticker` |
| `GET` | `/api/politician-portfolios/people` | Politicians List | `PublicApi.PoliticianPortfoliosController.people` |
| `GET` | `/api/politician-portfolios/recent_trades` | Politician Trades | `PublicApi.PoliticianPortfoliosController.recent_trades` |
| `GET` | `/api/politician-portfolios/{politician_id}` | Politician Portfolios | `PublicApi.PoliticianPortfoliosController.portfolios` |


### predictions

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/predictions/insiders` | Prediction Market Insiders | `PublicApi.PredictionController.insiders` |
| `GET` | `/api/predictions/market/{asset_id}` | Prediction Market Details | `PublicApi.PredictionController.market` |
| `GET` | `/api/predictions/market/{asset_id}/liquidity` | Prediction Market Liquidity | `PublicApi.PredictionController.liquidity` |
| `GET` | `/api/predictions/market/{asset_id}/positions` | Prediction Market Positions | `PublicApi.PredictionController.positions` |
| `GET` | `/api/predictions/search-users` | Search Prediction Market Users | `PublicApi.PredictionController.search_users` |
| `GET` | `/api/predictions/smart-money` | Prediction Smart Money | `PublicApi.PredictionController.smart_money` |
| `GET` | `/api/predictions/unusual` | Unusual Prediction Markets | `PublicApi.PredictionController.unusual` |
| `GET` | `/api/predictions/user/{user_id}` | Prediction Market User | `PublicApi.PredictionController.user` |
| `GET` | `/api/predictions/whales` | Prediction Market Whales | `PublicApi.PredictionController.whales` |


### private_markets

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/private-markets/companies` | List Private Markets Companies | `PublicApi.PrivateMarketsController.companies` |
| `GET` | `/api/private-markets/companies/{npm_ticker}` | Private Markets Company Profile | `PublicApi.PrivateMarketsController.company_profile` |
| `GET` | `/api/private-markets/companies/{npm_ticker}/funding` | Private Markets Funding Rounds | `PublicApi.PrivateMarketsController.funding` |
| `GET` | `/api/private-markets/companies/{npm_ticker}/investors` | Private Markets Investors for Company | `PublicApi.PrivateMarketsController.investors` |
| `GET` | `/api/private-markets/companies/{npm_ticker}/management` | Private Markets Management | `PublicApi.PrivateMarketsController.management` |
| `GET` | `/api/private-markets/companies/{npm_ticker}/pricing` | Private Markets Pricing History | `PublicApi.PrivateMarketsController.pricing` |
| `GET` | `/api/private-markets/investors` | Top Private Markets Investors | `PublicApi.PrivateMarketsController.top_investors` |
| `GET` | `/api/private-markets/investors/{name}` | Private Markets Investor Profile | `PublicApi.PrivateMarketsController.investor_profile` |
| `GET` | `/api/private-markets/search` | Search Private Markets | `PublicApi.PrivateMarketsController.search` |


### screener

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/screener/analysts` | Analyst Rating | `PublicApi.ScreenerController.analyst_ratings` |
| `GET` | `/api/screener/option-contracts` | Hottest Chains | `PublicApi.ScreenerController.contract_screener` |
| `GET` | `/api/screener/stocks` | Stock Screener | `PublicApi.ScreenerController.stock_screener` |


### seasonality

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/seasonality/market` | Market Seasonality | `PublicApi.SeasonalityController.market_seasonality` |
| `GET` | `/api/seasonality/{month}/performers` | Month Performers | `PublicApi.SeasonalityController.month_performers` |
| `GET` | `/api/seasonality/{ticker}/monthly` | Average return per month | `PublicApi.SeasonalityController.monthly` |
| `GET` | `/api/seasonality/{ticker}/year-month` | Price change per month per year | `PublicApi.SeasonalityController.year_month` |


### short

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/short_screener` | Short Screener | `PublicApi.ShortController.short_screener` |
| `GET` | `/api/shorts/{ticker}/data` | Short Data | `PublicApi.ShortController.short_data` |
| `GET` | `/api/shorts/{ticker}/ftds` | Failures to Deliver | `PublicApi.ShortController.failures_to_deliver` |
| `GET` | `/api/shorts/{ticker}/interest-float` | V1 Short Interest and Float (Deprecated) | `PublicApi.ShortController.short_interest_and_float` |
| `GET` | `/api/shorts/{ticker}/interest-float/v2` | V2 Short Interest and Float | `PublicApi.ShortController.short_interest_and_float_v2` |
| `GET` | `/api/shorts/{ticker}/volume-and-ratio` | Short Volume and Ratio | `PublicApi.ShortController.short_volume_and_ratio` |
| `GET` | `/api/shorts/{ticker}/volumes-by-exchange` | Short Volume By Exchange | `PublicApi.ShortController.short_volume_by_exchange` |


### stock

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/stock/{sector}/tickers` | Companies in Sector | `PublicApi.TickerController.companies_in_sector` |
| `GET` | `/api/stock/{ticker}/atm-chains` | ATM Chains | `PublicApi.TickerController.atm_chains` |
| `GET` | `/api/stock/{ticker}/balance-sheets` | Balance Sheets | `PublicApi.AvFundamentalController.balance_sheets` |
| `GET` | `/api/stock/{ticker}/cash-flows` | Cash Flow Statements | `PublicApi.AvFundamentalController.cash_flows` |
| `GET` | `/api/stock/{ticker}/earnings` | Earnings History | `PublicApi.AvFundamentalController.earnings` |
| `GET` | `/api/stock/{ticker}/financials` | Full Financials | `PublicApi.AvFundamentalController.financials` |
| `GET` | `/api/stock/{ticker}/flow-alerts` | Flow Alerts | `PublicApi.TickerController.flow_alerts` |
| `GET` | `/api/stock/{ticker}/flow-per-expiry` | Flow per expiry | `PublicApi.TickerController.flow_per_expiry` |
| `GET` | `/api/stock/{ticker}/flow-per-strike` | Flow per strike | `PublicApi.TickerController.flow_per_strike` |
| `GET` | `/api/stock/{ticker}/flow-per-strike-intraday` | Flow per strike intraday | `PublicApi.TickerController.flow_per_strike_intraday` |
| `GET` | `/api/stock/{ticker}/flow-recent` | Recent flows | `PublicApi.TickerController.flow_recent` |
| `GET` | `/api/stock/{ticker}/fundamental-breakdown` | Fundamental Breakdown | `PublicApi.FundamentalController.show` |
| `GET` | `/api/stock/{ticker}/greeks` | Greeks | `PublicApi.TickerController.greeks` |
| `GET` | `/api/stock/{ticker}/historical-risk-reversal-skew` | Historical Risk Reversal Skew | `PublicApi.TickerController.historical_risk_reversal_skew` |
| `GET` | `/api/stock/{ticker}/income-statements` | Income Statements | `PublicApi.AvFundamentalController.income_statements` |
| `GET` | `/api/stock/{ticker}/info` | Information | `PublicApi.TickerController.info` |
| `GET` | `/api/stock/{ticker}/insider-buy-sells` | Insider buy & sells | `PublicApi.TickerController.insider_buy_sell` |
| `GET` | `/api/stock/{ticker}/interpolated-iv` | Interpolated IV | `PublicApi.TickerController.interpolated_iv` |
| `GET` | `/api/stock/{ticker}/iv-rank` | IV Rank | `PublicApi.TickerController.iv_rank` |
| `GET` | `/api/stock/{ticker}/max-pain` | Max Pain | `PublicApi.TickerController.max_pain` |
| `GET` | `/api/stock/{ticker}/net-prem-ticks` | Call/Put Net/Vol Ticks | `PublicApi.TickerController.net_prem_ticks` |
| `GET` | `/api/stock/{ticker}/nope` | Nope | `PublicApi.TickerController.nope` |
| `GET` | `/api/stock/{ticker}/ohlc/{candle_size}` | OHLC | `PublicApi.TickerController.ohlc` |
| `GET` | `/api/stock/{ticker}/oi-change` | OI Change | `PublicApi.TickerController.oi_change` |
| `GET` | `/api/stock/{ticker}/oi-per-expiry` | OI per Expiry | `PublicApi.TickerController.oi_per_expiry` |
| `GET` | `/api/stock/{ticker}/oi-per-strike` | OI per Strike | `PublicApi.TickerController.oi_per_strike` |
| `GET` | `/api/stock/{ticker}/option-chains` | Option Chains | `PublicApi.TickerController.option_chains` |
| `GET` | `/api/stock/{ticker}/option/stock-price-levels` | Option Price Levels | `PublicApi.TickerController.option_price_level` |
| `GET` | `/api/stock/{ticker}/option/volume-oi-expiry` | Volume & OI per Expiry | `PublicApi.TickerController.vol_oi_per_expiry` |
| `GET` | `/api/stock/{ticker}/options-volume` | Options Volume | `PublicApi.TickerController.options_volume` |
| `GET` | `/api/stock/{ticker}/ownership` | Ownership | `PublicApi.TickerController.ownership` |
| `GET` | `/api/stock/{ticker}/stock-state` | Stock State | `PublicApi.TickerController.last_stock_state` |
| `GET` | `/api/stock/{ticker}/stock-volume-price-levels` | Off/Lit Price Levels | `PublicApi.TickerController.stock_volume_price_level` |
| `GET` | `/api/stock/{ticker}/technical-indicator/{function}` | Technical Indicator | `PublicApi.AvFundamentalController.technical_indicator` |
| `GET` | `/api/stock/{ticker}/volatility/realized` | Realized Volatility | `PublicApi.TickerController.realized_volatility` |
| `GET` | `/api/stock/{ticker}/volatility/stats` | Volatility Statistics | `PublicApi.TickerController.volatility_stats` |
| `GET` | `/api/stock/{ticker}/volatility/term-structure` | Implied Volatility Term Structure | `PublicApi.TickerController.implied_volatility_term_structure` |


### stock-directory

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/stock-directory/ticker-exchanges` | Ticker Exchange Mapping | `PublicApi.StockDirectoryController.ticker_exchanges` |


### unusual_trades

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/congress/unusual-trades` | Unusual Congressional Trades | `PublicApi.UnusualTradesController.recent` |
| `GET` | `/api/congress/unusual-trades/by-tickers` | Unusual Trades by Ticker | `PublicApi.UnusualTradesController.by_tickers` |
| `GET` | `/api/congress/unusual-trades/chart-data` | Unusual Trades Chart Data | `PublicApi.UnusualTradesController.chart_data` |
| `GET` | `/api/congress/unusual-trades/stats` | Unusual Trades Aggregate Stats | `PublicApi.UnusualTradesController.stats` |


### volatility

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/stock/{ticker}/volatility/anomaly` | Volatility Anomaly Score | `PublicApi.VolatilityController.anomaly` |
| `GET` | `/api/stock/{ticker}/volatility/character` | Volatility Character | `PublicApi.VolatilityController.character` |
| `GET` | `/api/stock/{ticker}/volatility/variance-risk-premium` | Variance Risk Premium | `PublicApi.VolatilityController.variance_risk_premium` |
| `GET` | `/api/volatility/anomaly/top` | Top Volatility Anomalies | `PublicApi.VolatilityController.anomaly_top` |
| `GET` | `/api/volatility/character/top` | Top Volatility Character | `PublicApi.VolatilityController.character_top` |
| `GET` | `/api/volatility/vix-term-structure` | VIX Term Structure | `PublicApi.VolatilityController.vix_term_structure` |


### websocket

| Method | Path | Description | Operation ID |
|--------|------|-------------|--------------|
| `GET` | `/api/socket` | WebSocket channels | `PublicApi.SocketController.channels` |
| `GET` | `/api/socket/contract_screener` | Contract screener | `PublicApi.SocketController.contract_screener` |
| `GET` | `/api/socket/custom_alerts` | Custom alerts | `PublicApi.SocketController.custom_alerts` |
| `GET` | `/api/socket/flow_alerts` | Flow alerts | `PublicApi.SocketController.flow_alerts` |
| `GET` | `/api/socket/gex` | GEX | `PublicApi.SocketController.gex` |
| `GET` | `/api/socket/interval_flow` | Ticker Interval flow | `PublicApi.SocketController.interval_flow` |
| `GET` | `/api/socket/lit_trades` | Lit trades | `PublicApi.SocketController.lit_trades` |
| `GET` | `/api/socket/market_tide` | Market tide | `PublicApi.SocketController.market_tide` |
| `GET` | `/api/socket/net_flow` | Net flow | `PublicApi.SocketController.net_flow` |
| `GET` | `/api/socket/news` | News | `PublicApi.SocketController.news` |
| `GET` | `/api/socket/off_lit_trades` | Off-lit trades | `PublicApi.SocketController.off_lit_trades` |
| `GET` | `/api/socket/option_trades` | Option trades | `PublicApi.SocketController.option_trades` |
| `GET` | `/api/socket/price` | Price | `PublicApi.SocketController.price` |
| `GET` | `/api/socket/trading_halts` | Trading halts | `PublicApi.SocketController.trading_halts` |



---

For endpoint details, use the Operation ID from the table above:

```
curl -H "Accept: text/plain" https://api.unusualwhales.com/docs/operations/{operation_id}
```

Example:
```bash
curl -H "Accept: text/plain" https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_ticker
```

For support: dev@unusualwhales.com
