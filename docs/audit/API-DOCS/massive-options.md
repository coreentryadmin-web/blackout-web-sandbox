# Massive Options API — Docs-Grounded Audit

**Scope:** Massive (Polygon-compatible) **Options** surface — `https://api.massive.com`, key `POLYGON_API_KEY`.
**Method:** Every endpoint/channel below was read **line-by-line from the official docs** (the `.md` render of `https://massive.com/docs/...`, enumerated from `https://massive.com/docs/llms.txt`). Our usage was cross-referenced against the live codebase under `C:\Users\raidu\blackout-platform\blackout-web\src`. Nothing here is inferred from code comments.
**Date:** 2026-06-24. **Plan note:** Our enforced limits + the WS quotes channel (Advanced-only) indicate we are on **Options Advanced (Individual)**. FMV (Business-only) is therefore out of plan unless upgraded — flagged below.

---

## 1. REST — Options Snapshots (the GEX / Night's Watch core)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| **Option Chain Snapshot** | `GET /v3/snapshot/options/{underlyingAsset}` | "Retrieve a comprehensive snapshot of all options contracts associated with a specified underlying ticker" — pricing, **greeks, IV, quotes, trades, open_interest** in one call | `strike_price[.gte/gt/lte/lt]`, `expiration_date[.gte/...]`, `contract_type`, `order`, `limit` (default 10, **max 250**), `sort` | ✅ USED — `polygon-options-gex.ts:844`, `spx-play-options.ts:71`, `spx-lotto-options.ts:79`, `spx-power-hour-engine.ts` (uses `I:SPX`), catalog `api-provider-catalog.ts:82` | Options Starter/Developer/Advanced; **real-time on Advanced** (15-min delayed Starter/Developer) | Keep. This is correctly our GEX backbone. Verify we read `greeks`+`implied_volatility`+`open_interest` directly off this rather than recomputing (see opportunities). |
| **Option Contract Snapshot** | `GET /v3/snapshot/options/{underlyingAsset}/{optionContract}` | "Retrieve a comprehensive snapshot of a specified options contract" — single-contract greeks (delta/gamma/theta/vega), IV, OI, day OHLC, last_quote, last_trade, break_even_price, underlying_asset | path: `underlyingAsset`, `optionContract` | ⬜ **AVAILABLE-UNUSED** — referenced only in docs/catalog/probe (`polygon-options-gex.ts:45` "A future optimization can swap to…", `:1928`; `polygon-docs-options-rest.ts:68`). **No live call.** | Options Starter and above; real-time on Advanced | **HIGH-VALUE GAP.** OPPORTUNITY: Night's Watch live mark + live greeks per held contract via 1 cheap REST call (delta/gamma/theta/vega/IV/OI/mid in one shot) — no full-chain pull, no recompute. Ideal warm-cache reader for the position manager and a fallback when the Q-only WS is quiet (mitigates RT-1 watchdog false-fires). |
| **Unified Snapshot** | `GET /v3/snapshot` | "Retrieve unified snapshots of market data for multiple asset classes" (stocks, options, forex, crypto) in one request; per-result: `break_even_price, greeks, implied_volatility, open_interest, last_quote, last_trade, session, underlying_asset, market_status, type` | `ticker`, `type`, `ticker.any_of` (**comma list, max 250**), `ticker[.gte/...]`, `order`, `limit` (default 10, max 250), `sort` | ⬜ **AVAILABLE-UNUSED** | Options Starter+; real-time on Advanced | **HIGH-VALUE GAP.** OPPORTUNITY: pull up to 250 mixed tickers (e.g. all of a user's held OCC contracts + `I:SPX` + underlyings) in **one** request with greeks/IV/OI inline. Slashes the per-position REST fan-out Night's Watch does today and respects our ~40 rps budget. The single best batching win on this surface. |

---

## 2. REST — Options Contracts (reference)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| **All Contracts** | `GET /v3/reference/options/contracts` | "Retrieve a comprehensive index of options contracts… both active and expired" | `underlying_ticker[.gte/...]`, `contract_type`, `expiration_date[.gte/...]`, `strike_price[.gte/...]`, `expired` (default false), `as_of` (YYYY-MM-DD), `limit` (default 10, **max 1000**), `order`, `sort` | ✅ USED — `cursor-api-analysis-data.ts:444/450`, catalog | "Included in all Options plans"; **updated daily** | Keep. Note `as_of` lets you reconstruct the historical chain on a past date — useful for backtests. |
| **Contract Overview** | `GET /v3/reference/options/contracts/{options_ticker}` | "Retrieve detailed information about a specific options contract" — type, exercise_style, expiration, strike, shares_per_contract, underlying, primary_exchange | path `options_ticker`; `as_of` (defaults today) | ⬜ **AVAILABLE-UNUSED** | All Options plans; updated daily; history to 2014-06-02 (Starter+) | Low priority. OPPORTUNITY: cheap canonical metadata + `shares_per_contract` validation for non-standard (adjusted) contracts before they corrupt GEX notional — guards split/adjusted multipliers. |

---

## 3. REST — Options Aggregates (OHLC)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| **Custom Bars** | `GET /v2/aggs/ticker/{optionsTicker}/range/{multiplier}/{timespan}/{from}/{to}` | "Aggregated historical OHLC and volume data for a specified options contract… in Eastern Time" | `adjusted`, `sort` (asc/desc), `limit` (default 5000, **max 50000**) | ⬜ **AVAILABLE-UNUSED with options tickers** (we call this path heavily for stocks/indices in `polygon.ts`, but no `O:`-ticker call found) | Select Options plans; real-time on Advanced | OPPORTUNITY: per-contract intraday minute bars → Night's Watch entry/exit chart + realized intraday P&L curve for a held option without recomputing from raw trades. |
| **Previous Day Bar** | `GET /v2/aggs/ticker/{optionsTicker}/prev` | "Previous trading day's OHLC for a specified option contract" | `adjusted` | ⬜ AVAILABLE-UNUSED (options ticker) | All Options plans | OPPORTUNITY: prior-close baseline for a held contract → overnight gap % on the option leg. |
| **Daily Ticker Summary** | `GET /v1/open-close/{optionsTicker}/{date}` | "Opening and closing prices for a specific options contract on a given date… pre-market and after-hours" | path `optionsTicker`,`date`; `adjusted` | ⬜ AVAILABLE-UNUSED (options ticker) | All Options plans | OPPORTUNITY: settle/close marks for journal & EOD position valuation in Night's Watch. |

> Note: these 3 aggregate paths ARE used by us, but only with **stock/index** tickers (`polygon.ts`, `spx-desk.ts`). They are documented as fully supporting option contract tickers (`O:...`). Marked unused **for options**.

---

## 4. REST — Options Trades & Quotes (tick / NBBO)

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| **Last Trade** | `GET /v2/last/trade/{optionsTicker}` | "Latest available trade for a specified options contract — price, size, exchange, timestamp" | path only | ⬜ AVAILABLE-UNUSED (options ticker; we call it for stocks in `polygon.ts`) | Developer/Advanced/Business only (**not** Basic/Starter); real-time Advanced | OPPORTUNITY: instant last-print mark for a held contract — lighter than a snapshot, perfect WS-quiet fallback (RT-1). |
| **Trades (tick)** | `GET /v3/trades/{optionsTicker}` | "Comprehensive, tick-level trade data for a specified options ticker within a time range" | `timestamp[.gte/...]`, `order`, `limit` (default 1000, **max 50000**), `sort`; resp: `conditions, exchange, price, size, sip_timestamp, sequence_number` | ⬜ AVAILABLE-UNUSED | Developer/Advanced/Business only; real-time Advanced; **history to 2014-06-02** | OPPORTUNITY: server-side option time & sales → reconstruct buy/sell aggressor and sweep detection per contract for Night's Watch fills, independent of UW. **NOTE:** our live probe logged this path returning **404** (`docs/polygon/rest/options/page.tsx:121`) — verify exact path/host before building (NOT VERIFIED via live call — needs a re-probe with a valid `O:` ticker + key). |
| **Quotes (NBBO history)** | `GET /v3/quotes/{optionsTicker}` | "Historical quotes for a specified options contract over a time range" — bid/ask price+size, exchanges, sip_timestamp | `timestamp[.gte/...]`, `order`, `limit` (default 1000, **max 50000**), `sort` | ⬜ AVAILABLE-UNUSED | **Advanced and Business only**; real-time Advanced; **history to 2022-03-07** | OPPORTUNITY: backfill the bid/ask path of a held contract when the WS dropped frames; spread-history analytics. Same **404-in-probe** caveat as Trades — re-verify path. |

---

## 5. REST — Options Technical Indicators

| Endpoint | Path | Purpose | Used? | Plan | Recommendation |
|---|---|---|---|---|---|
| **SMA** | `GET /v1/indicators/sma/{optionsTicker}` | SMA over a range; **explicitly supports option tickers** (doc sample uses `O:SPY241220P00720000`) | ⬜ UNUSED (options); used for stocks/indices | Select Options plans | Low priority. OPPORTUNITY: smoothed mark / IV-trend line on a held contract. |
| **EMA** | `GET /v1/indicators/ema/{optionsTicker}` | EMA over a range | ⬜ UNUSED (options) | Select Options plans | Low priority. |
| **MACD** | `GET /v1/indicators/macd/{optionsTicker}` | MACD over a range | ⬜ UNUSED (options) | Select Options plans | Low priority. |
| **RSI** | `GET /v1/indicators/rsi/{optionsTicker}` | RSI over a range | ⬜ UNUSED (options) | Select Options plans | Low priority — option-price RSI is noisy; not a priority for SPX intel. |

---

## 6. REST — Options Market Operations

| Endpoint | Path | Purpose | Used? | Plan | Recommendation |
|---|---|---|---|---|---|
| **Market Status** | `GET /v1/marketstatus/now` | "Current trading status for various exchanges and overall markets" — `afterHours`, `earlyHours`, exchange/index group statuses, `serverTime` | ✅ USED (shared with stocks; in our verified path list `/v1/marketstatus/{now,upcoming}`) | All Options plans; real-time | Keep. |
| **Market Holidays** | `GET /v1/marketstatus/upcoming` | Upcoming market holidays | ✅ USED (`marketstatus/upcoming`) | All Options plans | Keep. |
| **Condition Codes** | `GET /v3/reference/conditions` | "Unified… list of trade and quote conditions" | `asset_class`, `data_type`, `id`, `sip`, `order`, `limit` (max 1000), `sort` | ⬜ AVAILABLE-UNUSED | All Options plans; updated as needed | OPPORTUNITY: decode the `c` condition arrays on option trades (filter out non-addressable/odd-lot/multi-leg prints) so GEX & flow only count real, single-leg volume — a documented accuracy win. |
| **Exchanges** | `GET /v3/reference/exchanges` (options asset_class) | List of known exchanges | ⬜ AVAILABLE-UNUSED | All Options plans | Low priority — label `x`/exchange IDs in flow UI. |

---

## 7. WebSocket — Options (`wss://…/options`)

| Channel | Sub string | Purpose | Schema highlights | Used? (where) | Plan / limits | Recommendation |
|---|---|---|---|---|---|---|
| **Quotes** | `Q.<OCC>` (e.g. `Q.O:SPXW250616C05850000`) | "Stream quote data… current best bid/ask prices, sizes, and metadata as they update" | `ev=Q, sym, bx, ax, bp, ap, bs, as, t, q` | ✅ USED — `ws/options-socket.ts:292` (`Q.${s}`), subscribe/unsubscribe per held OCC | **Advanced & Business+Expansion only**; "**maximum of 1,000 option contracts per connection**"; real-time | Keep. This is the Night's Watch live-mark feed. Our 10×1000 cap matches the doc's 1000/conn limit. |
| **Trades** | `T.<OCC>` (`WS /options/T`) | "Stream tick-level trade data for option contracts" | `ev=T, sym, x, p, s, c[], t, q` | ⬜ **AVAILABLE-UNUSED** | Developer/Advanced/Business+Expansion; real-time on Advanced | **HIGH-VALUE GAP.** OPPORTUNITY: live option **prints** (price+size+conditions) for held/SPX contracts — gives true last-trade marks + live aggressor/sweep detection. Pairing T with Q removes reliance on UW for own-contract flow and **directly fixes RT-1**: a quiet contract still has Q heartbeats, but T confirms real activity, so the stall watchdog can key off "no Q frames at all" vs "no trades" correctly. |
| **Aggregates (per-minute)** | `AM.<OCC>` | "Stream minute-by-minute aggregated OHLC and volume" | `ev=AM, sym, v, av, op, vw, o, c, h, l, a, z, s, e` | ⬜ AVAILABLE-UNUSED | Starter/Developer/Advanced; real-time on Advanced | OPPORTUNITY: rolling 1-min option bars pushed live → Night's Watch sparkline + intraday option-volume surge alerts without polling aggregates REST. |
| **Aggregates (per-second)** | `A.<OCC>` | "Stream second-by-second aggregated OHLC and volume" | `ev=A` + same fields as AM | ⬜ AVAILABLE-UNUSED | Starter/Developer/Advanced (Business+Expansion); real-time on Advanced | Lower priority (per-second is heavy); useful only for power-hour 0DTE microstructure. |
| **Fair Market Value** | `FMV.<OCC>` (`WS /business/options/FMV`) | "Stream real-time Fair Market Value (FMV) data for a specified options contract" | `ev=FMV, fmv, sym, t` | ❓ **NEEDS-PLAN-ACCESS** | "**Available exclusively to Business plan users**"; 1000 contracts/conn | OPPORTUNITY (gated): FMV is a clean synthetic mid that survives wide/locked NBBO — the single best "true mark" for illiquid SPXW strikes and Night's Watch valuation. **Out of plan on Advanced** — quote a Business upgrade if illiquid-strike marks matter. Same FMV field exists in the REST snapshots (also Business-only). |

---

## Top missed-data opportunities (ranked)

1. **Unified Snapshot `GET /v3/snapshot` (`ticker.any_of`, up to 250)** — one request returns greeks + IV + OI + quote + trade for up to 250 mixed tickers. Collapses Night's Watch's per-position REST fan-out into a single batched call; biggest rps/latency win on the surface.
2. **Option Contract Snapshot `GET /v3/snapshot/options/{u}/{contract}`** — per-held-contract greeks/IV/OI/mark in one cheap call. Already flagged as a "future optimization" in our own code (`polygon-options-gex.ts:45`) but never wired. Direct Night's Watch valuation + WS-quiet fallback.
3. **Options Trades WS `T.<OCC>`** — live prints with conditions for held/SPX contracts; gives true last-trade marks + aggressor/sweep, and fixes the RT-1 stall-watchdog false-fire (distinguish "no quotes" from "no trades").
4. **Greeks/IV/OI already inside the chain snapshot** — confirm we read `greeks{delta,gamma,theta,vega}`, `implied_volatility`, and `open_interest` straight off `/v3/snapshot/options/{underlying}` instead of recomputing greeks. The docs say they're in the payload; recomputing is an accuracy + CPU regression risk for GEX.
5. **Condition Codes `/v3/reference/conditions`** — decode option-trade `c[]` conditions to exclude odd-lot / multi-leg / non-addressable prints from GEX & flow volume (documented accuracy improvement).
6. **AM.<OCC> per-minute aggregates WS** — push live 1-min option bars for sparklines / volume-surge alerts; removes aggregate-REST polling.
7. **Options Trades REST `/v3/trades/{optionsTicker}`** (history to 2014) — server-side option time & sales for fill reconstruction and backtests (re-verify path; 404 in our probe).
8. **FMV (Business-only, REST snapshot `fmv` field + `FMV.` WS)** — clean synthetic mid for illiquid SPXW strikes; **plan upgrade required** — quote it if illiquid-strike valuation accuracy matters for Night's Watch.

---

## Rate limits & gotchas (from the docs)

- **WS connection limit (documented):** "users can subscribe to a **maximum of 1,000 option contracts per connection**" — applies to `Q`, `T`, `AM`, `A`, and `FMV`. Our 10-conn × 1000-contract cap is doc-compliant.
- **REST page sizes (documented maxima):** chain snapshot `limit` **max 250**; unified snapshot `ticker.any_of` **max 250 tickers**, `limit` max 250; contracts reference `limit` **max 1000**; aggregates custom-bars `limit` **max 50000**; trades/quotes `limit` **max 50000**. Use these to minimize request counts under our ~40 rps budget.
- **No numeric REST RPS in the options docs.** The docs gate by **plan tier**, not a published requests/sec number. NOT VERIFIED — a hard options RPS figure is not in these doc pages; our `polygon-rate-limiter.ts` ~40 rps is a self-imposed value, not a documented Massive limit. Needs the account/plan dashboard or a live 429 probe to confirm.
- **Plan gating that affects us (Advanced):**
  - `Q` quotes WS, `/v3/quotes/{optionsTicker}` REST: **Advanced & Business only** — we have it.
  - `/v2/last/trade`, `/v3/trades`, `T` trades WS: **Developer/Advanced/Business** (not Basic/Starter) — available to us, unused.
  - **FMV (REST `fmv` field + `FMV.` WS): Business plan ONLY.** On Advanced this is out of plan → expect `fmv` to be null/absent; do **not** build Night's Watch valuation on FMV without upgrading.
  - Snapshots/aggregates: **real-time on Advanced** (15-min delayed on Starter/Developer) — our pipeline assumes real-time, consistent with Advanced.
- **Historical depth (documented):** options trades to **2014-06-02**; options quotes only to **2022-03-22** (`/v3/quotes`); chain history "all" on Advanced. Backfills earlier than these dates will be empty.
- **Live-probe discrepancy (our own note, not the docs):** `/v3/trades/{optionsTicker}` and `/v3/quotes/{optionsTicker}` "returned 404 in our live probe" (`src/app/docs/polygon/rest/options/page.tsx:121`). The **docs** clearly publish these paths, so this is a probe/path-encoding/plan issue, not a missing endpoint. NOT VERIFIED end-to-end — needs a re-probe with a URL-encoded `O:` ticker and the live key before relying on them.
- **`adjusted` defaults to true** on all aggregate/open-close options endpoints — for raw (unadjusted) option marks pass `adjusted=false`.
- **Index underlyings:** chain snapshot is called with `I:SPX` (`spx-power-hour-engine.ts`) and `SPXW` (`spx-play-options.ts`) — both are valid underlying identifiers per the path spec; SPX weeklys resolve under `SPXW`.
