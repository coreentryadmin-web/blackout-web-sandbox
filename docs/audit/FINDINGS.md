# FINDINGS — living issue log

(Rebuilt 2026-07-13: the prior log was clobbered to an empty file by a squash-merge
conflict-resolution mishap. Historical entries live in git history — `git log --all --
docs/audit/FINDINGS.md`. New entries append below; keep severity / root cause / file:line /
evidence / fix / status per the CLAUDE.md policy.)

## 2026-07-13 — Vector bead-rail / DTE-coherence audit (member-driven, RTH live)

### P0 — Bead trails ran full-width from the open; "no new walls all day" (FIXED, live-verified)
- **Root cause:** the recorder stores the full 20-deep-per-side ladder every 15s bucket, and
  `trailsByStrike` drew a bead in EVERY bucket where a strike appeared anywhere in that set.
  Structural round-number strikes never leave a 20-wide set → every trail born at the open; a
  wall that became dominant intraday was invisible as "new". `src/features/vector/lib/vector-wall-history.ts`.
- **Fix:** per-bucket DOMINANCE filter (`DOMINANT_WALLS_PER_BUCKET = 6`, top-N by |gamma| share) —
  honest births/deaths; persistent walls still run full-width. Commit `64f09e6` + regression test.
- **Evidence live:** 10-ticker rail sweep post-deploy: every ticker 2–8 distinct trail origins
  (pre-fix: one shared origin). Rebirth cue + trim-edge birth suppression followed (`21091ef`, `070da8e`).

### P0 — Universe limited to ~21 tickers; ASTS single beads (FIXED, live-verified)
- **Root cause:** the rail inherited the UW-overlay allowlist accidentally — walls are
  Polygon-cache cheap for any ticker; only pre-view recording was missing.
- **Fix:** `backfillRailPrefix` + `reconstructSessionRail` (today's published OI, gamma recomputed
  along the real spot path, ghost-rendered, dominance-filtered; never overwrites observed samples).
  ASTS added to the recorded set. Commit `070da8e`.
- **Evidence live:** PLTR/HOOD/SOFI/RIVN (never recorded) render full first-class Vector pages
  with staggered-birth rails.

