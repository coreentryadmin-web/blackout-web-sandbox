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
