# CEO / CTO Audit — BlackOut Trades (2026-07-01)

Executive summary of a **full-stack data-correctness and product-trust audit** across every member-facing desk, API route, and auto-refresh path. This document is the board-level view; engineering detail lives in `docs/audit/FINDINGS.md`, `docs/DESK_E2E_AUDIT.md`, and `scripts/audit/data-validator.mjs`.

---

## Audit scope (what we checked)

| Layer | Coverage |
|-------|----------|
| **Products** | SPX Slayer, HELIX, Thermal, Grid, Night Hawk, Night's Watch, Largo |
| **API surface** | 49+ routes under `/api/market/*`, `/api/grid/*`, `/api/account/*` |
| **Live production** | Public regime endpoint probed; premium routes auth-gated (401 without session) |
| **Auto-refresh** | SSE streams (4), SWR poll intervals (28+ hooks), cron writers |
| **Ground truth** | Polygon + UW REST cross-validation script (`data-validator.mjs`) |
| **Multi-ticker** | Thermal ticker switch, Grid ticker filter, HELIX per-ticker drawer, GEX positioning per symbol |
| **Learn docs** | Panel reference chapters vs code cadences (#190 on main) |

---

## Trust scorecard (member-visible data)

| Area | Grade | Rationale |
|------|-------|-----------|
| **SPX spot / index pulse** | A- | SSE + 1s REST; `feed_stalled` now gates desk `live` |
| **SPX GEX walls / flip** | B+ | Shared matrix cache; header vs matrix flip can diverge; stale badge added |
| **SPX floor pivots R1/S1** | A (post #189) | Prior-session date logic fixed for off-hours |
| **HELIX flow tape** | A- | SSE + 30s fallback; GEX badges on SSE (post audit fix); age ticks |
| **Thermal heatmap** | B+ | Matrix 20s vs header SSE spot — intentional split, needs clear UX |
| **Grid panels** | B | Honest per-panel polls; banner/live dots were overstating freshness (fixed) |
| **Night Hawk edition** | B+ | Stale/degraded flags honest; IV rank display normalized |
| **Night's Watch P&L** | A- (post fix) | Prior-close no longer tagged `live`; removed SPX 5500 delta-$ fallback |
| **Largo answers** | B | Tool traces honest; FreshnessChip not market-data freshness |
| **Public `/api/market/regime`** | C+ | Unauthenticated; serves unrounded floats (`netGex` noise) |

---

## P0 issues — fixed in this branch

| Issue | Member impact | Fix |
|-------|---------------|-----|
| **Night's Watch delta $ used SPX 5500 when spot missing** | Wrong portfolio exposure for multi-ticker books | Omit delta-$ when `underlyingPrice` unknown (API + UI) |
| **GEX positioning fallback looked fully live** | Grid showed regime without walls/vex | `degraded: true`, partial footer, live dot off on fallback |
| **Desk `live` ignored stalled feed** | Green LIVE during frozen index | `feed_stalled` gates `useMergedDesk.live` |
| **Flow ages showed NaN** | Broken tape for timestampless prints | `timeAgo()` guards empty/invalid ISO |
| **Flow brief used premium-ordered history** | Stale whales in AI brief | `order: "recent"` on PG fetch |
| **Earnings calendar demo key in prod** | Silent wrong earnings dates | 503 when `ALPHAVANTAGE_API_KEY` missing in production |

---

## P0 / P1 — open (needs roadmap)

| Priority | Issue | Owner action |
|----------|-------|--------------|
| **P0** | Unrounded floats site-wide (`7499.360000000001`, 13dp EMAs) | Serialization layer round at API boundary |
| **P1** | VIX price vs Polygon prior-close mismatch (~4%) | Align VIX source/timestamp with indices |
| **P1** | `/api/market/regime` public without auth | Product decision: gate or strip playbook |
| **P1** | FlowAnomalyBanner empty without `market-regime-detector` cron | Ops: enable cron + verify DB writes |
| **P1** | Grid ticker-filter modes hit upstream live (UW 2 RPS budget) | Cache ticker-scoped reads via grid-warm |
| **P1** | Track record 0% win rate (9 losses) | Validate outcome scoring vs settlement |
| **P2** | Thermal matrix spot vs header spot split | UI badge for matrix `asof` age |
| **P2** | Duplicate pulse SSE on SPX dashboard | Share pulse context with matrix panel |
| **P2** | Account positions gated on `nighthawk` tool flag | Decouple Night's Watch from Night Hawk launch |
| **P2** | Position SSE stream uncapped (unlike flows/pulse) | Add connection cap |

---

## Auto-refresh verification (no manual refresh required)

| Surface | Mechanism | Verified in code |
|---------|-----------|------------------|
| SPX pulse | SSE `/spx/pulse/stream` + REST 1–10s | ✓ |
| SPX play engine | SWR 3s | ✓ |
| HELIX tape | SSE `/flows/stream` + REST 30s | ✓ |
| Thermal matrix | SWR 20s RTH / 60s off-hours | ✓ |
| Grid panels | SWR 20s–3600s per panel | ✓ |
| Night Hawk edition | SWR 120s | ✓ |
| Night's Watch | SSE ~3s + poll 5s RTH | ✓ |
| Largo | Stream per query | ✓ (on demand) |

**Exceptions (by design):** TickerDrawer, PlayDetailModal Hawk Intel, Largo session hydrate — fetch-on-open only.

---

## Multi-ticker validation checklist

| Ticker | Thermal | Grid filter | GEX positioning | HELIX |
|--------|---------|-------------|-----------------|-------|
| SPX | ✓ index SSE | ✓ | ✓ default | ✓ proximity badges |
| SPY | ✓ | ✓ | ✓ | ✓ |
| QQQ | ✓ | ✓ | ✓ | ✓ |
| Single-name | ✓ overlays allowlist | ✓ 30s polls | ✓ | ✓ drawer drill-down |

---

## Production spot-check (2026-07-01)

```
GET https://blackouttrades.com/api/market/regime → 200
  netGex: "23476032635.866753"  ← unrounded (FINDINGS: medium)
  capturedAt: 2026-07-01T14:11:10.867Z

GET /api/market/spx/desk → 401 (auth required ✓)
GET /api/market/gex-positioning?ticker=SPX → 401 (auth required ✓)
```

Full cross-provider validation requires `scripts/audit/data-validator.mjs` with production Clerk + Polygon + UW keys (see script header).

---

## Recommended executive actions

1. **Merge** data-honesty fixes (this branch) — removes fabricated numbers and misleading live states.
2. **Run** `data-validator.mjs` on a schedule at RTH open (see `docs/audit/MARKET-OPEN-VALIDATION.md`).
3. **Prioritize** API-level number rounding (one sprint, high member trust ROI).
4. **Ops:** Confirm all Railway crons in `docs/ops/RAILWAY-CRON-SCHEDULES.md` including `market-regime-detector`, `grid-warm`, `spx-evaluate`.
5. **Browser RTH pass:** Visual + console audit when markets open (agent environment cannot WS-upgrade).

---

## Related artifacts

- `docs/audit/FINDINGS.md` — living issue log with evidence
- `docs/DESK_E2E_AUDIT.md` — panel-by-panel desk audit
- `docs/audit/BASELINE-2026-07-01.md` — baseline metrics
- `scripts/audit/data-validator.mjs` — automated Polygon/UW cross-check
- `src/lib/correctness/*` — desk/heatmap verifiers
