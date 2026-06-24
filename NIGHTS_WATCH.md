# Night's Watch — Design & Build Doc

*Per-user options position manager · replaces the Hunt Modes panel on `/nighthawk` · target 500 concurrent users · full cross-tool integration*

Source: foundation audit 2026-06-24 (task `wi69z5h72`). This is the canonical build reference.

---

## 1. What it is

A logged-in user saves their **open option positions** (ticker, call/put, strike, expiry, side, contracts, entry premium). Night's Watch shows **live P&L + Greeks** and a **Hold / Trim / Sell verdict** grounded in BlackOut's other tools (SPX desk, HELIX flow, GEX walls, dark pool, heatmap regime, Night Hawk, Largo/Claude).

Scope: replace **only** the right-hand "Arm an Agent / Hunt Modes" panel on `/nighthawk`. Keep "Tomorrow's Playbook" (left).

---

## 2. Endpoint inventory

### Unusual Whales (UW Advanced) — 186 REST + 14 WS; code uses 120 REST + 7 WS
Night's-Watch-ready (wrappers exist in `unusual-whales.ts`): `option-contract/{id}/flow|intraday|volume-profile`, `stock/{t}/option-contracts`, `greek-exposure/strike`, per-ticker greeks/iv-rank. **Unused WS channels** `option_trades` / `contract_screener` = the low-quota way to stream contract deltas.
**Avoid:** `spot-exposures/*` (503 in prod), the Volatility section (403, plan-blocked).

### Polygon / Massive (Options + Stocks/Indices Advanced) — 78 REST; code uses 49
- ★ **`/v3/snapshot/options/{underlying}/{contract}` — single-contract snapshot (UNUSED).** Returns mark/bid/ask/IV/OI/all 4 Greeks/underlying price in ONE ~149ms call. **The correct valuation primitive.**
- USED today: `/v3/snapshot/options/{underlying}` chain band (8×250 pages — wasteful for one strike).
- Unused & working: `/v3/trades/{occ}`, `/v3/quotes/{occ}`, contract aggregates, unified snapshot, reference contracts.
- Live path (future): options WebSocket `wss://socket.massive.com/options` (AM/A/T/Q).
- OCC format `O:SPXW250616C05850000`. **SPX/SPXW live under underlying `I:SPX`** (bare `SPX` → 0 results).

---

## 3. Rate limits (hard numbers)

| Provider | Limit |
|---|---|
| **UW REST** | **2 req/s CLUSTER-WIDE** (`UW_GLOBAL_MAX_RPS`), shared by every tool; breaker 8×429/60s → 45s pause. **Never call UW per-user.** |
| **Polygon REST** | "Unlimited" on Advanced but **NO proactive limiter** — only reactive 5-consecutive-429 → 60s breaker, **process-wide**. |
| Polygon WS | 10 connections/key; Quotes feed 1,000 contracts/connection. |
| pg pool | max 5 / replica (15s conn timeout). |

---

## 4. Capacity @ 500 users

Shared surfaces (SPX desk, flow, heatmap, pulse) are **O(1)** — one upstream call per TTL serves all users. **Night's Watch is the only per-user surface → O(users × positions × poll).** The committed scaffold values each position with an uncached chain-band fetch *per request* → ~10–20k Polygon calls/min at 500 users → trips Polygon's process-wide breaker → **darkens GEX/Largo/breadth/indices for everyone.** This is the P0 to fix before features.

---

## 5. THE SCALING RULE

> **Night's Watch is a cache *reader*, never a per-user upstream caller. A new user's marginal upstream cost must be ZERO.**