### P1 — Wheel zoom snapped back (price-axis autoScale re-forced per tick) (FIXED, live-verified)
- **Root cause:** `refreshTrails`/`refreshOverlays` unconditionally re-applied
  `priceScale().applyOptions({autoScale:true})` every SSE tick, overriding a member's manual zoom
  (#299 had fixed only the time axis). `VectorChart.tsx`.
- **Fix:** `reassertPriceAutoScale` guard (only re-nudge while autoscale still engaged). Commit `35b8485`.
- **Evidence live:** wheel-gesture harness 5/5 — zoomed 103→39 bar-runs, held 39→39 through 12s
  of live ticks.

### P1 — SPX WEEKLY flip narrated 5,996 with spot 7,522 (−20%) while the API said 7,995 (FIXED)
- **Root cause:** banded chain snapshot edge flaps which zero-crossings exist; when the near-spot
  crossing vanished, nearest-spot selection returned the deep-OTM artifact.
  `vector-gex-reconstruct.ts:gammaFlipFromLadder`.
- **Fix:** plausibility band ±12% of spot; none survive → null → blended-flip fallback. Commit
  `75296eb` + regression test. Caught by the DTE grind (UI-vs-API same-instant).

### P1 — "All" horizon meant different things on different surfaces (FIXED)
- **Root cause:** stream-fed surfaces show the warm blended near-term aggregate; a COLD API task
  fell back to an all-expiry CHAIN aggregate (grind: ASTS banner resistance 75 vs dte=all API 90;
  TSLA support 392.5 vs 380). `vector-snapshot.ts:getVectorGexWallsForHorizon`.
- **Fix:** cold path reads the last recorded rail sample from shared Redis first (the numbers the
  stream showed ≤15s ago); chain stays last resort. Commit `75296eb`. Re-grind pending confirmation.

### P1 — AAPL banner "support NaN" (FIXED) + intermittent missing put side (OPEN lead)
- **Fix shipped:** `deriveVectorRegime` finite-guards wall levels (NaN passes `!= null` and
  toLocaleString renders "NaN"). Commit `f34ccc5` + test.
- **Open lead:** per-expiry gate lets a call-only scoped set win (`vector-snapshot.ts` narrowed
  branch), so "support" intermittently disappears for a horizon while the API (one cache refresh
  later) has a put king. Needs producer-side investigation (thin-chain honesty vs sign/threshold bug).

### P2 — dte= query param was case-sensitive; "0DTE" silently re-scoped to "all" (FIXED)
- `normalizeDteHorizon` now case-folds. Commit `a01f313` + tests. (Found because the hardcore
  harness itself hit it; a member integration could too.)

### P2 — Pivot-P line shared EMA 9's exact color #fb923c (FIXED)
- Two indicators indistinguishable on-chart; also collided pixel-level E2E checks. Pivot-P →
  #f97316. Commit `a01f313`.

### Harness false negatives fixed (testing the tests)
- Terminal capture truncated at 300 chars (cut before king citations); rail-advance poll queried
  `dte=all` without session (empty by route contract), then uppercase `0DTE` (re-scoped to "all"),
  then a DOM date-scrape that could yield null; zoom predicate expected bar-runs to INCREASE on
  zoom-in (they decrease). All four blamed the product falsely; all fixed with comments explaining why.

### Verified-healthy (evidence against suspicion)
- Narrowed recorders: SPX 0dte/weekly/monthly = 319 samples each (full session), AAPL/NVDA 73 —
  direct authed probe. Rail advance re-check: AAPL 85→88 samples in 35s.
- Indicators one-by-one (6 line indicators × 6 tickers): paint alone, clear to 0px on disable.
- Rapid-switch race (0DTE→150ms→MONTHLY): final state is MONTHLY's on all 6 tickers.
- DTE grind totals: 358/364 checks green across SPX/SPY/NVDA/TSLA/AAPL/ASTS.

### Still open (tracked)
- `/api/account/personal-alerts` 502 (origin-side; #304 made the failure honest).
- Night Hawk "Invalid Date" ×2; dashboard hydration #418 (can blank the desk on a cold load —
  escalated toward P0); SPX Slayer "Largo LIVE COMMENTARY" panel blank (pre-existing).
- Ladder "21 UI rows vs 20 API" one-off on AAPL (suspect: spot-divider row class; re-check).
- AAPL missing-put-side producer lead (above).

## 2026-07-13 evening — wall-engine overhaul (member-driven)

### P0 — Mid-session wall births were MATHEMATICALLY IMPOSSIBLE (FIXED — verify at 07-14 open)
- **Root cause (the deepest one):** wall strength = OI × gamma, and OI is published once pre-market
  and frozen all day → the dominant strike set was fixed at 9:30 regardless of session flow. No
  render-side filter could ever produce a mid-day birth. The reference product's walls birth
  mid-day because they accumulate TODAY's flow.
- **Fix:** positioning = OI + today's per-strike traded volume (Polygon day.volume, live) in the
  live per-expiry path; 0-OI contracts that traded today are kept (a brand-new same-day wall).
  Back-projected reconstruction stays OI-only (no fabricated morning walls). `a63f162` + tests.
- **Verification:** scheduled 2026-07-14T14:05Z — screenshots must show trails starting at
  mid-session candles.

### P0 — Narrowed rails contained blended data MISLABELED as the horizon (FIXED)
- TSLA "0DTE" on a Monday (no 0DTE chain exists) drew a full-width static rail — the #301
  blended-fallback recorded blended walls into narrowed rails when the chain was empty. Fallback
  deleted: empty chain → honest gap. `bb4ddeb`. Today's contaminated rows age out at session end.

### Product decisions (user-directed)
- DTE toggle = 0DTE/WEEKLY/MONTHLY only ("All" option removed; back-end "all" APIs intact);
  default weekly. `bb4ddeb` (corrects the over-removal in `b6697e4`).
- King anchor price-lines removed (redundant with king beads). `b6697e4`, visually verified gone.
- DOMINANT_WALLS_PER_BUCKET 6 → 3 (Skylit NODES=3): sparse rails, visible rotation. `bb4ddeb`.

### Process failure logged honestly
- THREE validation runs invalidated by launching inside rolling-deploy windows (mixed replicas
  serve old+new builds for several minutes; per-navigation results flip). Rule going forward:
  after a trunk push, wait ≥6 min AND confirm a marker (e.g. the toggle testids) before treating
  any UI run as evidence.

## 2026-07-13 night — ribbon indicator validation (three-way: displayed == API == Polygon recompute)

### RESOLVED (not a bug) — "VWAP mismatch" from the earlier frozen-tape run was validator error
- **Evidence** (`scratchpad/ribbon-validate.mjs`, 29/30 PASS): displayed VWAP 7,529.98 ==
  `/api/market/spx/desk` 7,529.98 == independent Polygon recompute 7,529.98 (today-only RTH
  bars, typical price × SPY minute volume — the exact staging spec in
  `spx-desk.ts sessionStatsWithProxyVwap`). The equal-weight variant computes 7,533.19, proving
  the desk genuinely serves the volume-weighted number (`vwap_volume_weighted:true`).
- Earlier "mismatch" had two validator bugs: greedy body-regex scraped the wrong element for
  spot, and the recompute spanned all 3 seeded sessions equal-weight instead of today-only
  SPY-weighted.
- Also exact: HOD/LOD/PDH/PDL (vs raw Polygon bars), EMA20/50/200 + SMA50/200 (vs Polygon
  indicator endpoint AND vs from-scratch recompute over raw daily closes), VIX, Max Pain.

### P3 — ribbon γ-flip penny skew (7,519.55 shown vs 7,519.56 API at fetch time)
- Timing skew between the ribbon's SWR snapshot and the validator's API fetch — the flip drifts
  pennies between recomputes. Not a math bug; folds into the one-flip-source / shared-asOf
  decision already queued for the `fix/vector-surface-sync` merge at the 07-14 gate.

### Replay probe corrections (embed "missing button" P1 closed as NOT-A-BUG)
- Probe bug 1: full-screen modal (`fixed inset-0 z-[100]`) intercepted clicks → read as "button
  not found". Probe bug 2: scrub wrote `el.value=` directly and React's value tracker deduped
  it → cursor stuck at frame 1/1722 (`9:30:00 AM` clock in screenshot). Fixed with modal
  dismissal + native value setter. Embed replay then verified end-to-end: 1,721 frames, beads
  0→5,835→13,933 across 5/50/95% cursors, rail visible in late-frame screenshot.
- Multi-TF replay (standalone SPX): 3m/5m/15m PASS; 1H bead-pixel count dropped mid→late
  (5,245→2,982) — P3 watch, eyeballing via the DTE×TF matrix screenshots.

### P1 — Vector terminal/overlay VWAP spans ALL seeded sessions, not today's (FIXED)
- **Found**: 2026-07-13 night, replay-matrix screenshot — Vector terminal read "VWAP 7,542.28"
  while the (independently validated) desk session VWAP was 7,529.98.
- **Root cause**: `vwapSeries` (`src/features/vector/lib/vector-indicators.ts`) accumulated
  Σ(typical×vol) from the FIRST bar with a doc'd assumption "bars are one session" — written
  before the multi-day chart seed shipped. With 3 seeded sessions the terminal + chart VWAP
  overlay + server technicals all served a 3-day cumulative VWAP. VWAP is session-anchored by
  definition.
- **Blast radius**: `VectorChart.tsx:1274` (VWAP overlay line), `vector-technicals.ts:84`
  (terminal summary → "VWAP … — price X% above/below"), `vector-server-technicals-core.ts`
  (play engine technicals) — all through the one shared series; single-point fix.
- **Fix**: `IndicatorBar` gains optional `time` (epoch s); `vwapSeries` resets accumulation at
  ET calendar-day boundaries. Bars without `time` keep legacy behavior. 3 new regression tests
  (cross-day reset, same-day no-reset, no-time legacy) — vector-indicators 11/11,
  vector-technicals + server-technicals 11/11, tsc clean.
- **Why missed earlier**: the ribbon validation checked the DESK VWAP (correct); the terminal's
  VWAP line was never numerically cross-checked against it — surfaces validated in isolation.
  Added to the morning gate: cross-surface indicator equality (desk ribbon vs Vector terminal).

## 2026-07-13 night — Night Hawk 0DTE audit fixes (merged from fix/nighthawk-0dte)

### P1 — index-root 0DTE plays permanently ungradeable (FIXED)
- Polygon serves index aggs only under `I:`; `SPXW/SPX/NDX` return HTTP 200 with 0 results, so
  `gradeZeroDteLedger` stamped rows `graded` with null `direction_hit` forever, and the intraday
  edge read had the same hole. Fix: `polygonSpotTicker()` mapping applied at both call sites
  (`src/lib/zerodte/scan.ts`, `board.ts`) + tests. Historical null rows need the P-6 backfill.

### P2 — pg DATE columns leaked as String(Date) into member payloads (FIXED)
- `nighthawk_echo.edition_for` shipped "Fri Jul 10 2026 00:00:00 GMT+0000 …" (recurrence of the
  #77 Bug 1 class). Fix: `isoDateString` exported from db.ts, applied in
  `mapNighthawkEchoRows` + `fetchEcosystemContext`; regression test added.
- Full analysis: `docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md` (v1) + `NIGHTHAWK-0DTE-DECISION.md` (v2).

## 2026-07-13/14 night — 0DTE hard entry-gate stack (fix/zerodte-hard-gates, decision doc §2 implemented)

### P1 — 0DTE Command had zero market-state discipline: 8/8 commits, 0 rejections, 1W/7L on a down day (FIXED — gate stack)
- **Root cause**: the four evidence gates measure flow conviction only; tape alignment was a −6
  score dent (a 93-score SPY long shrugged it off at 09:55 and stopped), no score floor, no
  session risk ceiling (7 uncapped stops), nothing persisted or shown for a should-have-skipped.
- **Fix** (`src/lib/zerodte/gates.ts` + `governor.ts`, wired in `scan.ts`; per-gate commits):
  - **G-1 tape-alignment BLOCK** — counter-tape commits fail; missing/STALE (>15m) SPY bias fails
    closed (`no_market_bias`), mirroring the evidence gates' `no_underlying_price` discipline.
  - **G-2 opening-window BLOCK, 9:30–9:45 ET only (user-directed 2026-07-13)** — overrides the
    doc's 10:30; applies to BOTH engines ("0DTE" = Slayer + Command): Slayer's BUY unlock moved
    9:50→9:45 (`spx-play-gates.ts`, scoped exception — the OR env knob still defines technicals).
    The 9:45–10:30 band stays open knowingly; `committed_at_et` calibration buckets arbitrate it.
  - **G-3 score floor 65** — the 55–64 band ran 18.8% WR / −24.5% avg (n=16, engine's own
    calibration), under the 33% breakeven of the −50/+100 payoff. Judged post-edge-layer.
  - **G-5 session governor** (zerodte-local mirror of Slayer's shape): max 3 concurrent plans;
    3 stops → halt for the day; 20-min same-direction re-entry lock (Redis-timestamped,
    `zerodte:governor:stops:{date}`; counts derive from the shared Postgres ledger so a halt never
    depends on a warm cache); **B-3 correlated-conflict block** — a commit opposing an OPEN plan in
    the static index/ETF group (SPY QQQ IWM DIA SPX SPXW NDX XSP) is blocked (7/13 ran SPY long +
    QQQ short simultaneously).
  - **G-4 VIX throttle + G-6 cross-system conflict — CALIBRATION MODE** (log, never block):
    verdict pinned per commit in new `zerodte_setup_log.gate_calibration_json` (score, bias,
    `committed_at_et`, VIX tier + would_block, conflict vs live Slayer play / NH echo take ≤5 days).
  - Every block = a `zerodte_scan_rejections` row (new `reason` TEXT column: machine code +
    human sentence) + the setup stays on the board as a WATCH/SKIP card (`setup.gate`), SKIP to
    Largo. Committed plays are never retro-blocked (refresh lane bypasses gates); unreadable gate
    context fails NEW commits closed.
- **Evidence/regression**: `gates-replay-2026-07-13.test.ts` replays the real 8-play ledger →
  1W/1L (QQQ +76.6% prints, META prints flagged CONFLICT) instead of 1W/7L; all six blocked plays
  were real losers. 141 zerodte-suite tests green; Slayer gate tests updated for the 9:45 boundary.
- **Schema/Redis**: `zerodte_scan_rejections.reason` (TEXT), `zerodte_setup_log.
  gate_calibration_json` (JSONB, COALESCE-pinned), Redis `zerodte:governor:stops:{date}` (24h TTL).

## 2026-07-14 — 0DTE open-trade data path (B-9 P0, branch fix/zerodte-live-marks)

Full trace + defect table: `docs/audit/ZERODTE-DATA-PATH-AUDIT.md`. User report: open 0DTE
plays show "entirely wrong" pnl/%/premium values, slow to update.

### P0 — stopped plays displayed a frozen, arbitrary P&L until NEXT-DAY grading (FIXED)
- Root cause: `syncLedgerLiveState` skips CLOSED rows (scan.ts:463) so `last_mark` freezes at
  whichever tick crossed the stop (−38%, −55%, anything); `mapLedgerRow`
  (zerodte-service.ts) recomputed `live_pnl_pct` from that frozen mark, discarding
  `derivePlayStatus`'s correct −50; the plan grader that would stamp −50 only runs on sessions
  `< today` (db.ts fetchUngradedZeroDteRows). intel.ts's `livePnlPct <= -50` branch also
  misread the frozen value → wrong closed-play narrative all afternoon.
- Fix: `closedStopReason()`/`ledgerDisplayPnlPct()` (new `src/lib/zerodte/marks-math.ts`) pin a
  stopped row's displayed P&L to `PLAN_RULES.stop_pct` (matches the eventual grade; TRIM-sticky
  ordering preserved). Applied in mapLedgerRow + the post-roundFloats recompute; additive
  `closed_reason` field on the board row. Tests: live-marks.test.ts, zerodte-service-marks.test.ts.

### P0 — marks with erased provenance/age presented as live (FIXED — structural)
- Root cause: the unified-snapshot mark ladder (mid → last trade → prior session close,
  options-snapshot.ts:153-166) collapses to a bare number; a 30-min-old last (illiquid 0DTE
  contract) or prior close rendered as "Mark $X (+Y%)" under a "live" chip (board `as_of` is
  BUILD time, ZeroDteBoard freshness only checks build age).
- Fix: live-marks lane types carry `{bid, ask, mid, last, mark, source, asOf}`; mid is the mark,
  last-trade fallback is FLAGGED (`source:"last"`), prior-session close is never a live mark;
  board rows gained `mark_as_of`/`mark_source`; client dims money numbers >5s (stale-honesty).

### P1 — open-trade numbers 10–25s old typical, ~2 min worst case, invisible to members (FIXED)
- Root cause: REST snapshot → `zerodte:board:v1` 5s SWR cache (serves the PREVIOUS build) →
  10s client SWR; plus the 2.5s `within` deadline on the snapshot fetch silently falling back
  to the last cron-written mark AND skipping that tick's 15:30 hard-close pass.
- Fix (B-9 build): bounded live-marks lane — open ledger plays only (cap 16), WS-first
  (existing options-socket engine + Redis write-through) with a 1s single-batched REST poller
  as the guarantee lane; ~1s SSE push (`/api/market/zerodte/marks/stream`, REST fallback
  route) of pushed marks + P&L computed ONCE server-side vs the PINNED ledger entry
  (`pinnedLivePnlPct` — zerodte-service's private copy deleted); the poller ALSO syncs ledger
  status/peak/trough from the same store every second (status flips persist immediately), so
  display and grading inputs share one quote lane. Board/chain snapshot cadence unchanged.
- Deferred (documented in the audit doc): explicit "entry basis: flow fill" label (D-4);
  unifying scan.ts's `zeroDtePlaysFeed` onto the store (scan.ts owned by sibling branch
  fix/zerodte-hard-gates this cycle — both writers share the same DB latch, so no divergence
  in persisted state meanwhile).

## 2026-07-14 — Session-anchored indicators anchored to the WRONG session (member-reported, P0)

### P0 — HOD/LOD, Opening Range, session Fib (and off-hours PDH/PDL/pivots) used 3-day-old sessions (FIXED — fix/indicator-session-scoping)
- **Found**: member report (angry, correct): "I selected Opening H and L on SPX Slayer and it
  shows FRIDAY's ranges. All indicators are wrong across all timeframes and DTE."
- **Root cause**: the chart seeds THREE sessions (`vector-seed-bars.ts` `TARGET_SEED_SESSIONS=3`)
  but the session-anchored level math still assumed the bars array IS one session — the exact
  class of the multi-session VWAP bug (#305, entry above), in the level layer this time:
  - `vector-key-levels.ts:sessionHodLod` — min/max over the WHOLE array → 3-day extremes.
  - `vector-key-levels.ts:openingRange` — measured from `bars[0].time`, the FIRST bar of the
    OLDEST seeded session → literally Friday's (actually Thursday's, the oldest day's) opening
    range on Monday. The member's exact symptom.
  - Session Fib (`levelLinesFor("fib")`) inherits `sessionHodLod` → 0%/100% pinned to 3-day extremes.
  - Timeframe/DTE-independent: the same wrong lines redraw at every TF and DTE toggle, matching
    "wrong across all timeframes and DTE".
- **Fix (shared layer)**: new `lastSessionBars(bars)` in `vector-key-levels.ts` — slices to the
  trailing run of bars sharing the final bar's ET calendar day (same ET-day rule/formatter pattern
  as `vwapSeries`' #305 reset). `sessionHodLod` + `openingRange` scope through it INTERNALLY, so
  every consumer is fixed at one point. Bar times are bucket-START epoch seconds and the overnight
  gap dwarfs the 4h interval cap, so ET-day detection survives `aggregateVectorBars` — verified by
  test at 5m/15m.
- **priorDay verification (found wrong off-hours, fixed)**: `/api/market/vector/prior-day` called
  `priorDayFromDailyBars(bars)` anchored to wall-clock TODAY. During RTH that's the session before
  the displayed one (correct). But on weekends/pre-open the chart displays Friday while the walk-back
  ("last bar dated < today") returns FRIDAY ITSELF — PDH/PDL/PDC = the displayed session's OWN
  extremes, and floor pivots computed from the session being viewed. Fix: route accepts
  `anchor=YYYY-MM-DD` (strictly validated) and `VectorChart` passes its `sessionYmd` (the displayed
  session), so "prior day" is always the session strictly BEFORE what's on screen. RTH behavior
  byte-identical (anchor == today).
- **Blast-radius sweep** (every seed/session-bars consumer, fixed or explicitly cleared):
  - FIXED `vector-key-levels.ts` sessionHodLod / openingRange / fib — via `lastSessionBars`.
  - FIXED (transitively) `VectorChart.tsx` levels overlays (`levelLinesFor` at paintOverlays) and
    confluence-zone HOD/LOD (`gatherConfluenceLevels` → sessionHodLod) — both /vector AND the SPX
    Slayer dashboard embed (one shared VectorChart + one shared `loadVectorSeedProps`; embed has NO
    separate derivation — verified, and guarded by vector-seed-props.test.ts's drift test).
  - FIXED `prior-day` route + VectorChart fetch (anchor, above) — PDH/PDL/PDC lines AND floor pivots.
  - FIXED `vector-seed-props.ts` rail-prefix gap check — compared today's first observed rail sample
    against `bars[0]` (now the OLDEST session's open), making "rail starts late" trivially true every
    load and firing the reconstruction fetch needlessly; now uses `lastSessionBars(bars)[0]`.
  - CLEARED (by definition) VWAP — already resets per ET day (#305). EMA/SMA/RSI/MACD — continuous
    studies; prior-session history only improves warm-up (TradingView parity).
  - CLEARED (window-scoped BY DESIGN, now documented in-code) fib-auto golden pocket
    (`dominantSwing` over DISPLAYED bars — deliberate multi-day structure read), market-structure
    BOS/CHOCH markers, `summarizeTechnicals`' goldenPocket/structure (client terminal + server
    `vector-server-technicals-core.ts` → play engine share the same deliberate window semantics).
  - CLEARED wall-history/replay: `liveTrailAnchorSec`/`seedWallHistoryForDisplay`/
    `narrowedHorizonTrail` anchor to the LAST bar (correct with multi-day bars); `buildReplayTimeline`
    spanning all seeded sessions is the multi-day replay feature, not a bug.
  - CLEARED SPX desk (non-Vector path): `spx-play-technicals.ts` fetches `today,today` only (single
    session by construction; its `openingRangeFromBars` filters by 9:30 ET clock); `spx-desk.ts` OR
    comes from today's minute bars; its `priorDayFromDailyBars(dailyBars)` wall-clock anchor is
    correct for a live "right now" desk (always today-anchored, unlike a chart displaying a session).
  - CLEARED `spx-live-voice.ts` openingRange — reads the desk's session-scoped OR, no bar math.
- **Why it was missed**: every render-level E2E asserts indicators PAINT and CLEAR
  (`vector-staging-e2e.mjs`: "enabling one of each kind actually draws"; `vector-hardcore-e2e.mjs`:
  paints-alone + badge-tracks + canvas-hash redraw checks) — none asserted WHICH session the drawn
  level belongs to, and the unit fixtures only ever contained one session of bars. Value-correctness
  checks (ladder/regime/max-pain) covered options surfaces, not the session-level overlays. Action:
  hardcore suite should gain a session-scoping case (OR-H/OR-L within today's price range, HOD ≥
  session max only of today's bars) — DONE: `vector-hardcore-e2e.mjs` section J (PR #320) asserts,
  per ticker at 1m/5m/15m, single-ET-day slice == sessionYmd, OR anchored to the displayed session's
  open inside its H/L, aggregation-invariant extremes, and anchored prior-day ≠ the displayed
  session's own extremes. Deployed-build validation 2026-07-14 ~01:57 UTC: 33/33 PASS (values exact
  to the frozen 7/13 truth; PDH/PDL/PDC == Polygon Friday OHLC; chart axis labels cite the same).
- **Evidence (live staging seed, read-only probe 2026-07-14 pre-open)**: `/api/market/vector/bars`
  really carries 3 ET sessions (SPX: 1184 bars across 07-09/07-10/07-13; NVDA: 2834). Over that
  exact shape, OLD math vs FIXED: SPX opening range was drawn from THURSDAY's open
  {7512.05, 7483.29} → now Monday's {7565.37, 7547.53} (the member's literal symptom); SPX
  HOD/LOD was the 3-day {7579.93, 7481.73} → now Monday's {7565.37, 7506.41}; NVDA OR
  {205.86, 203.40}(Thu) → {207.97, 205.93}(Mon), HOD/LOD {211.10, 198.96} → {210.57, 202.75}.
  Fixed values verified equal to an independent per-ET-day recompute, at 1m and after 5m/15m
  aggregation. Live prior-day read (Mon displayed, Mon evening ET): {7579.93, 7508.16, 7575.39} =
  Friday's OHLC — currently correct on both paths; the anchor matters once the ET date rolls past
  the displayed session (weekend/holiday/pre-open), per the spx-session unit test.
- **Tests** (all in-repo, green): `vector-key-levels.test.ts` +6 — 3-real-ET-day fixture (Thu/Fri/Mon,
  distinct ranges): lastSessionBars slice; HOD/LOD = last session only; OR = last session's first 15m;
  fib 0%/100% at last-session extremes; same assertions after 5m/15m aggregation; prior-day/pivot
  lines from the passed prior OHLC + source guard that VectorChart sends `anchor=sessionYmd`.
  `spx-session.test.ts` +1 — displayed-session anchor returns the session strictly BEFORE the anchor
  (and documents the wall-clock-Saturday failure it replaces). tsc clean, full `npm test` + build green.

## 2026-07-14 — Night Hawk pane console noise (found by the post-#322 pane validation gate)

### LOW — /api/nighthawk/play-status returned 404 for its EXPECTED pre-cron state (FIXED — fix/play-status-404-noise)
- **Found**: post-#321/#322 deployed-build pane validation (`pane-validate.mjs`, 8/9 PASS) failed its
  zero-console-error check; a response-listener probe pinned the one error to
  `GET /api/nighthawk/play-status?date=2026-07-14 → 404`.
- **Root cause**: `src/app/api/nighthawk/play-status/route.ts` responded **404** when the 9:15am ET
  morning-confirm cron hadn't written the date's Redis blob — but that is the EXPECTED state for
  every pane load before 9:15am ET and all evening once the date param rolls to the next ET day
  (~15 h/day). Browsers print every 4xx to the console regardless of JS handling, so members (and
  our zero-console-error E2E gates) saw a red error on a healthy pane. The only caller
  (`fetchNightHawkPlayStatus`) mapped `!res.ok` → reason-less `{available:false}`.
- **Fix**: not-yet-run branch now responds **200** with the same honest
  `{available:false, date, reason}` body (the caller now receives the reason instead of
  synthesizing a blank one). True failure states (Redis unconfigured/unreachable) keep 503.
- **Tests**: `play-status-contract.test.ts` — not-yet-run must be 200 with available:false, never
  404; 503 must remain for Redis failure states. tsc clean.

## 2026-07-14 — 0DTE board: OPEN regressed to "Watch" mid-session (member-reported, P0, fix/zerodte-status-latch)

### P0 — a board card wearing the OPEN badge flipped back to a watch/SKIP card within seconds (FIXED — one-way commit latch at every layer)
- **Root cause (presentation, the one the member saw):** `resolveFreshFindStatus`
  (`src/lib/zerodte/board.ts`) returned **"OPEN" for a clean RTH fresh find** — an
  UNCOMMITTED candidate with no ledger row. Both consumers (`mergePlays`,
  `ZeroDteBoard.tsx`; `zeroDtePlaysForLargo`, `src/lib/platform/zerodte-service.ts`)
  rendered it exactly like a committed open position (OPEN badge, play card, sorted
  first; Largo intel action "ADD" with an "Enter ≤ $x" line). Every ~5s board build
  re-derives that find's plan and gates from live quotes, so the label flapped: plan
  `entry_status` → MOVED, spread → `illiquid`, or (post-#322) gate verdict → BLOCKED
  each demote the very same card to SKIP/watch-only on the next poll. Commits only
  persist on the ~2-min cron (`warmZeroDteBoard`), so a find could wear OPEN for up
  to ~2 min with nothing durable behind it. **#322 assessment:** it fixed the worst
  half (gate-BLOCKED finds no longer showed OPEN/ADD) but didn't touch the core
  (clean uncommitted finds still OPEN) — and gave the flap a third trigger (verdict
  flipping COMMIT→BLOCKED across ticks now flipped the badge OPEN→SKIP, where
  pre-#322 both frames showed OPEN).
- **Root cause (vanishing committed rows, second verified path):** `readZeroDteLedger`
  (`src/lib/zerodte/scan.ts`) swallowed ANY DB failure into `[]` —
  indistinguishable from "nothing committed today". One transient blip removed every
  committed play from the payload for a cache window, and because committed tickers
  usually still rank in the scan's fresh finds, the member's OPEN card re-rendered
  as an uncommitted watch card.
- **Root cause (DB, latent):** `updateZeroDteLiveState` (`src/lib/db.ts`) let any
  non-CLOSED status overwrite any other. Two independent writers share it (the
  ~2-min cron sync and the ~1s live-marks lane, each with its own latch memo /
  possibly-stale row snapshot), so a stale writer could demote TRIM → HOLD/OPEN.
  (#321 had already made CLOSED terminal.)
- **Fix (one-way door, all layers):**
  1. `resolveFreshFindStatus` now returns **WATCH, never OPEN** — OPEN is reserved
     for ledger rows. New WATCH presentation: pane renders WATCH cards in
     "Skipped & watching" with a `WATCH — NOT COMMITTED` badge + candidate copy;
     `buildIntelNote` gained a non-actionable WATCH verb (never "ADD"/"Enter ≤");
     `fresh_finds` now carries an explicit `status` field for Largo/BIE.
  2. Merge latch: committed-ticker dedupe in both merges is case-insensitive; a
     concurrent fresh find of a committed ticker is dropped as a duplicate, never
     allowed to demote the ledger presentation.
  3. `readZeroDteLedgerChecked`: failed reads serve the replica's last-good
     same-session snapshot; with no snapshot, `committed_known:false` makes the
     board fail CLOSED on fresh finds (setups suppressed, `upstream_ok:false`) —
     same rule `persistZeroDteScan` already applied to commits.
  4. SQL monotonic ladder in `updateZeroDteLiveState`: OPEN ↔ HOLD (live rung,
     legitimate both ways per `derivePlayStatus`) → TRIM (sticky) → CLOSED
     (terminal); regressing status writes are dropped in the CASE, mark/peak/trough
     still land.
- **Blast radius checked:** BIE composers + Largo ambient feed ride the same fixed
  payload readers. **SPX Slayer surface (spx-play-\*): NOT affected** — its open play
  is read from the store BEFORE any fresh gate evaluation (`evaluateSpxPlayCore` →
  `loadOpenPlay()` → `evaluateOpenPlay`), phase regresses to SCANNING only on a real
  SELL close, and a DB failure in `loadOpenPlay` throws (route 500s) instead of
  silently rendering SCANNING while a play is open.
- **Tests:** `board.test.ts` (WATCH-never-OPEN regression + WATCH intel),
  `ZeroDteBoard.test.ts` (fresh RTH find is WATCH; committed row wins over a
  conflicting BLOCKED dup, both orders + case-insensitive), `zerodte-service.test.ts`
  (Largo dedupe both orders; WATCH intel; unknowable-ledger fail-closed),
  `scan.test.ts` (last-good latch; committed_known:false), `db.test.ts` (SQL CASE
  ladder). tsc clean, full `npm test` green.

## 2026-07-14 — Night Hawk OVERNIGHT grading (PR-N1, branch fix/nighthawk-grading-constraint)

### P0 — Stale outcome-CHECK re-add broke every 'unfilled' grade; 12 rows permanently "pending" (FIXED)
- **Severity:** P0 — 12 of 26 all-time published plays (46%) invisible to the public
  track record, silently and permanently.
- **Root cause:** `ensureSchema()` (`src/lib/db.ts`) issued the
  `nighthawk_play_outcomes_outcome_check` CHECK **twice**: the correct DROP+ADD right
  after the table DDL (`db.ts:547-551`, allowed set WITH `'unfilled'` — the
  grading-honesty fix), then a stale pre-fix copy at `db.ts:820-823` (after the
  `admin_audit_log` DDL) that re-issued it WITHOUT `'unfilled'`. Running later, the
  stale copy won on every boot, so every `UPDATE … SET outcome = 'unfilled'` threw a
  check-constraint violation and the row stayed `pending` forever. Not caught earlier
  because the outcomes cron swallowed per-row failures into `meta.errors` while logging
  `last_status: ok` (green cron-health, no ops ping), and the resolver's 7-day lookback
  (`play-outcomes.ts`, `resolvePendingNighthawkOutcomes`) silently stopped revisiting
  the failed rows once they aged out — while `pending_count` is unwindowed, so the UI
  honestly showed "12 pending" with no path to ever resolve them.
- **Evidence:** cron-health meta for `nighthawk-outcomes` lists exactly the 12 stuck
  rows — AAPL/CSX/MAGS@2026-07-06, AMZN/BAC/TSLA@2026-07-07, AMD/DELL/WFC@2026-07-08,
  PG@2026-07-09, META/PANW@2026-07-10 — and the arithmetic closes exactly: 26 plays
  published all-time − 14 app-resolved = 12 stuck. Under current `resolveOutcome()`
  rules all 12 grade `unfilled` (the constraint-rejected verdict). Full forensics:
  `docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` §0.1/§1.3 (H-1/H-2).
- **Fix (PR-N1):**
  1. Deleted the stale re-add block (`db.ts:819-824` pre-fix numbering); the correct
     6-value CHECK re-issue now runs exactly once. Grepped `ensureSchema` for the same
     duplicate-constraint idiom on other tables: **none** — the three FK `ADD
     CONSTRAINT`s are all `IF NOT EXISTS`-guarded with unique names; only the
     play-outcome CHECK was duplicated.
  2. Historical repair: `regradeStuckNighthawkOutcomes()`
     (`src/features/nighthawk/lib/regrade-stuck.ts`) + admin route
     `POST /api/admin/nighthawk/regrade-stuck-outcomes` (mirrors
     `admin/zerodte/regrade-index-roots`) — selects rows still `pending` beyond the
     resolver's lookback and re-runs the cron's own resolution path. Bounded
     (limit ≤ 200), idempotent (`WHERE outcome='pending'` guard + pending-only fetch),
     dry-runnable, audit-logged to `admin_audit_log`.
  3. Cron honesty: `nighthawkOutcomesRunHealth()` — `meta.errors` with content ⇒ the
     run records `failed` (not `ok`) in cron-health, fires the ops-Discord ping via
     `logCronRun`, and the route returns 500.
- **Deliberately unchanged (→ N2):** the resolver's 7-day lookback vs the unwindowed
  `pending_count` (H-2), and the full historical re-grade of the 14 already-resolved
  rows under current rules (the N-2 methodology blend). The regrade endpoint repairs
  the stuck class only; widening the lookback silently would hide the window-mismatch
  design question PR-N2 owns.
- **Tests:** `db.test.ts` (source contract: outcome CHECK ADDed exactly once, paired
  DROP, allowed set includes all 6 outcomes incl. `'unfilled'`),
  `regrade-stuck.test.ts` (stuck fixture regrades to unfilled/target/stop under
  current rules; dry-run persists nothing; idempotent second run; limit bound;
  no-bar skip stays honest; in-window rows left to the cron; per-row failure doesn't
  abort the batch), `play-outcomes.test.ts` (errors non-empty ⇒ not ok; route wiring
  pin). tsc clean, full `npm test` green (3209/3209).
- **Post-merge action:** run the regrade endpoint against prod (dry-run first) once
  deployed — expect matched=12, all `unfilled` — then confirm the record strip shows
  26 resolved and `pending_count` equals the live edition's play count only.

## 2026-07-14 — Night Hawk OVERNIGHT: evidence pinning + binding morning verdicts (PR-N4, branch feat/nighthawk-pinning-verdicts)

### HIGH — Editions published with no decision context; morning verdicts unpersisted and advisory (FIXED)
- **Severity:** HIGH (process/calibration + member harm). Two coupled gaps from
  `docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` (§0.5, N-7, C-2 class):
  1. Plays published with NO pinned record of what the builder saw — every
     calibration cut (VIX-at-entry, regime-at-entry, band-vs-spot) was impossible
     after the fact, the same C-2 blindness the 0DTE side fixed with
     `entry_context` (#311).
  2. Morning-confirm verdicts lived only in a 24h-TTL Redis badge + a Discord
     ping. INVALIDATED changed nothing on the member surface: AMD 2026-07-07 (the
     record's only A+) gapped −6.55% through its published stop pre-market, was
     INVALIDATED-knowable at 9:15, stayed fully actionable on the board, booked
     −6.59% — and the verdict itself evaporated with the TTL.
- **Fix (PR-N4):**
  1. **Publish-time pin** — `publish_context` JSONB on `nighthawk_play_outcomes`
     (idempotent ALTER; COALESCE first-write-wins in the upsert, mirroring the
     0DTE idiom). Built by `src/features/nighthawk/lib/publish-context.ts` from
     the SAME in-memory build context the edition publishes from (never
     re-fetched): spot/prior-close/ATR from the dossier tech card, signed
     band/target/stop distance % (the N-3 detached-band signature), regime + the
     BIE market-breadth bundle, earnings-tomorrow knowledge, and the scorer's own
     confluence snapshot (shared shape with the rejection audit rows). Fail-soft:
     a pin failure logs and publishes un-pinned — never blocks the edition.
  2. **Persisted verdicts** — `morning_verdict` JSONB on the play row
     (first-write-wins: the 9:15 read is the calibration datum), written by the
     morning-confirm cron alongside the kept Redis badge, carrying the numbers the
     check saw (pre-market spot, gap pts/pct, spot-vs-stop/-band %, regime).
     Persistence ledger surfaces in the cron payload/cron-health meta.
  3. **INVALIDATED is binding** — one-way `pulled` latch (pulled/pulled_reason/
     pulled_at; `pulled OR` in SQL, #326 latch discipline). The edition read path
     merges the latch at read time (`pull-overlay.ts` — edition row never
     mutated): the play stays visible at its published rank, presented PULLED
     with the verdict's reason (badge + struck-through levels). Pulled plays
     still grade (counterfactual) but are excluded from every headline surface
     (`analytics.ts` scoreable + `isNighthawkOutcomeScoreable` in
     track-record-page.ts, kept in lockstep; `pulled_count` surfaced). DEGRADED
     stays advisory — enforcement thresholds are a calibration decision deferred
     to N6, now answerable from exactly this verdict table.
- **Tests:** `publish-context.test.ts` (pin shape/signs, never-guess nulls,
  per-play fail-soft), `morning-verdict-persist.test.ts` (numbers-seen contract,
  INVALIDATED pulls / DEGRADED doesn't, idempotent re-run + one-way latch,
  missing-row honesty, per-play failure isolation), `pull-overlay.test.ts`
  (visible-as-pulled, non-destructive, case-insensitive), `analytics-pulled.test.ts`
  (counterfactual grades never count, either direction; DEGRADED still counts),
  `nighthawk-pinning-contract.test.ts` (SQL COALESCE/one-way pins, overlay on all
  serve branches, Redis badge kept). tsc clean, full `npm test` green, next build
  green.
- **Deliberately unchanged:** grading path (`resolveOutcome`) — a pulled play's
  grade IS the counterfactual, tagged by `pulled` for N2's methodology-versioned
  record; DEGRADED enforcement (→ N6); Cortex compose at publish/9:15 (→ N5/N6);
  the Redis play-status blob and its UI badge (kept as-is).

## 2026-07-14 — Night Hawk playbook UI rebuild (PR-N12, branch feat/nighthawk-playbook-ui)

### LOW — Component test outside the CI glob: `PlaybookBoard.ssr.test.tsx` never ran (FIXED in PR-N12)
- **Severity:** LOW (verification gap, no member impact). Both `npm test` and the CI
  `verify` job expand `src/**/*.test.ts` (ci.yml "Unit tests" step, bash globstar) —
  a `*.test.tsx` file never matches, so the playbook board's only rendering suite
  (`PlaybookBoard.ssr.test.tsx`) was silently skipped on every run since it landed.
  Evidence: `files=(src/**/*.test.ts)` in `.github/workflows/ci.yml:37`; the suite
  also fails when run manually (`ReferenceError: React is not defined` — classic-JSX
  transform, the FreshnessChip.ssr.test.ts global-React idiom was never applied).
- **Root cause:** test authored as `.tsx` for JSX convenience; nothing guards that
  new test files land inside the glob CI actually executes.
- **Fix:** replaced by `PlaybookBoard.test.ts` (React.createElement + global-React +
  relative dynamic imports, per the FreshnessChip idiom) — 15 rendering/contract
  tests that DO execute in CI. Folded into PR-N12 because the old suite asserted the
  exact five-empty-slot layout that PR removes; a separate PR would have merged a
  dead test only to delete it.
- **Residual:** other `*.test.tsx` files would have the same blind spot (none exist
  today); consider a CI guard that fails on `src/**/*.test.tsx` files.
