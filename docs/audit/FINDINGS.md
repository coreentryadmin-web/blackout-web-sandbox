# BlackOut Trades — Audit Findings (living doc)

Verified issues from the production data-correctness audit. Newest/most-severe first.
Cross-provider ground truth: Polygon + Unusual Whales REST. Started 2026-07-01.

**Merge policy for this doc's PRs:** left OPEN for end-of-day review — do not merge without explicit go-ahead, even when CI is green.

---

## ✅ VERIFIED CORRECT — SPX Slayer live GEX/DEX/VEX + anchor (2026-07-01 RTH, ~14:00 UTC)
Live-vs-live cross-check of `/api/market/gex-positioning?ticker=SPX` against UW's raw SPX per-strike option greeks (793 strikes), independently re-derived in this session:

| Value | App (live) | Ground truth (UW/Polygon, live) | Verdict |
|---|---|---|---|
| Spot | 7485.08 | Polygon I:SPX 7487.27 | ✅ Δ 0.03% |
| Anchor / King strike | 7500 | UW argmax\|net_gex\| = 7500 | ✅ exact |
| Call wall | 7500 | UW near-spot argmax = 7500 | ✅ exact |
| Net GEX | +22.1B (long γ) | UW dealer-GEX sign: + | ✅ sign correct |
| Net VEX | +514B (positive vanna) | UW raw vanna is customer-side (−728M); app correctly flips to dealer convention | ✅ correct (dealer convention, applied consistently) |
| Net DEX | −27B (short) | UW raw delta is customer-side (+237M); app correctly flips to dealer convention | ✅ correct (dealer convention) |

`gexPositioningFromHeatmap()` never fabricates (returns null on a cold/empty matrix). **Conclusion: the core SPX GEX/DEX/VEX math and the anchor/wall selection are real, correctly-signed dealer-greek derivations — not made up.**

**However**, the app's own `gex_cross_validation` self-check returned a **false mismatch** in the same live payload (`callWallMatch:false, flipMatch:false, divergence:51.1pt`) despite the call wall being independently confirmed correct above — see the sign-blind self-check finding below (P1).

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
16+ payloads serve values like `7499.360000000001`, `ema20=7428.6691886260705` (13 dp), `net_gex=3062180849.185327`, heatmap cell `-465096.837671076`. Values ~correct but malformed for display/consumers. Round once at the shared serialization/format layer (prices 2dp; EMAs/levels a fixed precision). Affected: indices, gex-positioning, gex-heatmap, spx/desk|merged|signals|play|outcomes, platform/snapshot, flows, nighthawk/edition, grid/bootstrap, admin analytics/spx/signal-analytics, track-record/plays. **Live example (2026-07-01):** public `/api/market/regime` returns `netGex: "23476032635.866753"`. See `docs/audit/CEO-CTO-AUDIT-20260701.md`.

## 🟠 FIXED 2026-07-01 — Night's Watch delta-$ used hardcoded SPX 5500
**Status:** FIXED — `positions/route.ts` + `NightsWatchPanel.tsx` omit delta-dollar aggregation when `underlyingPrice` is unknown; portfolio basis uses `sharesPerContract`.

## 🟠 FIXED 2026-07-01 — Misleading live states
**Status:** FIXED — `feed_stalled` gates desk `live`; GEX positioning fallback returns `degraded: true`; Grid GEX live dot off on fallback; flow `timeAgo` guards invalid timestamps; earnings calendar fails closed in prod without AV key; flow-brief uses recent-ordered tape.

## 🟢 FIXED 2026-07-01 — Audit tooling: `data-validator.mjs` was signing itself out mid-run (false FAILs, not a production bug)
**Status:** FIXED in PR #210 (`fix/validator-client-uat-auth-failure`). The validator's `app()` helper rebuilt the `__client_uat` cookie with `Date.now()` on every request; once a wall-clock second ticked past the minted session JWT's `iat`, Clerk's middleware returned 401 (`x-clerk-auth-reason: session-token-iat-before-client-uat`) — and because a 401 `{"error":"Unauthorized"}` body still parses as valid JSON, the old retry check (`if (j) return j`) accepted it as real data. Every field read off the response then came back `undefined`, which misreported **`wall ordering put_wall < call_wall`**, **`track: wins+losses+breakeven == total_closed`**, and **`track: win_rate_pct correct`** as FAIL on every recorded run this session (confirmed 4/4 in `docs/audit`'s live-out reports) — none of these were real. **Fix:** pin `__client_uat` once before the first mint; stop trusting non-2xx bodies as data (retry with a fresh token on 401/403 instead). **Verified live post-fix:** `put_wall=745 < call_wall=750`, `track: 3+8+0=11 wins/losses/breakeven==total_closed`, `win_rate_pct 27%==27%` — all correct on the live site. No production code changed; this was audit-tooling-only.

## 🟠 MEDIUM — VIX source/freshness inconsistency
App `indices.vix.price = 17.18` vs Polygon prior-close `16.45` (4.4%), while SPX/SPY match prior-close exactly — the app's VIX uses a different source/timestamp than SPX/SPY. Confirm with same-timestamp live compare at open.

## 🔴 CRITICAL — Track record mislabels profitable trades as losses (0% win-rate is a bug)
**Status:** CONFIRMED by both audit workflows. `classifyOutcome` (`src/lib/spx-play-outcomes.ts:170`) forces every `THESIS` exit to "loss" regardless of P&L (and the engine sets `was_loss=true` for thesis breaks — `spx-play-engine.ts:394-397`). Two of the 9 closed plays exited GREEN — #3 `+2.84` and #7 `+7.30` pts — yet are shown as losses, so the public win rate reads **0%** when it should be **~22% (2W/7L)**. Inconsistent with the app's own rules (THETA/SESSION grade by P&L sign; `pnl_pts>=2 → win`). **Fix:** grade THESIS by realized P&L like THETA/SESSION (leave the engine `was_loss` re-entry lock untouched). Existing stored rows need a DB backfill (re-grade) — no DB access from this sandbox. **Fix PR in progress.**

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

