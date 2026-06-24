# Massive Indices (Indices Advanced) — Docs-Grounded API Audit

> Scope: the **Massive Indices** surface (REST + WebSocket) — CRITICAL for the SPX desk.
> Method: every endpoint/channel below was read **line-by-line from the official Massive docs**
> (`https://massive.com/docs/...`, fetched as the `.md` source pages enumerated in
> `https://massive.com/docs/llms.txt`). Behavior is quoted from the docs, **never inferred from
> code comments** — that exact mistake caused incident RT-5. Cross-referenced against our code under
> `C:\Users\raidu\blackout-platform\blackout-web\src`.
> Base URL: `https://api.massive.com` · Key env: `POLYGON_API_KEY` · WS cluster: `wss://socket.massive.com/indices`.
> Audited: 2026-06-24.

Legend: ✅ USED · ⬜ AVAILABLE-UNUSED · ❓ NEEDS-PLAN-ACCESS

---

## 0. RT-5 CORRECTION — CONFIRMED FROM THE DOCS (read this first)

The technical-indicator endpoints **DO support index tickers** (`I:SPX`, `I:NDX`, …). Quoted from the
official Massive doc pages:

| Indicator | Doc path | Path param | Doc evidence (quoted) | Plan note (quoted) |
|---|---|---|---|---|
| SMA | `/docs/rest/indices/technical-indicators/simple-moving-average.md` | `GET /v1/indicators/sma/{indicesTicker}` | sample response uses **`I:NDX`**; param = "The ticker symbol for which to get simple moving average (SMA) data" | **"Included in all Indices plans"** (Basic EOD / Starter 15-min / **Advanced & Business real-time**) |
| EMA | `/docs/rest/indices/technical-indicators/exponential-moving-average.md` | `GET /v1/indicators/ema/{indicesTicker}` | sample response uses **`I:NDX`** | **"Included in all Indices plans"** |
| RSI | `/docs/rest/indices/technical-indicators/relative-strength-index.md` | `GET /v1/indicators/rsi/{indicesTicker}` | "the endpoint accepts indices tickers"; sample uses **`I:NDX`** | **"Included in all Indices plans"** |
| MACD | `/docs/rest/indices/technical-indicators/moving-average-convergence-divergence.md` | `GET /v1/indicators/macd/{indicesTicker}` | sample response uses **`I:NDX`**, format `I:[symbol]` | **"Included in all Indices plans"** |

**Implication for our code:** Two files still carry the *pre-RT-5* false belief and should be reconciled:
- `src/lib/providers/ma-math.ts` (lines 1–4) header comment: *"Polygon's /v1/indicators/{ema,sma} endpoints do NOT support index tickers (e.g. I:SPX) and return 'Request failed'"* — **contradicted by the docs.** (The math helpers themselves are fine as a *fallback*; only the rationale comment is wrong.)
- `src/lib/spx-play-technicals.ts` computes RSI in-process via a local `rsi(bars, period=14)` function (line 63) instead of calling the documented `/v1/indicators/rsi/I:SPX`.
- ✅ **Correctly reconciled already:** `src/lib/providers/polygon.ts` (lines 597–608, 631–698) uses the documented indicator endpoints with `I:` tickers as **PRIMARY** and bars-math only as a transient-failure fallback, with an inline note that "the docs confirm they ARE" supported. This is the RT-5 fix; the two files above are the remaining drift.

---

## 1. Technical Indicators (server-computed) — `I:` tickers supported

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| SMA | `GET /v1/indicators/sma/{indicesTicker}` | Server-computed simple MA over index history | `timestamp`, `timespan`, `adjusted`, `window`, `series_type`, `expand_underlying`, `order`, `limit`, `timestamp.{gte,gt,lte,lt}` | ✅ `polygon.ts` `fetchIndexSma` (l.657); `polygon-largo.ts` l.141 | "Included in all Indices plans"; real-time on Advanced; history back to **2023-02-14** | Keep. Fix the stale "unsupported" comment in `ma-math.ts`. |
| EMA | `GET /v1/indicators/ema/{indicesTicker}` | Server-computed exponential MA | same as SMA | ✅ `polygon.ts` `fetchIndexEma` (l.638); `polygon-largo.ts` l.130; `polygon.ts` l.500 | "Included in all Indices plans" | Keep (primary), bars-math fallback OK. |
| RSI | `GET /v1/indicators/rsi/{indicesTicker}` | Server-computed RSI | `window` (default 14), `timespan`, `series_type`, `order`, `limit` (max **5000**, default 10), `timestamp.*` | ✅ `polygon.ts` `fetchIndexRsi` (l.693), l.511; `polygon-largo.ts` l.119 — but ⬜ **NOT** used by `spx-play-technicals.ts` (manual `rsi()`) | "Included in all Indices plans"; real-time on Advanced | Route the SPX-play 5m RSI through `fetchIndexRsi('I:SPX',14,'minute')` to drop hand-rolled math. |
| MACD | `GET /v1/indicators/macd/{indicesTicker}` | Server-computed MACD line/signal/histogram | `timespan`, `short_window`, `long_window`, `signal_window`, `series_type`, `order`, `limit` | ✅ `polygon-largo.ts` l.96 (Largo). ⬜ not wired into the **SPX desk** | "Included in all Indices plans" | OPPORTUNITY (below) — add MACD to the SPX desk momentum panel. |
| VWAP | *(no indices VWAP endpoint in docs)* | — | — | ✅ derived from bars (`polygon.ts` `computeIndexVwapFromBars` l.670) | n/a | Correct: docs list **no** `/v1/indicators/vwap` for indices; deriving from RTH minute bars is the right call. |

