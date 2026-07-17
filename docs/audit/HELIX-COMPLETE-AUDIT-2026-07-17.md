# HELIX Complete Audit — 2026-07-17

**Repo:** `blackout-web-sandbox` (ECS staging deploys from `main`)  
**Scope:** `/flows` desk — live tape, analytics rail, contract drilldown, ingest path, field correctness  
**Branch:** `cursor/helix-deep-audit-261c`

---

## Executive summary

HELIX does **not** cap the server at 200 or 250 flows. Those numbers mean different things:

| Number | Meaning |
|--------|---------|
| **$200K** | Server ingest floor (`UW_FLOW_MIN_PREMIUM` / `FLOOR_PREMIUM`) — prints below this are never persisted |
| **200** | UW REST page size per upstream request (not the tape limit) |
| **250** | **Client DOM render cap** (`HelixFlowTable` `RENDER_LIMIT`) — performance guard; “Load more” only reveals rows already in memory |
| **500** | Default `GET /api/market/flows` `limit` when the client omits it |
| **1000** | API hard max `limit`; **fixed in this PR** — client now requests 1000 |

The tape was silently dropping live SSE prints when `alerted_at` was empty, mis-bucketing Route Breakdown analytics, showing blank Fill for WS `option_trades` rows, and rendering analytics against the **unfiltered** alert buffer while the tape respected filters.

This PR documents the full system and ships P0/P1 fixes plus targeted UI corrections.

---

## 1. Data path (end-to-end)

```
UW WebSocket (flow_alerts + option_trades)
        │
        ▼
parseUwFlowAlert() ──► persistAndPublishFlowAlert()
        │                      │
        │                      ├── Postgres flow_alerts (raw_payload JSON)
        │                      └── Redis/SSE publishFlowEvent()
        │
        ▼
GET /api/market/flows (30s poll, order=recent, limit up to 1000)
GET /api/market/flows/stream (SSE, GEX-enriched per event)
        │
        ▼
FlowFeed.tsx ──► applyTapeFilters ──► HelixFlowTable (RENDER_LIMIT visible rows)
        │
        ├── Analytics rail (Net Prem, Expiry, Stacks, Route, Momentum, …)
        ├── TickerDrawer (ticker click / stack)
        └── ContractDrilldownDrawer (row click)
```

**Key files**

- Ingest: `src/lib/ws/uw-socket.ts`, `src/lib/flow-persist.ts`, `src/lib/providers/unusual-whales.ts`
- API: `src/app/api/market/flows/route.ts`, `src/app/api/market/flows/stream/route.ts`
- Client: `src/features/helix/components/FlowFeed.tsx`, `HelixFlowTable.tsx`
- DB read: `src/lib/db.ts` → `fetchRecentFlows()`

---

## 2. Why not “all flows ever”?

### 2.1 Ingest floor ($200K)

`persistAndPublishFlowAlert` drops `flow.premium < MIN_PREMIUM` (default **$200,000**). The UI floor in `FlowFeed` (`FLOOR_PREMIUM = 200_000`) is intentionally aligned. Lowering the UI slider below $200K without changing server env **cannot** show more prints — they were never stored.

### 2.2 API window + limit

Postgres query uses `since_hours` (default **168h / 7 days** on `/flows`) and `LIMIT` (default **500**, max **1000**). This is a **recency-ordered** window, not full history. Heavy tape days can have thousands of qualifying prints; only the newest N survive the cap.

**Recommendation (P2):** cursor/`before=` pagination API + optional “deep history” mode for power users.

### 2.3 Client render cap (250)

`HelixFlowTable.tsx` sets `RENDER_LIMIT = 250` to avoid main-thread jank (each row is a CSS grid + signal pills). “Load more” adds +250 from **already-fetched** client data — no extra API call.

Legacy `FlowAlertStream.tsx` still uses **150** — unused on the current `/flows` desk but worth consolidating if that component is revived.

**Recommendation (P2):** virtualized table (e.g. `@tanstack/react-virtual`) to show 1000+ rows without DOM blow-up.

### 2.4 This PR

- Client poll now requests **`limit: 1000`** so the in-memory buffer matches the API max.

---

## 3. Column / field matrix