Mechanism (the platform's own proven pattern): shared `withServerCache` + Redis single-flight keyed by underlying/contract, **batch by (underlying, expiry)**, **cron pre-warm** the distinct set of open-position underlyings, GET reads cache only, **writes persist-and-return** (no inline valuation), and a **new Polygon token-bucket limiter** mirroring `uw-rate-limiter.ts`.

---

## 6. Cross-tool integration

Read everything via the shared plane `marketPlatform` / `getPlatformSnapshot()` (`src/lib/platform/`), **once per page-load, joined by ticker**:

| For a held position on ticker X, reuse | How |
|---|---|
| SPX desk (GEX walls, gamma flip, max pain, regime, levels, dark pool) if X=SPX | `loadMergedSpxDesk()` / `getSpxDeskSummary()` |
| GEX walls / dealer regime (any X) | `invokeLargoTool('get_gex'\|'get_positioning', {ticker})` |
| HELIX flow (strike/expiry/dte/iv/oi) | `fetchRecentFlows({ticker})` |
| Dark pool | `invokeLargoTool('get_dark_pool', {ticker})` |
| Heatmap / sector | desk `sector_heat` / `get_sector_flow` |
| Night Hawk dossier | `getLatestNightHawkEdition()` matched on `plays[].ticker` |
| Claude verdict narrative | Largo Claude+tools loop (budget-gated, batched) |

**Inbound gap to close (standing full-access rule):** nothing outside NW reads `user_positions`; no `largo-service.ts`; no `get_my_positions` Largo tool → Largo/Claude/SPX are blind to what the user holds. Phase 5 closes this.

---

## 7. Phased build plan

**STATUS (2026-06-24):** Phase 1 ✅ (10cfcfa) · Phase 2 ✅ (7a66da8: Polygon limiter active +
pre-warm cron — cron needs Railway wiring) · Phase 4 options-WS engine **BUILT but DORMANT**
(gated `OPTIONS_WS_ENABLED` off; fail-open snapshot fallback) · Phase 3 (verdict) + Phase 4 UI
+ Phase 5 (inbound cross-tool) = TODO. **Activate live WS marks:** set `OPTIONS_WS_ENABLED=1`
(+ `POLYGON_API_KEY`) and wire `railway.nights-watch-warm.toml`. Tunables: `POLYGON_MAX_RPS`
(~40), `OPTIONS_WS_MAX_CONNS`/`_PER_CONN`, `OPTIONS_WS_MARK_FRESH_MS`.


**Phase 1 — Scalable valuation foundation (the P0 fix) ← IN PROGRESS**
- Cache the per-`(underlying, expiry)` chain snapshot via `withServerCache` + Redis single-flight (TTL ~20–30s RTH); 500 users collapse to one upstream call per group per TTL.
- Batch a user's positions by `(underlying, expiry)`; fetch each group once; slice every strike in-memory.
- Take the underlying spot from the same snapshot (drop the separate `no-store` stock fetch).
- Writes (POST/PATCH) persist-and-return immediately (`valuation_status:'pending'`); no inline valuation.
- (Optimization next: switch the primitive to the single-contract endpoint with a robust OCC builder.)

**Phase 2 — Cron pre-warm + Polygon rate-limiter**
- Market-hours cron warms `SELECT DISTINCT ticker FROM user_positions WHERE status='open'` snapshots into Redis (model `uw-cache-refresh`); GET becomes pure cache hits.
- New Polygon token bucket (`POLYGON_MAX_RPS` / global Redis ceiling / 429 breaker) mirroring `uw-rate-limiter.ts`; route all polygon REST through it; give NW its own concurrency lane.
- Raise `PG_POOL_MAX`; per-user rate limit + positions cap.

**Phase 3 — Cross-tool aggregation + deterministic verdict engine**
- `position-context.ts`: gather cross-tool signals by ticker from existing caches (once per page-load).
- `verdict.ts`: free, in-process Hold/Trim/Sell rules (DTE, side, pnl%, distance-to-strike, breakeven + Greeks/IV + GEX-wall-vs-strike + flow direction + desk regime/levels + catalysts/earnings + Night Hawk + Largo). No per-user AI cost.

**Phase 4 — UI panel + live updates + optional Claude narrative**
- Swap the Hunt panel → Night's Watch positions panel (form + cards with live P&L/Greeks/verdict).
- Live updates via SSE off the warm cron snapshot (not per-user REST polls).
- Optional batched, budget-gated Claude portfolio narrative.

**Phase 5 — Alerts + close the inbound cross-tool loop**
- Position alerts via `personal-alert-fanout` off the warm snapshots.
- Expose held positions back: `marketPlatform.nightsWatch.getEnrichedPositions` + Largo tool `get_my_positions` + new `src/lib/platform/largo-service.ts`.

---

## 8. Top risks (from the audit)

1. **P0** — per-position valuation uncached/un-batched/un-throttled (the scaffold). *Phase 1 fixes.*
2. **P0** — Polygon has no proactive rate limiter (process-wide breaker only). *Phase 2.*
3. **P0** — UW 2 RPS cluster-wide; NW must never call UW per-user.
4. **P1** — pg pool max 5 vs inline-valuation GETs holding connections. *Phase 1/2.*
5. **P1** — wrong endpoint (chain band vs single-contract). *Phase 1 optimization.*
6. **P1** — inbound full-access violated (no tool reads `user_positions`). *Phase 5.*

Scaffold committed `afd4a3b` (CRUD correct; valuation to be rebuilt per Phase 1).
