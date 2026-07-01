# BlackOut Trades — Audit Findings (living doc)

Verified issues from the production data-correctness audit. Newest/most-severe first.
Cross-provider ground truth: Polygon + Unusual Whales REST. Started 2026-07-01.

---

## 🔴 HIGH — SPX support/resistance R1/R2/S1/S2 computed from a STALE (off-by-one) session
**Status:** CONFIRMED against Polygon ground truth → **FIXED in PR #189** (`fix/spx-prior-session-staleness`; date-based prior-session selection + 6 regression tests, 9/9 pass). (User-reported: "R1/R2/S1/S2 are absolutely wrong… made up.")

**Where:** pivots are computed in `src/components/desk/SpxOdteMatrixPanel.tsx` (`floorPivots` — classic `pivot=(H+L+C)/3; R1=2P−L; R2=P+(H−L); S1=2P−H; S2=P−(H−L)`; the math is **correct**). The bug is the **inputs**: prior-session `pdh/pdl/prior_close` come from `src/lib/providers/spx-session.ts` → `priorDayFromDailyBars()`:

```
// spx-session.ts:60-69
if (bars.length < 2) return { pdh: null, pdl: null, pdc: null };
const prior = bars[bars.length - 2] ?? bars[bars.length - 1];   // ← always skips the last bar
return { pdh: prior.h, pdl: prior.l, pdc: prior.c };
```

It **unconditionally treats the last daily bar as "today's in-progress bar"** and uses the second-to-last as the prior session. That's only correct **during RTH** (when a partial bar for today exists). **Pre-market / overnight / weekends** there is no in-progress bar, so the last bar IS the most recent session — and the code skips it, returning data **one full session stale**.

**Evidence (captured 2026-07-01 pre-market):** app served `pdh=7444.32, pdl=7348.88, prior_close=7440.43` = **2026-06-29** values. The true prior session (2026-06-30, Polygon) was **H 7508.29 / L 7438.04 / C 7499.36**. Tell-tale: served **PDH 7444.32 is *below* the displayed spot ~7499.36** — impossible for a real prior-day high.

**Impact — levels off by 45–96 points:**
| Level | App shows (stale) | Correct (06-30) | Off by |
|---|---|---|---|
| R2 | 7506.65 | 7552.15 | 45.5 |
| R1 | 7473.54 | 7525.75 | 52.2 |
| S1 | 7378.10 | 7455.50 | 77.4 |
| S2 | 7315.77 | 7411.65 | 95.9 |

Also taints anything else keyed off `desk.pdh/pdl/prior_close`: PDH/PDL breakout signals and play entry/stop zones in `src/lib/spx-lotto-engine.ts` (lines ~92, 106, 223, 233-234, 342-343, 369-370), the "PDH/PDL" overlay levels, and commentary.

**Why it looks intermittent:** correct during RTH (partial bar present), wrong pre-market/overnight — so a user checking after hours sees "made up" levels that quietly self-correct at the open.

**Fix:** pick the last *completed* session, not `length-2` blindly — compare the last bar's ET date to today: if it's today's in-progress bar, use `length-2`; otherwise use `length-1`. Add a unit test covering off-hours (no partial bar) and RTH (partial bar present). Then the market-open validator should assert `pdh/pdl/prior_close` equal the true last completed session from Polygon regardless of clock time.

---

## 🟠 MEDIUM — Systemic unrounded float noise served to clients
16+ payloads serve values like `7499.360000000001`, `ema20=7428.6691886260705` (13 dp), `net_gex=3062180849.185327`, heatmap cell `-465096.837671076`. Values ~correct but malformed for display/consumers. Round once at the shared serialization/format layer (prices 2dp; EMAs/levels a fixed precision). Affected: indices, gex-positioning, gex-heatmap, spx/desk|merged|signals|play|outcomes, platform/snapshot, flows, nighthawk/edition, grid/bootstrap, admin analytics/spx/signal-analytics, track-record/plays. See `validation-report`.

## 🟠 MEDIUM — VIX source/freshness inconsistency
App `indices.vix.price = 17.18` vs Polygon prior-close `16.45` (4.4%), while SPX/SPY match prior-close exactly — the app's VIX uses a different source/timestamp than SPX/SPY. Confirm with same-timestamp live compare at open.

## 🟡 TO VERIFY — Track record 0 wins / 9 losses (0% public win-rate)
Arithmetic is correct; determine whether it's a genuine 2-day sample or an outcomes/settlement scoring bug (winners mislabeled). Under investigation by the deep-validation workflow.

## 🟡 Provider/config gaps
- **Benzinga:** used by `src/components/desk/BenzingaNewsTicker.tsx` / `BenzingaNewsRail.tsx` but **no `BENZINGA_API_KEY` in env** — news won't fetch live in this environment.
- **Unresolved `${{shared.*}}` env** (this environment): `UW_API_KEY` (fixed manually), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE` — set literals for scheduled runs.
- `/api/signals/open` → 401 even with an admin session; `/api/nighthawk/play-status` → 404; `/api/market/largo/session` → 400. Under investigation.

## 🟡 UX — a few panels don't auto-refresh (static until remount/manual refresh)
Most data updates dynamically without a manual refresh: **28 SWR hooks** with `refreshInterval` (15s–5min, plus SWR revalidate-on-focus) and **4 SSE streams** (`/api/market/flows/stream`, `/api/market/spx/pulse/stream`, `/api/account/positions/stream`, `/api/admin/apis/stream`) push the live tape / pulse / heatmap / SPX matrix / positions. The browser uses **SSE + SWR polling, not WebSockets directly** (UW/Polygon WS are server-side only).

Exceptions that fetch once via `useEffect`/`fetch` and stay static until an action or navigation (candidates to add polling/SSE where live freshness matters):
- `src/components/nights-watch/NightsWatchPanel.tsx` — positions/alerts fetched once (no timer/stream). **Night's Watch data does not auto-update.**
- `src/components/spx/SignalAnalyticsPanel.tsx`, `src/components/track-record/PlayHistoryTable.tsx` — one-shot loads.
- (Modals/editors/nav one-shots — `PlayDetailModal`, `JournalEditor`, `Nav`, settings — one-shot is appropriate, no action needed.)

---

## Scope tracker (what the audit must cover — per user)
Every page/subpage/panel/button/layout/font; every number/level/matrix/flow value validated vs ground truth; SPX Slayer levels+logic; heatmaps for **multiple stocks** (not just SPX/SPY); Night Hawk play-logic strength; Night's Watch UI; **all** REST **and** WebSocket endpoints on **UW, Polygon, Benzinga**; site-wide UX improvements.

**Environment limits (need server-side or a fixed sandbox):** WebSocket feeds can't be exercised from the agent proxy (WS upgrades blocked) — WS-sourced numbers are validated via the REST endpoints that surface them; rendered UI / visual layout / fonts / client console errors need a real browser (currently blocked). These are covered at the code+data level here and flagged for a browser/RTH pass.