**Response shape (all four):** `next_url`, `request_id`, `status`, `results.underlying`, `results.values[]`
(each value has `timestamp` + the indicator value; MACD adds signal/histogram). `expand_underlying=true`
returns the aggregate bars used in the computation.

---

## 2. Snapshots

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Indices Snapshot | `GET /v3/snapshot/indices` | Real-time value + session OHLC/Δ for a batch of indices | `ticker.any_of` (CSV, **up to 250**), `ticker`, `ticker.{gte,gt,lte,lt}`, `order`, `limit` (max **250**), `sort` | ✅ `polygon.ts` `fetchIndexSnapshots` (l.352) — `ticker.any_of=I:SPX,I:VIX,…`; surfaced at `/api/market/indices` | ❓→✅ **"Included in select Indices plans"** — Starter (15-min), **Advanced (real-time)**, Business. **"Not included" in Indices Basic.** We're on Advanced. | Keep. This is the desk's primary REST spot source. |
| Unified Snapshot | `GET /v3/snapshot` | Cross-asset snapshot (stocks, options, fx, crypto, **indices**) in one call | `ticker`, `type`, `ticker.{any_of,gte,gt,lte,lt}`, `order`, `limit`, `sort` | ⬜ catalogued (`docs-usage-summary.json` l.512) but **not called** for indices | "Included in select Indices plans" (Starter 15-min / Advanced & Business real-time) | OPPORTUNITY — one call can fetch `I:SPX` value **+** SPX/SPXW option contracts **+** SPY together (cross-asset desk hydrate). |

**Indices-snapshot response highlights (quoted fields):** `results[].ticker`, `name`, `value`,
`market_status`, `type` (="indices"), `last_updated`, `timeframe` (**DELAYED or REAL-TIME** — confirms
our plan tier at runtime), and a `session` object: `change`, `change_percent`, `open`, `close`, `high`,
`low`, `previous_close`.

---

