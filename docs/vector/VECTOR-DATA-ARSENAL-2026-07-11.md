# Vector — Full Data Arsenal Audit & Breakthrough Roadmap (2026-07-11)

*Deep-dive across every Polygon/Massive + Unusual Whales endpoint (REST + WebSocket) we can
reach, what we use vs. what's sitting idle, verified live where it mattered, plus the
breakthroughs the full arsenal unlocks. Companion to VECTOR-PRODUCT-VISION.*

## TL;DR — the three headlines
1. **No more "wait for RTH."** Polygon serves **per-contract intraday minute bars for past
   sessions** (verified: `O:SPY260710C00751000` → 401 bars on Jul 10) **and** per-contract
   greeks+OI+IV in the live snapshot. The Black-Scholes gamma/vanna/charm math and the
   per-contract bar helper **already exist in the repo** — so we can **reconstruct real
   intraday per-strike GEX for any past day** (dense rails + the strike×time heatmap) without
   ever waiting for a live session. UW cannot do this (its per-strike is daily or live-snapshot
   only); Polygon can.
2. **Vector still polls when it could stream.** GEX is rebuilt from a REST options-snapshot
   every ~1s. Polygon's **options WebSocket aggregate tape** (`A`/`AM` on
   `wss://socket.massive.com/options`) is unused — moving to it makes the walls genuinely
   push-live and cuts provider load.
3. **We're leaving whole overlays on the table** — dark-pool *by price level* (walls, not just
   prints), options-implied S/R levels, a live hot-contracts stream, news markers, and a
   free charm/theta lens (greeks we already pay for and discard).

## Verified live (this session)
- Polygon `/v3/snapshot/options/{ticker}` → `greeks.{delta,gamma,theta,vega}`, `open_interest`,
  `implied_volatility` per contract. ✅
- Polygon `/v2/aggs/ticker/O:{contract}/range/1/minute/{date}/{date}` → 401 Jul-10 minute bars
  for a liquid SPY contract. ✅ (deep-ITM/illiquid contracts return 0 — expected.)
- UW `spot-exposures` → 481 intraday timestamps/session but **aggregate** (no strikes);
  `greek-exposure/strike?date=` → 487 strikes but **daily** (one EOD ladder/day, 250d history).
  Per-strike × intraday together: **not available from UW**.

## What Vector already runs on (good foundation)
- **Per-strike GEX/VEX/DEX/CHARM, gamma flip, max-pain, IV term** — Polygon options-snapshot
  greeks (`polygon-options-gex.ts` `accumulateContract`): GEX = γ·OI·spc·spot²·0.01; DEX =
  −δ·OI·spc·spot; VEX/CHARM = closed-form BSM from IV. UW `gex_strike_expiry` WS ladder is
  *preferred* for the 3 oracle tickers (SPX/SPY/QQQ); Polygon is the universal fallback.
- **Candles** — Polygon indices WS (`A.`/`V.` on `I:SPX`) → the 1-min aggregator; REST aggregates
  seed history.
- **Dark-pool prints** — UW `off_lit_trades` WS + `/api/darkpool/*`.

## Ranked breakthroughs (impact × differentiation × feasibility)

### 1. Historical intraday gamma **replay/backfill** — THE dense-rail + heatmap unlock  *(feasible now)*
Enumerate a past session's contracts (`/v3/reference/options/contracts`) → pull `O:{contract}`
minute bars → invert BSM for IV per minute → feed the **existing** gamma/vanna/charm closed
forms with prior-EOD OI → aggregate per strike per minute → **real dense intraday rail + the
strike×time GEX heatmap, for any past session.** Missing piece is only the batch-fetch loop;
the math (`polygon-options-gex.ts:784,812`) and the bar helper (`polygon-largo.ts:398`) exist.
*Honesty: real observed option prices + standard BSM greeks, labeled "reconstructed".*

### 2. Options **WebSocket** tape → push-live walls  *(medium)*
Subscribe Polygon options `A`/`AM` (and/or UW is already WS for oracle GEX) instead of polling
the REST snapshot every 1s. Truly live walls, lower load. Constraint: 1 WS/key, ≤1000
contracts — scope to the active band around spot.

### 3. **Dark-pool walls** (levels, not prints)  *(feasible now)*
UW `/api/stock/{t}/stock-volume-price-levels` — dark-pool + lit volume aggregated **by price
level**. Horizontal DP "walls" on the chart, the way members expect, vs. our current print tape.

### 4. **Options-implied S/R levels** overlay  *(feasible now)*
UW `/api/stock/{t}/option/stock-price-levels` — pre-computed support/resistance from options
positioning. A distinct, high-signal overlay beyond raw GEX walls.

### 5. **Charm/theta decay clock**  *(nearly free)*
Polygon already returns `greeks.theta`/`greeks.vega` on every chain pull and we **discard
them**. Surface a time-decay lens: how dealer hedging pressure accelerates into the close.

### 6. **News + catalyst markers**  *(feasible)*
UW `news` WS / Polygon `/v2/reference/news` → event markers on the chart timeline so structure
moves are explained by catalysts.

### 7. **Live hot-contracts / unusual-size panel**  *(feasible)*
UW `contract_screener` WS → a live "what's being bought right now" rail that explains which flow
is building/eroding each wall.

### 8. **Full GEX surface in one call**  *(cleanup)*
UW `/api/stock/{t}/greek-exposure/strike-expiry` (unused) — per-strike × per-expiry in a single
request; simplifies the wall grid + feeds the heatmap.

### 9. **Vol-regime context** — VIX term structure, variance-risk-premium *(secondary)*.

## Corrections found (bugs / misuse — fix these)
- **UW `fetchUwLitFlow` path bug** (`unusual-whales.ts:1564`): requests literal
  `"/api/lit-flow/ticker"` with a `ticker` *query* param; the real endpoint takes ticker as a
  **path** param `/api/lit-flow/{ticker}`. Currently fetches "ticker" literally.
- **UW deprecated route** (`fetchUwSpotExposuresByExpiry`, `:2071`): calls the deprecated
  `/spot-exposures/{expiry}/strike`; the v2 replacement `/spot-exposures/expiry-strike`
  (`expirations[]`) is already used elsewhere — route this one to it too.
- **UW WS channel name** — verify `gex_strike_expiry:{ticker}` (the feed powering the live
  walls) against the documented `gex` socket channel; the joined name isn't in the catalog's WS
  list, and the socket treats no-data as "not yet delivered" (silent).
- **Polygon `fetchChainBand` truncation** (`polygon-options-gex.ts:2735`): bare `guard < 8`
  page cap only *warns* on truncation instead of completing — wide/deep chains (SPX full term)
  can under-count walls/OI/IV. Use the completion-condition pattern already in
  `fetchPolygonOiByExpiry`.
- **Polygon theta/vega discarded then recomputed** — minor; could use the provider greeks
  directly for VEX consistency.

## Build order (feeds the autonomous loop)
1. **Polygon intraday gamma backfill** → dense rails + strike×time heatmap (#14/#21) — the
   dense-bead fix, with real data, now.
2. Fix the UW corrections (lit-flow path, deprecated route) + Polygon chain-completion guard.
3. Dark-pool walls (UW price-levels) + options-implied S/R overlay.
4. Options WS tape (push-live walls).
5. Charm/theta lens · news markers · hot-contracts panel.