## Workflow triage — full multi-agent audit (2026-07-01)
Two multi-agent workflows completed (12-unit data-validation + 25-unit CTO audit; ~123 findings). Full reports: `docs/audit/DEEP-VALIDATION-REPORT-2026-07-01.md` and `docs/audit/CTO-AUDIT-REPORT-2026-07-01.md`. **Bottom line: the math is sound and no data is fabricated** — every cross-checkable price / EMA / GEX wall-flip-greek / flow premium / grid % re-derives from Polygon/UW ground truth within tolerance. The problems are grading/labeling and ops blind spots. No confirmed critical security hole (authZ fails closed).

**P0 (fix now):**
- Track-record THESIS grading (CRITICAL) — see above; fix PR in progress.

**P1 (HIGH):**
- `gex_cross_validation` (member-visible) is sign-blind: tests call/put wall + flip against one top-10 |gamma| pool, so a wrong wall passes; "divergence" mislabeled, warn threshold (>5) dead, deep-OTM REST fallback false-alarms off-hours (`gex-cross-validation.ts:113-144`).
- VIX `change_pct` wrong-signed (served −2.66% vs actual +4.44%; price/change from desyncing snapshot fields); VIX term structure mislabeled "backwardation" on a contango curve (`vix-term-utils.ts:44-62`).
- Composite market regime permanently "NEUTRAL" — consumer matches values the producer never emits (`market-regime-detector/route.ts:51-73`). **FIXED in PR #204** (`fix/market-regime-detector-gex-enum-mismatch`) — `deriveComposite()` compared against `"long"/"short"` but `gammaRegime()` only ever emits `"mean_revert"|"amplification"|"unknown"`; corrected the comparison + 7 regression tests.
- Top Movers headline artifact "DISK +22,245.62%" — no upper bound (`polygon.ts:315`, `GridMoversPanel.tsx:21`). **FIXED in PR #206** (`fix/grid-movers-data-artifact-filter`) — added `isPlausibleMover()` (excludes price≤$1, |change%|>100, volume<100k) applied in `fetchMovers()`; 8 regression tests.
- Corrupt Night Hawk entry ranges (low=17) inflate avg winner 44.3% / profit factor 738.87; missing `Math.min(0,…)` clamp also lets a "stop" loss show +5.25% (`track-record-page.ts:57-99`). **FIXED in PR #207** (`fix/nighthawk-corrupt-entry-range`) — `nhEntryMid()` now rejects a range when either bound ≤0 or width exceeds 20% of the average, returning null instead of a fabricated mid; regression test added.
- Premarket brief served as current even when stale by 2+ sessions (no freshness check on `/api/brief/premarket`). **FIXED in PR #205** (`fix/premarket-brief-staleness`) — added `isPremarketBriefFresh(briefDateYmd, todayYmd)` (fresh only if same day or exactly 1 day prior); route now returns `{available:false, stale:true, staleDate}` when stale.
- Billing "I paid — refresh access" shows green success even on FREE tier (`SyncMembershipButton.tsx:19-27`).
- Whop idempotency key set pre-processing, never cleared on 500 → retry dropped as duplicate (bounded by 6h reconcile) (`webhook/whop/route.ts:156`).
- Discord ops alerting is a silent no-op (both webhooks unset in prod) → cron-death / AI-spend / billing alerts never fire (`spx-play-notify.ts:59-70`).
- `nighthawk-morning-confirm` single-UTC cron self-skips every winter (EST); needs dual-band `15 13,14` (`railway.nighthawk-morning-confirm.toml`).
- FAQ advertises a "lifetime" plan the pricing UI/checkout don't offer (`FaqSection.tsx:95`).
- `/embed/*` ships `X-Frame-Options: SAMEORIGIN` (CF edge), breaking the cross-origin embed the config intends (`next.config.mjs:50-56`).
- HELIX flow `underlying_price`/`otm_pct` NULL on REST rows (UW sends string, SQL gates on jsonb 'number').

**P2 (MEDIUM):** systemic float-noise (~19 endpoints, one shared rounding helper fixes it); Largo passes raw unrounded EMA to model context; 56-year `ageMs`; APIs-dashboard 0-vs-61 contradiction; CSP relaxations / CF header drift; state-mutating GET; cache-key fragmentation; GDPR `user.deleted` gap; fail-open revocation; unguarded NaN formatters; embed/SEO/nav polish.

**Still needs a live RTH + real-browser pass:** intraday flow ingest, VWAP/SPX RTH signals, VIX intraday sign, the WS GEX ladder, and all rendered-UI/visual/console checks (browser was blocked).

---

## Scope tracker (what the audit must cover — per user)
Every page/subpage/panel/button/layout/font; every number/level/matrix/flow value validated vs ground truth; SPX Slayer levels+logic; heatmaps for **multiple stocks** (not just SPX/SPY); Night Hawk play-logic strength; Night's Watch UI; **all** REST **and** WebSocket endpoints on **UW, Polygon, Benzinga**; site-wide UX improvements.

**Environment limits (need server-side or a fixed sandbox):** WebSocket feeds can't be exercised from the agent proxy (WS upgrades blocked) — WS-sourced numbers are validated via the REST endpoints that surface them; rendered UI / visual layout / fonts / client console errors need a real browser (currently blocked). These are covered at the code+data level here and flagged for a browser/RTH pass.