| Column | Source | Correct? | Notes |
|--------|--------|----------|-------|
| **Time** | `alerted_at` → `fmtFullTimestamp` (ET) | ✅ | Empty `alerted_at` sorts last; excluded from LIVE age |
| **Symbol** | `ticker` | ✅ | |
| **Side** | `option_type` CALL/PUT/UNKNOWN | ✅ | UNKNOWN excluded from CALL/PUT filters (gap #6) |
| **Expiry** | `expiry` YYYY-MM-DD | ✅ | ET-oriented labels |
| **Strike** | `strike` + side suffix | ✅ | OCC fallback in parser for WS payloads |
| **Premium** | `total_premium` / `premium` | ✅ | Faithful to UW |
| **Fill** | `raw_payload.price` | ⚠️ **Fixed** | WS `option_trades` path omitted `price` → blank until REST poll |
| **DTE** | SQL ET calendar / `daysToExpiry` | ✅ | Server authoritative on REST |
| **Spot** | `underlying_last` / `underlying_price` / `stock_price` | ✅ | String-tolerant JSON cast in SQL |
| **Ask%** | `ask_side_pct` | ✅ | Often null on `option_trades`-only rows |
| **OI** | `open_interest` / `oi` | ✅ | |
| **IV** | `iv` / `implied_volatility` | ✅ | Display normalizes decimal vs percent |
| **OTM** | derived from spot + strike + side | ✅ | Skipped for UNKNOWN side |
| **Rule** | `alert_rule` / `rule_name` | ✅ | Falls back to internal `route` label only if rule missing |
| **Score** | UW `score` or derived (prem + sweep + 0DTE) | ✅ | Derived when UW omits score |
| **Signals** | `flowSignals()` | ⚠️ **Improved** | Added `near_call_wall` / `near_put_wall` chips |

Internal **`route`** (`whale` / `0dte` / `stock`) is a **Blackout size/horizon bucket**, not UW execution route (SWEEP/BLOCK). Must not be used for Route Breakdown — **fixed**.

---

## 4. Findings (prioritized)

### P0 — Fixed in this PR

| ID | Issue | Fix |
|----|-------|-----|
| **H1** | `createFlowEventSource` rejected SSE rows with empty `alerted_at` while server publishes them | Relax validation; backfill from `event_at` when present |
| **H2** | `optionTradePrintToFlowRaw` dropped `price` → blank Fill for WS ingests | Forward `price` + `size` |
| **H2b** | SSE payload lacked chain fields vs REST | `extractChainFieldsFromRaw` in persist + client `mergeFlowAlerts` |

### P1 — Fixed in this PR

| ID | Issue | Fix |
|----|-------|-----|
| **H3** | Route Breakdown used internal `route` → almost all **OTHER** | `executionRouteKey(alert_rule)` |
| **H4** | Expiry Concentration used local midnight, not ET DTE | `daysToExpiry()` |
| **H5** | Analytics rail used raw `alerts`, ignoring tape filters | Pass `displayAlerts` to panels |
| **H6** | Time column hint still said “seconds since print” | Updated to ET absolute stamp hint |
| **H7** | Client never passed `limit` → defaulted to 500 | `fetchFlows({ limit: 1000 })` |
| **H8** | Drilldown missing directional lean | Render `printBias()` as “Lean” stat |

### P2 — Documented / follow-up

| ID | Issue | Recommendation |
|----|-------|----------------|
| **H9** | `RENDER_LIMIT=250` hides rows already in memory | Virtualize table or raise cap with perf budget |
| **H10** | No API pagination — “all flows” impossible for heavy weeks | `before` cursor + `since` on `/flows` |
| **H11** | Velocity / Split / Sector derived memos still scan full `alerts` | Align with `displayAlerts` or document as session-wide |
| **H12** | `STACK` signal is ticker-wide, not row-specific | Consider strike-level stack badge |
| **H13** | Score is derived heuristic when UW omits score | Document in UI tooltip; optional UW field if tier allows |
| **H14** | Timestampless rows excluded from LIVE — correct but invisible | Optional “unknown time” bucket in tape |
| **H15** | `FlowAlertStream` (150 cap) diverges from HELIX table | Deprecate or unify limits |

### P3 — Product enhancements

- Export CSV already includes core fields; add `ask_pct`, `spot`, `OI`, `IV`, `OTM` columns
- Drilldown: show `alert_id` for support/debug
- Analytics: “match tape filters” toggle vs “full session window” (explicit UX)
- Dark pool coordination signal independent of flow filters (by design)

---

## 5. Analytics panels audit

| Panel | Input data | Filter sync | Correctness notes |
|-------|------------|-------------|-------------------|
| **HighScorePrints** | alerts | ✅ `displayAlerts` after fix | Top score-sorted prints |
| **NetPremiumLeaderboard** | alerts | ✅ | Aggregates call/put prem by ticker |
| **ExpiryConcentration** | alerts | ✅ + ET DTE fix | Buckets: 0DTE / week / month / LEAPS |
| **StrikeStackDetector** | alerts | ✅ | Uses `computeFlowStrikeStacks` |
| **DarkPoolPanel** | separate API | N/A | Not flow-derived |
| **VelocityRadar** | derived from alerts | ⚠️ P2 | Spike detection on ticker velocity |
| **NightHawkFlowPanel** | nighthawk + alerts | partial | Cross-tool conviction |
| **SplitFlowRadar** | derived | ⚠️ P2 | Call/put split imbalance |
| **RouteBreakdown** | alerts | ✅ + rule fix | SWEEP vs BLOCK prem share |
| **SectorFlowPanel** | derived | ⚠️ P2 | Sector map aggregation |
| **FlowMomentumChart** | alerts | ✅ | Cumulative net prem over time |

---

## 6. Contract drilldown (row click)

**Component:** `ContractDrilldownDrawer.tsx`  
**API:** `GET /api/market/option-contract` → `fetchOptionContractDrilldown`

### Behavior

1. **This print** — fields from the clicked `FlowAlert` row (no re-fetch). Premium, fill, spot, OI, IV, OTM, aggressor, score, rule tags, GEX wall.
2. **Contract activity** — UW aggregate for that leg today: OI, day volume, bid share, intraday vol/avg price chart, fill table.

### Issues found

| Issue | Status |
|-------|--------|
| Fresh SSE row missing fill/spot until REST poll | Mitigated: persist enrichment + merge |
| `printBias()` existed but unused | **Fixed** — “Lean” stat |
| Aggregate section can 503 when UW cold | Expected; empty state shown |

**Ticker drawer** (symbol click / stack): `TickerDrawer.tsx` — 40-print window, separate from contract drilldown.

---

## 7. Live / stale semantics

- **LIVE badge** requires trustworthy `alerted_at` on newest visible row + SSE connection
- **STALE** if newest print > 5 minutes (10s age ticker re-render)
- Empty `alerted_at` rows: sorted last, excluded from freshness — correct, not a bug

---

## 8. Tests added

- `src/lib/flow-raw-fields.test.ts` — chain field extraction
- `src/features/helix/lib/helix-flow-format.test.ts` — `executionRouteKey`, near wall signals
- `src/lib/providers/unusual-whales.test.ts` — `optionTradePrintToFlowRaw` price forward

---

## 9. Files changed (this PR)

| File | Change |
|------|--------|
| `src/lib/api.ts` | SSE validation fix |
| `src/lib/flow-persist.ts` | Chain fields on SSE publish |
| `src/lib/flow-raw-fields.ts` | **new** shared extractor |
| `src/lib/providers/unusual-whales.ts` | WS print `price`/`size` |
| `src/features/helix/lib/helix-flow-merge.ts` | **new** REST↔SSE merge |
| `src/features/helix/lib/helix-flow-format.ts` | `executionRouteKey`, near GEX signals |
| `src/features/helix/lib/helix-table-columns.ts` | Time column hint |
| `src/features/helix/components/FlowFeed.tsx` | limit 1000, merge, analytics sync |
| `src/features/helix/components/RouteBreakdown.tsx` | alert_rule routing |
| `src/features/helix/components/ExpiryConcentration.tsx` | ET DTE |
| `src/features/helix/components/ContractDrilldownDrawer.tsx` | Lean stat |
| `docs/audit/HELIX-COMPLETE-AUDIT-2026-07-17.md` | this document |

---

## 10. Verification checklist

```bash
npx tsc --noEmit
npm run lint:brand
npm test
```

Manual (staging, premium tier + market keys):

1. Open `/flows` — confirm tape populates LIVE during RTH
2. Click a row — “This print” shows fill/spot when present; Lean stat visible
3. Expand analytics — Route Breakdown shows SWEEP/BLOCK buckets (not all OTHER)
4. Apply ticker filter — analytics rail matches filtered tape
5. Scroll tape — “Load more” reveals additional rows up to fetched count (≤1000)

---

*Audit author: Cursor Cloud Agent · 2026-07-17*
