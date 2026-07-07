# Desk E2E Audit — SPX Slayer, HELIX, Thermal, Grid, Night Hawk, Night's Watch, Largo

Audit date: 2026-06-30. Scope: data accuracy, auto-refresh (SSE/poll), multi-ticker behavior, Learn doc parity.

## Auto-refresh matrix (validated in code)

| Desk | Transport | RTH cadence | Off-hours | Notes |
|------|-----------|-------------|-----------|-------|
| **SPX Slayer** | Pulse SSE + REST pulse/desk/flow | 1s/10s pulse, 2s flow, 10s desk | Polls gated off | Play 3s; matrix 8s/20s; commentary ~5m server window |
| **HELIX** | Flow SSE + REST fallback | SSE live; 30s fallback | Same | Tide 15s; brief 15m; anomalies 20s |
| **Thermal** | SWR matrix + quote; pulse SSE for indices | Matrix 20s; quote 15s | 60s | Fast-move force refresh ≤1/8s |
| **Grid** | Per-panel SWR | 20s–3600s by panel | Same intervals | Bootstrap prefetch; focus revalidate |
| **Night Hawk** | SWR only | Edition 120s; confirm 60s; record 300s | Edition snapshot | No SSE |
| **Night's Watch** | SSE + REST | SSE ~3s; poll 5s | Poll 30s | Coach 30s |
| **Largo** | On-demand SSE per query | Per message | Last RTH snapshot in tools | Session in sessionStorage |

## Fixes shipped in this branch

| Severity | Issue | Fix |
|----------|-------|-----|
| P0 | HELIX SSE prints lacked GEX proximity badges (REST only) | Shared `flow-gex-enrichment` + enrich on SSE stream |
| P1 | PRE-MARKET showed MARKET CLOSED / header dashes | `useMergedDesk.live` includes PRE-MARKET |
| P1 | Uncommitted BUY fired audio + looked like open play | Label "Signal only — awaiting engine commit"; audio only when `signal_committed` |
| P1 | Prior-close marks tagged `live` in Night's Watch | New `valuation_status: stale` + UI "prior close" badge |
| P1 | Commentary sessionStorage kept only last card | Persist full feed (up to 24) |
| P2 | GEX stale not visible on SPX header | Amber "GEX stale" chip when `desk.gex_stale` |
| P2 | HELIX CALL/PUT counts ignored ticker filter | Counts scoped to ticker/watchlist filter |
| P2 | Flow row ages frozen without new prints | 10s age tick in FlowAlertStream |
| P2 | Night Hawk edition fetch error looked like "awaiting close" | Explicit error banner |

## Open items (not fixed — require ops or larger refactors)

| Severity | Desk | Issue |
|----------|------|-------|
| P1 | HELIX | FlowAnomalyBanner empty unless `market-regime-detector` cron runs |
| P1 | SPX | Header γ flip vs left-matrix flip can diverge (different computations) |
| P2 | HELIX | Analytics column ignores ticker filter (by design for market-wide rollups) |
| P2 | Grid | Live dots overstate freshness (news hardcoded live; banner "Updated live") |
| P2 | Grid | Ticker flow mode: live dot = fetched once, not stream age |
| P2 | Thermal | MatrixFreshness amber only updates on poll, not wall clock |
| P2 | Largo | FreshnessChip always "live" after hydrate |
| P3 | SPX | Duplicate pulse SSE (merged desk + ODTE matrix panel) |
| P3 | Night Hawk | PlaybookBoard remounts on play count change |

## Multi-ticker checklist

- **Thermal**: TickerSwitcher — matrix/quote/overlays refetch on ticker change; DEX/CHARM hidden when absent.
- **HELIX**: Ticker filter client-side on tape; SSE now enriches per-ticker GEX; drawer fetch-on-open.
- **Grid**: `?ticker=` on most panels; Movers/Economy/Sectors stay market-wide (documented).
- **Night's Watch**: Per-leg chain cache; SPX coach gating; portfolio delta $ used 5500 fallback when spot missing (still open).

## Learn doc accuracy

Deep instrument guides (#190 on `main`) match code cadences for SPX, HELIX, Thermal, Grid, Night Hawk, Night's Watch, Largo. Minor doc gaps: Grid market news rail is **45s** (BenzingaNewsRail), not stated in guide.

## Manual verification recommended

1. RTH: open each desk without refresh — confirm timestamps/polls advance.
2. HELIX: new SSE print near SPX wall shows FLIP/WALL badge without reload.
3. PRE-MARKET: SPX header shows price; trade panel shows Scanning not MARKET CLOSED.
4. Night's Watch off-hours: positions show **prior close** not green **live**.
5. Thermal: switch SPY → SPX → QQQ — matrix skeleton then new data within one poll.