## 3. Aggregates / Bars

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Custom Bars (OHLC) | `GET /v2/aggs/ticker/{indicesTicker}/range/{multiplier}/{timespan}/{from}/{to}` | OHLC candles at any multiplier/timespan | path: `multiplier`, `timespan`, `from`, `to`; query: `sort`, `limit` | ✅ `polygon.ts` `fetchIndexMinuteBars`/`fetchIndexDailyBars` (used by `indexClosesAsc` l.621, VWAP, desk) | **"Included in all Indices plans"** (Basic EOD / Starter 15-min / **Advanced real-time**); history to **2023-02-14** | Keep. Note results carry `c/h/l/o/t` — **indices bars have no `v` (volume) or `vw`** (it's an index, not a traded instrument). |
| Previous-Day Bar | `GET /v2/aggs/ticker/{indicesTicker}/prev` | Prior session OHLC (one bar) | `indicesTicker` only | ✅ catalogued + used as prev-close source (`docs-usage-summary.json` l.491) | "Included in all Indices plans" | Keep. |
| Daily Ticker Summary | `GET /v1/open-close/{indicesTicker}/{date}` | Single-day open/high/low/close (+ pre/after fields) | `indicesTicker`, `date` (YYYY-MM-DD) | ✅ catalogued (`docs-usage-summary.json` l.498) | "Included in all Indices plans" | Keep. Fields: `open, high, low, close, from, symbol, afterHours, preMarket, status`. |
| Grouped Daily | *(not under the Indices doc tree)* | — | — | ✅ used for **stocks** only | n/a | The `/v2/aggs/grouped` endpoint we call is the stocks-locale one; it is **not** in the Indices doc surface — no action. |

---

## 4. Reference / Tickers

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| All Tickers | `GET /v3/reference/tickers?market=indices` | Enumerate available index tickers | `market`(=indices), `type`, `ticker`, `search`, `active`, `order`, `limit`, `ticker.{gte,gt,lte,lt}` | ⬜ we call `/v3/reference/tickers` for stocks/options; **not with `market=indices`** | "Included in all Indices plans"; **Updated hourly** | OPPORTUNITY — discover the full index universe Massive serves (sector sub-indices, breadth internals) rather than hard-coding `I:SPX/I:VIX/...`. |
| Ticker Overview | `GET /v3/reference/tickers/{ticker}` | Metadata for one index ticker | `ticker` (case-sensitive), `date` (optional point-in-time) | ⬜ used for equities; not for `I:` index tickers | "Included in all Indices plans"; Updated hourly | Minor — index `name`/`type` metadata for desk labels. |

---

## 5. Market Operations

| Endpoint | Path | Purpose | Key params | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Market Status | `GET /v1/marketstatus/now` | Real-time open/closed incl. **`indicesGroups`** | none | ✅ `admin-api-dashboard.ts` l.145; catalogued l.554 | "Included in all Indices plans"; **"Updated in real time"** | Keep. `indicesGroups` covers `s_and_p, dow_jones, nasdaq, ftse_russell, msci, mstar, mstarc, cccy, cgi, societe_generale` — **we only read top-level `market`**; could gate SPX-desk logic on `indicesGroups.s_and_p`. |
| Market Holidays | `GET /v1/marketstatus/upcoming` | Upcoming holiday open/close schedule | none | ✅ catalogued (`docs-usage-summary.json` l.547) | "Included in all Indices plans"; "Updated as needed" | Keep. Fields: `date, exchange, name, status` ("closed"/"early-close"), `open`, `close`. |

---

## 6. WebSocket — cluster `wss://socket.massive.com/indices`

Subscribe syntax: `{ "action":"subscribe", "params":"<CH>.I:SPX,<CH>.I:VIX,..." }` (auth with
`POLYGON_API_KEY` first). `<CH>.*` subscribes to all index tickers.

| Channel | Path / prefix | Purpose | Subscribe example | Used? (where) | Rate-limit / plan | Recommendation |
|---|---|---|---|---|---|---|
| Value | `WS /indices/V` — prefix **`V`** | Tick-by-tick index **value** (the index level itself) | `V.I:SPX,V.I:VIX` | ⬜ **NOT SUBSCRIBED** anywhere in our WS clients | ❓→ **"Included in select Indices plans"** — Starter (15-min), **Advanced (real-time)**, Business. **Not Basic.** | **OPPORTUNITY (highest value)** — see below. We currently get SPX/VIX level *only* via `A.` aggregate roll-ups, not the raw `V` tick. |
| Aggregates / second | `WS /indices/A` — prefix **`A`** | Per-second OHLC aggregate of the index value | `A.I:SPX,A.I:VIX` | ✅ `ws/polygon-socket.ts` l.109 (`A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M,A.I:TICK,A.I:TRIN,A.I:ADD`) | **"Included in select Indices plans"** — **Advanced & Business only** (Basic & **Starter lack access**); real-time | Keep — primary desk pulse. (Note: this needs **Advanced+**, which we have.) |
| Aggregates / minute | `WS /indices/AM` — prefix **`AM`** | Per-minute OHLC aggregate | `AM.I:SPX,AM.I:VIX` | ✅ `spx-broadcaster.ts` l.92 (`AM.I:SPX,AM.I:VIX`) | "Included in select Indices plans" — Starter (15-min), **Advanced & Business real-time**; not Basic | Keep. |

**WS payload fields (quoted):**
- **Value `V`:** `ev`(="V"), `val`(numeric index value), `T`(ticker e.g. `I:SPX`), `t`(Unix ms).
- **Agg `A`/`AM`:** `ev`(="A"/"AM"), `sym`(index symbol), `op`(today's open), `o/c/h/l`(bar OHLC), `s`/`e`(bar start/end Unix ms).

---

## 7. Top missed-data opportunities (unused-but-valuable for an SPX / dealer-positioning desk)

1. **`WS /indices/V` (Value channel) — raw `I:SPX`/`I:VIX` tick.** We only consume `A`/`AM` aggregate roll-ups; the `V` channel pushes every value change with the lowest latency. **Unlocks:** true tick-by-tick SPX print for the desk tape and tighter trigger latency on 0DTE plays. We already pay for it (Advanced) and it's the single biggest latency win.
2. **`GET /v1/indicators/rsi/I:SPX` for the SPX play.** `spx-play-technicals.ts` hand-rolls RSI; the docs confirm server-computed RSI on `I:SPX` ("Included in all Indices plans"). **Unlocks:** consistent, full-history-accurate RSI with zero in-process compute and no bar-window edge cases.
3. **`GET /v1/indicators/macd/I:SPX` on the SPX desk.** MACD is wired for Largo equities but not the SPX desk. **Unlocks:** a momentum/trend-flip signal (MACD histogram cross) for the desk's directional bias panel.
4. **`GET /v3/snapshot` (Unified) cross-asset hydrate.** One call returns `I:SPX` value **+** SPX option contracts **+** SPY together. **Unlocks:** a single round-trip "desk warm" that replaces several sequential calls — fewer requests under the 40-rps limiter and atomically-consistent spot vs. chain.
5. **`GET /v3/reference/tickers?market=indices`.** Index universe is hard-coded today. **Unlocks:** auto-discovery of sector sub-indices and breadth internals Massive serves, feeding a market-breadth/rotation panel.
6. **`v1/marketstatus/now.indicesGroups.s_and_p`.** We only read the top-level `market`. **Unlocks:** SPX-specific session gating (e.g., correctly treat an S&P holiday/early-close independent of equities) so the desk doesn't fire on a closed index.
7. **Internals via `A.I:TICK / A.I:TRIN / A.I:ADD`** — we *subscribe* (polygon-socket l.109) but verify they're surfaced. **Unlocks:** live NYSE TICK/TRIN/ADD breadth tape for confluence scoring (these are index-cluster tickers, same plan).
8. **VIX term structure from `/v3/snapshot/indices` (`I:VIX9D`, `I:VIX3M`).** Snapshot supports the full VIX complex in one batch. **Unlocks:** a contango/backwardation term-structure signal (VIX9D/VIX vs VIX/VIX3M) as a regime filter — replacing any UW-sourced vol term dependency at no extra cost (already noted in `docs/system-analysis`).

---

## 8. Rate limits & gotchas (from the docs)

- **Plan tiering is per-endpoint, not blanket.** Indicators, custom/prev/daily bars, ticker reference, and market-status/holidays are **"Included in all Indices plans."** But **snapshots** (`/v3/snapshot/indices`, `/v3/snapshot`) and **all three WS channels** are **"Included in *select* Indices plans"** — explicitly **not Indices Basic**. The **per-second `A` aggregate WS additionally excludes Starter** (Advanced & Business only). We run **Indices Advanced**, which clears every endpoint in this scope.
- **Recency ladder (quoted):** Basic = End-of-day · Starter = 15-minute delayed · **Advanced & Business = Real-time.** The indices-snapshot response carries a `timeframe` field (`DELAYED`/`REAL-TIME`) — use it to assert at runtime that the key is actually on a real-time tier (cheap guard against a silent plan downgrade).
- **History floor:** index data (bars, indicators, flat files) goes back only to **2023-02-14** ("Records date back to February 14, 2023"). Any backtest/seasonality on indices must not assume pre-2023 history.
- **Pagination caps (quoted):** `/v3/snapshot/indices` `limit` max **250** (and `ticker.any_of` up to **250/250 tickers**); RSI `limit` max **5000** (default 10).
- **No per-second numeric rate limit is published on these doc pages.** Massive (Polygon-derived) gates by **plan tier**, not a documented RPS for indices REST. **NOT VERIFIED — needs the Massive plan/pricing page or a live probe** to pin an exact requests/second number; our `polygon-rate-limiter.ts` ~40 rps is a self-imposed safety cap, not a documented Massive figure.
- **Indices bars have no volume.** Custom/prev/daily index bar results expose `c/h/l/o/t` only — **no `v` or `vw`**. Any code path expecting volume on an `I:` ticker (or computing volume-weighted stats) must derive it elsewhere; index VWAP is correctly derived from minute bars (`computeIndexVwapFromBars`), not from a (non-existent) indices VWAP endpoint.
- **Flat-file (S3) bulk indices exist** (`/indices/{day-aggregates,minute-aggregates,values}`, all Indices plans, EOD updated 11a ET, history to 2023-02-14) — **out of REST/WS scope** but available for cheap historical backfill instead of paginating `/v2/aggs`.
- **RT-5 lesson encoded:** the indicator endpoints accept `I:` tickers (sample `I:NDX`); never re-derive that from a code comment. The only place to confirm behavior is the doc page itself, quoted in §0.

---

### Source doc pages read (all fetched 2026-06-24)
`/docs/llms.txt` (index) · `/docs/rest/indices/technical-indicators/{simple-moving-average,exponential-moving-average,relative-strength-index,moving-average-convergence-divergence}.md` · `/docs/rest/indices/snapshots/{indices-snapshot,unified-snapshot}.md` · `/docs/rest/indices/aggregates/{custom-bars,previous-day-bar,daily-ticker-summary}.md` · `/docs/rest/indices/tickers/{all-tickers,ticker-overview}.md` · `/docs/rest/indices/market-operations/{market-status,market-holidays}.md` · `/docs/websocket/indices/{value,aggregates-per-second,aggregates-per-minute}.md`
