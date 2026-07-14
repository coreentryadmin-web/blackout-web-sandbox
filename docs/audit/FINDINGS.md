# FINDINGS — living issue log

(Rebuilt 2026-07-13: the prior log was clobbered to an empty file by a squash-merge
conflict-resolution mishap. Historical entries live in git history — `git log --all --
docs/audit/FINDINGS.md`. New entries append below; keep severity / root cause / file:line /
evidence / fix / status per the CLAUDE.md policy.)

## 2026-07-14 — Night Hawk overnight edition: Cortex overnight lens + catalyst veto — PR-N5

### P1 — no publish-time evidence gate on overnight picks (best-plays-only) (BUILT, tested)
- **Severity:** P1 (strategy gate — the "make picks strong" build of the overnight ladder).
- **Root cause / motivation (NIGHTHAWK-OVERNIGHT-DECISION.md forensics):** after the #332 geometry
  gates a candidate published with NO evidence discipline. Named failure modes: **§3.4 the overnight
  killer** — earnings/binary events only *nudged* the score (−6, and only when a flow expiry matched
  the event date), so "no play can currently be VETOED for an earnings/binary event, and no play was"
  (AMD-class gap-through-stop deaths). **N-4 long-only monoculture** — regime only scaled scores,
  nothing marked a long into a bearish tape/sector as a negative. **§3.2** — per-ticker wall structure
  ignored (a long whose target sits beyond a hardening call wall fights dealer structure). Plus the
  one-print-splash / overnight-carry-cost / dark-pool-fade classes.
- **Fix (this PR):** new deterministic, no-LLM `src/features/nighthawk/lib/cortex-overnight/` lens —
  the overnight analogue of the intraday 0DTE Cortex (same veto asymmetry: supports capped per
  source, vetoes UNBOUNDED, net score). Six fail-soft sources: **catalyst-veto** (earnings/binary in
  the hold → HARD VETO unless the play is flagged a catalyst play — §3.4), **wall-migration** (target
  beyond / fighting a hardening opposing wall — §3.2), **darkpool-trend** (accumulation vs the play),
  **iv-term** (overnight theta/vega cost), **sector-breadth** (long into a bearish sector/tape — N-4),
  **flow-persistence** (streak/into-the-close vs morning splash). Composed at publish STRICTLY AFTER
  the #332 gates in `edition-builder.ts`: VETO → does not publish, persists as `nighthawk_rejected`
  (new `cortex_overnight_veto` union variant in `play-outcomes.ts`) for counterfactual grading; WEAK
  → publishes flagged, conviction floored to C; total lens outage → ABSTAIN (passes on gates alone,
  never blocks the book). Full verdict pinned into `publish_context.cortex_overnight` (additive key)
  as the Debrief/#337 + calibration substrate.
- **Evidence (tests):** `cortex-overnight.test.ts` + `sources/*.test.ts` (29 new) — catalyst veto
  fires on earnings-tomorrow-premarket and does NOT on a labeled catalyst play (emits an oppose);
  afterhours-on-horizon still vetoes; wall-fighting/building → oppose stack; each source fail-soft
  (absent w/ error class); veto→rejected-row; net-score + veto-asymmetry math; total outage→abstain;
  pinned into publish_context. Example replay of the AMD-7/07-class pick: an earnings-tomorrow long
  composes to VETO (score-irrelevant) — exactly the death the deep-dive named. tsc clean; 385 nighthawk
  lib tests green; eslint clean.
- **Status:** BUILT + tested. PR open (not merged — headline build, reported for review).

## 2026-07-14 — Largo gauntlet P1s (deployed build, via POST /api/market/largo/query) — PR-L4a

### P1 — "now" / "right now" collided with the ticker $NOW (ServiceNow) (FIXED, tested)
- **Root cause:** EXTRACTION. `extractKnownTicker`/`extractCompareTickers` in
  `src/lib/bie/router.ts` did `question.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g)` and accepted any
  token in `KNOWN_TICKERS`. The adverb "now" uppercased to "NOW", which IS in `KNOWN_TICKERS`
  (`question-intent.ts:67`), so bare "right now" resolved to $NOW. `classifyBieStagingFallback`'s
  terminal `if (ticker) return { intent: "ticker_advice", ticker }` then answered with a ServiceNow
  desk verdict. Not a routing/composer bug — the mis-extracted ticker was correct-looking garbage in.
- **Evidence (gauntlet):** "What is our honest Night Hawk record right now, and why did the headline
  number change recently?" → "NOW — desk verdict … spot 110.16 … peers META, CRM, NVDA, MSFT".
  Same on "Where is the crowd wrong right now?".
- **Fix:** case-preserving extraction + a FUNCTION-WORD stopword guard (`STOPWORD_TICKERS`): a bare
  English stopword that is also a ticker (only `NOW` intersects the allowlist today) counts as a
  ticker ONLY with a `$` prefix or an unambiguous context ("NOW stock", "ticker NOW"); content-noun
  tickers (ARM, CAT) are deliberately NOT gated (no over-restriction). `src/lib/bie/router.ts`.
- **After:** primary classifier returns null → Claude reaches `get_nighthawk_outcomes` (the honest
  11.1% record); staging fallback returns `market_context`, never a NOW verdict. `router.test.ts`.
- **Status:** FIXED (tsc clean, full suite green).

### P1 — False spatial premise accepted (spot "above" its call wall when it was below) (FIXED, tested)
- **Root cause:** COMPOSER. `detectPremiseCorrections` (`src/lib/bie/spx-premise.ts`) only checked
  VWAP and gamma-flip claims; a wall / max-pain spatial claim was never validated against the live
  number the read already fetches, so a false "pinned above its call wall" passed straight into a
  bullish desk read.
- **Evidence (gauntlet):** "Why is SPX pinned above its call wall right now?" — SPX spot 7,515, call
  wall 7,550 (spot BELOW). Largo gave a bullish read and never corrected the premise.
- **Fix:** added deterministic call-wall / put-wall / max-pain guards. Call/put wall derived from the
  desk's own ladder (max positive / most-negative net_gex, canonical `topGexWalls` semantics); the
  direction word is tied to the level phrase so compound sentences scope correctly; a false claim
  emits `CORRECTION  SPX at 7,515 is actually BELOW its call wall 7,550, not above it …` prepended
  before the read. TOL=1pt so "pinned AT the wall" isn't flagged. `src/lib/bie/spx-premise.ts`.
- **After:** the gauntlet call-wall question now leads with the correction; a TRUE "above call wall"
  claim emits none. `spx-premise.test.ts`.
- **Status:** FIXED (tsc clean, full suite green).

## 2026-07-14 — Largo gauntlet P1: no scenario/what-if reasoning — PR-L4c

### P1 — Largo can't reason over a hypothetical price move (NEW ENGINE, tested)
- **Root cause:** COVERAGE GAP, not a bug. The BIE router (`src/lib/bie/router.ts`) had no
  `scenario` intent. A what-if question ("if SPX drops 1% at tomorrow's open, does the regime flip,
  which walls become live?") therefore fell to whichever static branch its keywords hit (the SPX
  structure/desk read) or to Claude — neither of which recomputes structure at a DIFFERENT spot. So
  every part came back "unavailable — no deterministic read," even though the answer is pure
  arithmetic over data the desk already holds: the flip, walls, max-pain, expected-move and ladder
  are all live on the Vector full state; only the ANCHOR (spot) changes.
- **Evidence (gauntlet):** "If SPX drops 1% at tomorrow's open, what happens to the dealer
  positioning picture — does the regime flip, and which walls become live?" → all parts
  "unavailable — no deterministic read."
- **Fix:** new deterministic scenario composer `src/lib/bie/scenario-read.ts` +
  `scenario` router intent. `parseShift` reads a move out of the question (percent / points /
  absolute price / structural "the flip"|"the wall"); `resolveShiftTarget` turns it into a shifted
  spot against the live state; `buildScenarioEnvelope` recomputes at that spot using the SAME
  `deriveVectorRegime` the chart renders — regime + whether the shift CROSSES the flip (the key
  event), which call/put walls the shifted spot now sits between + any wall it PIERCES (role flip),
  the max-pain pull direction/distance, and a magnitude-honesty read vs the options-implied 1σ
  (within-1σ wiggle vs tail move). Framed explicitly as dealer STRUCTURE at that price, NOT a
  forecast or probability. Router double-gates the route (a hypothetical trigger AND a parseable
  shift) so it never steals concept/cortex/edition/verdict/compare.
- **Evidence after (fixture render, "if SPX drops 1%"):** "SPX 7,560 → 7,484.4 (−76 pts, −1%) …
  1.37× 1σ (±0.73%) — beyond 1σ but inside 2σ … **CROSSES the gamma flip 7,520** — regime FLIPS
  from long gamma to short gamma … PIERCED: put wall 7,500 … max pain 7,550 pulls UP (+66 pts)."
- **Status:** FIXED (new engine; tsc clean, full suite green — 3487 pass; scenario-read.test.ts +
  router.test.ts scenario regression table).

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

## 2026-07-14 — Night Hawk OVERNIGHT: publish-time sanity gates (PR-N3, branch feat/nighthawk-publish-gates)

### HIGH — No band-vs-spot / achievable-target / quote-freshness check anywhere in the publish path (FIXED — gate stack)
- **Severity:** HIGH (member-hostile picks + phantom record). Measured in
  `docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` §N-3: **14/24 LONG plays** published an
  entry-band top >3% below prior close; the six thin-edition backfill plays (MAGS/CSX
  7/06, DELL 7/08, PG 7/09, PANW/META 7/10) sat **6.4%–45.5% below the market** with
  targets +8.6%..**+106.6%** away — DELL 2026-07-08: band $226.82–227.27, stock at
  $417, target $469.47, mechanically stamped conviction "A". Root: the backfill anchors
  entries at deep dossier supports (`buildDirectionalStockLevels`, support×0.998) and
  NOTHING in `edition-builder.ts` STAGE 6 compared the published band to the live quote
  or the target to a one-session range. These unfillable plays are simultaneously
  member-hostile (untransactable as published) and the source of the N-2 phantom-win
  record (gap-away "wins" the entry could never catch).
- **Fix (PR-N3):** `src/features/nighthawk/lib/publish-gates.ts` — pure gate evaluation
  over the SAME geometry the PR-N4 publish-context pin records (shared
  `computeNighthawkPublishGeometry`, publish-context.ts — one computation, so the number
  that blocks a play is byte-identical to the number pinned as evidence). Wired into
  `edition-builder.ts` STAGE 6 strictly AFTER thin-edition backfill (the class that
  shipped the six detached plays). Gates:
  - **G-N1 band-vs-spot** (`band_detached`): |spot → fill edge| > **2.5%** blocks
    (absolute — a band far above spot is equally unfillable). From the data: failing
    class >3% (catches all 14), worst −45.5%; healthy plays within ~1.5% (normal
    pullback entries keep publishing). Calibratable from pinned PASS margins.
  - **G-N2 achievable target** (`target_unreachable`): |fill edge → target| >
    **1.5×ATR14** blocks. One-session plays grade against the next day's high/low;
    ATR14 is the average full-session range (doc suggested k=1.0 — shipped 1.5 for one
    expansion-day of headroom). The failing class ran ≈3×–20×+ ATR; DELL = 19.4×.
  - **G-N3 stale-quote guard** (`stale_quote_basis`): the spot quote's session
    (`TechnicalCard.price_session`, new provenance field from the last daily bar's
    timestamp) must be an acceptable basis for the session being published from
    (`acceptableQuoteSessionsEt`: last completed session; during RTH also the
    in-progress one). Undateable quote = fail-closed.
  - **Fail-closed** (`geometry_unknown`): missing spot/band/target/ATR — or an
    evaluator throw — BLOCKS. A pick we can't sanity-check is not a pick (opposite
    polarity from the pin, which is fail-soft evidence).
- **Wiring semantics:** BLOCKED plays never publish — they persist as
  `nighthawk_rejected` audit rows (new `publish_gate` stage in `play-outcomes.ts`'s
  rejection union, same dedup'd `insertNighthawkRejectedAuditLog` write path), carrying
  the gate blocks verbatim so counterfactual grading/calibration can judge the gates
  later (0DTE skip-grading philosophy). Every play's full gate result — PASSES with
  per-gate margins — is pinned into `publish_context.gates` (context_version → 2).
  Gates zeroing the edition publishes an honest recap-only edition (zero honest plays
  beats one unfillable play; the real 7/14 edition was already honestly zero-play).
- **Evidence/tests:** `publish-gates.test.ts` (28 new tests incl. publish-context
  additions): each gate both directions at its exact boundary (2.5% / 1.5×ATR),
  DELL fixture reproduces the doc numbers (−45.4988% band + 19.376×ATR → BLOCK with
  both codes), the >3% class blocks while a 1.5% pullback publishes, fail-closed
  geometry_unknown (no dossier / no ATR / unparseable band / evaluator throw),
  rejected-row persistence (trigger_reason + per-block decision_trace + gate_blocks
  snapshot), zero-play recap reason, verbatim gate pinning, quote-session math across
  close/weekend/holiday. tsc clean; full `npm test` green (3273).
- **Deliberately unchanged:** analytics/track-record/record display (PR-N2 territory —
  the new `publish_gate` stage auto-appears in the funnel via the existing
  `REJECTION_TRIGGER_REASON` reverse-index); the backfill's level construction itself
  (the gate now rejects its detached output; re-anchoring backfill entries near spot is
  a follow-up once gate rejections show what survives); morning-confirm/Cortex veto
  (N5/N6); `src/lib/bie/**`, `src/lib/zerodte/**`.

## 2026-07-14 — Night Hawk OVERNIGHT: methodology blend + phantom-win record (PR-N2, branch fix/nighthawk-honest-record)

### HIGH — Advertised 42.9% WR blended two grading methodologies; every historical "win" was a gap-away the entry could never catch (FIXED — methodology-versioned record)
- **Severity:** HIGH (member-facing record integrity). The public overnight record
  (`/api/market/nighthawk/record`, `HawkRecordStrip`, `/api/track-record`, signal
  accuracy, Largo's comparison tool) aggregated rows graded under two different rule
  sets into one win rate, and the winning tail was entirely pre-fillability grades.
- **Root cause:** `resolveOutcome()` gained the fillability rule ("the session must
  trade back into the published entry band or the play is `unfilled`") AFTER 14 of the
  26 all-time plays had already been graded under the old level-touch rules (target/stop
  from session high/low alone, no fill check). Nothing recorded WHICH rules graded a
  row, so `getNighthawkMetrics()` (analytics.ts) had no way not to blend: the 14
  legacy-graded rows aggregated with the 12 current-rules grades from the PR-N1 stuck
  repair. Not caught earlier because the blend is invisible in the schema — both rule
  sets write the same `outcome` column.
- **Evidence** (`docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` §2.1/§2.2 N-2, from the
  26-play `nh-overnight/derived.json` forensics vs Polygon bars):
  - App-graded (what members saw): 14 resolved, 6T/5S/3O → **42.9% WR**.
  - Same 14 under the product's own current rules: 1T/5S/3O/5U → **11.1%** (1/9).
  - Open-beyond-band plays: **6T/1S, +5.11% avg — all six advertised wins**; genuinely
    fillable-at-band plays: **0T/4S, −1.39% avg**. The record's wins were unfillable
    gap-aways; its fillable plays all failed.
- **Fix (PR-N2):**
  1. **Methodology versioning** — `grade_methodology` TEXT on
     `nighthawk_play_outcomes` (idempotent ALTER). Tags name the RULE, not a date
     (`grade-methodology.ts` leaf): `v1_level_touch` (pre-fix) / `v2_fillability`
     (current). Every grade write through `updateNighthawkPlayOutcome` (cron + stuck
     repair) stamps `v2_fillability` in the same UPDATE; boot backfill stamps
     unstamped resolved rows `v1_level_touch` (conservative: unprovable provenance
     never reads as current — the 12 PR-N1 rows land legacy until re-verified).
  2. **Honest re-grade** — `regrade-legacy.ts` +
     `POST /api/admin/nighthawk/regrade-stuck-outcomes` `{"mode":"legacy_methodology"}`
     (bounded/idempotent/dry-run/audit-logged, regrade-stuck pattern): re-runs current
     `resolveOutcome` over each legacy row's OWN persisted bars (no new inputs), pins
     the superseded grade in `legacy_grade` JSONB (COALESCE first-write-wins — history
     quarantined, never destroyed), promotes the row to `v2_fillability`. Idempotence
     is in the SQL guard (`grade_methodology <> current`), not caller discipline.
  3. **Anti-blend record** — `getNighthawkMetrics` partitions by methodology FIRST;
     headline WR + every cut (conviction/direction/sector/score/edition) computed from
     current-segment scoreable rows only; `segments.current`/`segments.legacy` reported
     side by side, each with its own label, counts (unfilled/pulled/stop-data-
     unavailable), nullable win_rate, and `low_n` (shared `LOW_N_THRESHOLD`=5 from
     zerodte/record.ts). `HawkRecordStrip` shows the honest split (scoreable-gated
     ripeness, unfilled/pulled/legacy-graded counts, methodology tag, amber n<5 chip —
     the 0DTE record grammar). Blast radius closed at the shared predicate:
     `isNighthawkOutcomeScoreable` (track-record page, `/api/track-record/plays`,
     signal accuracy) now requires the current tag, and Largo's
     `get_spx_vs_nighthawk_comparison` filters through it.
- **Honest post-regrade record** (30d window; the strip keeps showing the building
  state): current-methodology scoreable n≈9 → **1T/5S/3O, 11.1% WR**, ~17 unfilled
  surfaced, 0 blended-legacy rows remaining. There is no methodology under which the
  overnight book has a fillable positive-expectancy record yet — the strip now says so
  instead of advertising 42.9%.
- **Tests:** `regrade-legacy.test.ts` (phantom-win → unfilled with old grade preserved,
  restamp-without-change, idempotence + first-write-wins, dry-run, bounds, unresolvable
  skip, error isolation), `analytics-methodology.test.ts` (blend-impossible: flipping
  every legacy row to a win cannot move the headline; NULL/unknown tags quarantine;
  unfilled surfaced not counted; LOW-N on every cut; null-not-fake-0% segments),
  `record-honesty-contract.test.ts` (SQL idempotent ALTERs, backfill scope, write-path
  stamping, COALESCE preservation + regrade guard, route serves segments, strip renders
  the split, shared predicate checks methodology), plus legacy-quarantine cases added to
  track-record-page/run-tool suites. tsc clean, full `npm test` green (3276).
- **Deliberately unchanged:** `resolveOutcome` itself (rules unchanged — this PR only
  records WHICH rules graded a row and re-applies the current ones to old rows); the
  edition builder/scorer and `src/lib/bie/**` (parallel agents); H-3 option-premium
  vs underlying-level grading (a third methodology version when tackled — the tag
  machinery is ready for `v3_*`); the resolver's 7-day lookback (PR-N1's ledger).

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

## 2026-07-14 — Largo HARDCORE suite (PR-L2, branch test/largo-hardcore-suite)

New standing battery: `scripts/largo-hardcore-e2e.mjs` (`npm run validate:largo-hardcore`) — 75
checks through the REAL member ask path (`POST /api/market/largo/query`), all day-agnostic
(expectations derived at runtime from the same build's clean JSON APIs). Verified green-with-knowns
against staging: **68 pass · 0 fail · 4 skip · 3 expected-fail (keyed to #338)**.

### Confirmed FIXED on the deployed build (now hard-asserted by the suite — regressions will gate)
- **13 desk concepts + terse-concept + compare** resolved to the wrong glossary entry on an
  earlier build (e.g. "dark pool level" answered with the gamma-flip def; terse "helix"/"vwap" both
  answered with the King-node def). Fixed per #336 (battery 37/37). All 16 concept checks + the
  "Thermal has no dark-pool text" regression + terse helix/vwap now PASS; the suite hard-asserts
  them so a re-break surfaces loudly.
- **SPX cross-horizon full-state contamination** (a horizon ask served another horizon's cached
  state through Largo while the JSON APIs re-scoped correctly). Re-verified with an ordered probe
  (weekly→0dte→weekly→monthly): each now serves its OWN header + flip (0dte 7,512.66 / weekly
  7,671.32 / monthly 7,746.60). All numeric checks PASS and hard-assert.

### OPEN — honest gaps, EXPECTED-FAIL keyed to #338 (Largo NOW-routing + honest scope/freshness)
- **MEDIUM — out-of-scope asks topic-swap into a market dump.** "Write me a poem about the ocean."
  → full SPX-desk + HELIX-tape dump, no scope statement. Root: the staging BIE-only last-resort
  fallback (`classifyBieStagingFallback` → `market_context`, src/lib/largo-terminal.ts:330) has no
  off-topic guard. Suite tag: `KNOWN_338`.
- **MEDIUM — off-hours "right now" answers carry no as-of/staleness marker.** At ~01:40 ET,
  "What is the market doing right now?" and "On Vector, what's the SPY setup right now?" returned
  full desk briefs with prices/regime/premium and NO timestamp/"as of"/closed-market marker — a
  snapshot presented as live. The envelope type has the freshness spine
  (BieProvenance.asOf/freshness, answer-envelope.ts) but the string-leg briefs don't surface it.
  Suite tag: `KNOWN_338` (×2). The fixing PR re-runs with `STRICT_KNOWNS=1` to flip these to hard
  asserts.

### Also observed (not suite-gating)
- `/api/market/spx/desk` served `vwap: 0` off-hours while the desk brief still narrated a VWAP
  relation — the suite guards its VWAP-premise case on `vwap > 0` and SKIPs it off-hours;
  producer-side honesty (null, not 0) worth a look.

## 2026-07-14 — Night Hawk OVERNIGHT: the Debrief — end-of-session intelligence (PR-N10, branch feat/nighthawk-debrief)

### MEDIUM — No automated end-of-session intelligence existed: grades said WHAT, never WHY, so "how do we improve the system" was unanswerable without a manual forensic pass (FIXED — the Debrief)
- **Severity:** MEDIUM (process/learning-loop gap, not a live wrong number — but it is
  the gap that let N-2..N-8 accumulate unnoticed). After #329–#333 the overnight book
  finally grades honestly, but a grade is only WHAT happened: AMD 2026-07-07 (the
  record's only A+, gapped −6.55% through its stop pre-open — a loss decided before the
  session) graded `stop` identically to an ordinary in-plan stop-out; DELL 2026-07-08
  (band $226.82–227.27 vs a $417 stock) graded `unfilled` identically to a 30-cent
  near-miss. "What went well / what were REAL winners / what misfired / how do we
  improve" required re-deriving everything by hand (the decision doc's §2 forensics —
  done once, evaporating immediately).
- **Root cause:** no per-play post-mortem artifact existed. Failure MODES (gap-through-
  stop vs wrong-direction vs detached-band), fill quality, MFE/MAE from the real fill,
  and thesis-vs-tape verdicts were never computed or persisted; the publish-gate
  rejections (#332) persisted audit rows but nothing ever graded what the blocked plays
  would have done, so the gates could neither earn nor lose their thresholds.
- **Fix (PR-N10):**
  1. **Per-play debrief** — `debrief.ts` (pure): `debriefPlay(row, bars)` over the
     graded row + the SAME persisted daily bar grading used. Fill quality (did the
     session trade into the band; first-touch bucket open/first-hour/later — time
     buckets only from timestamped intraday bars, honestly `intraday_time_unknown`
     from a daily bar; `unfilled` explained with the day's actual low/high vs band).
     Real-winner test: MFE/MAE from the ACTUAL fill price (gap-through fills transact
     at the open, not the published edge); a win that consumed ≥75% of its stop budget
     is `lucky_win`, an open-beyond-target "win" is `gap_win` (legacy taxonomy — v2
     grades make it impossible). Thesis scorecard: pinned publish-context factors
     (direction / entry band / regime / catalyst-when-flagged) each verdicted
     confirmed | refuted | untestable — missing pins degrade to untestable, never a
     reconstruction. One PRIMARY failure-mode tag from a fixed 11-tag taxonomy with
     documented precedence (pulled → unfilled → wins → stops → ambiguous → open);
     pulled plays are judged on the PULL (`pulled_correctly`/`pulled_wrongly` from the
     counterfactual grade, ambiguous counterfactuals never indict the pull).
  2. **Persistence + cron** — `debrief` JSONB on `nighthawk_play_outcomes` (idempotent
     ALTER; COALESCE first-write-wins in `pinNighthawkPlayDebrief`), written by a
     bounded pass appended to the nighthawk-outcomes cron strictly AFTER grading —
     fail-soft by contract (grading health is computed before the pass runs; pass
     results ride the payload/meta as their own honest ledgers). A second bounded pass
     counterfactually grades #332's `publish_gate` rejections on the SAME daily-bar
     path (`resolveOutcome`, underlying level-touch basis — option premium never
     fabricated), pinned to a new `alert_audit_log.counterfactual_json` (deliberately
     NOT the `outcome` column: that feeds BIE precedent ingestion, where a
     counterfactual would masquerade as a real alert result).
  3. **Aggregate + improvement queue** — `debrief-aggregate.ts` (calibration.ts's
     shape): failure-mode counts and per-conviction records over CURRENT-methodology
     rows only (#333 anti-blend mirrored; legacy quarantine surfaced as a count);
     per-gate blocked value (n blocked / would-have-won rate, counterfactual
     `unfilled` separated as trivially-right); the published MIRROR (retro-applying
     each live gate threshold to the geometry pinned in publish_context — would-block
     vs would-pass record, delta in pts); machine-readable improvement queue
     `{signal, evidence:{n, delta}, suggestion, low_n}` where LOW-N evidence is
     visible but NEVER carries a suggestion (shared `LOW_N_THRESHOLD`).
  4. **Surfaces** — member record route: compact `debrief` summary block (additive,
     segments-aware via analytics.ts). Admin: full report folded into
     `/api/admin/nighthawk/analytics` as `debrief_report` (cheapest honest home — the
     dashboard already reads the route, the auth exists, and gate counterfactuals are
     ops evidence, not member content). Largo: `nighthawk-edition-read.ts` (additive)
     — pick-why gains a "How it debriefed" section rendered ONLY from a real pin, and
     ticker-less results asks ("how did the night hawk plays do?", "debrief") route to
     a session-debrief envelope over the latest graded edition.
- **Evidence (real history, now regression fixtures):** AMD 7/07 debriefs
  `gap_through_stop` ("opened 515.91 already beyond the published stop 550.88 (−6.55%
  overnight gap) — the loss was decided before the session"), thesis direction+regime
  REFUTED, MFE 19% of target distance from the real 515.91 fill. DELL 7/08 debriefs
  `band_detached` ("session low 414 stayed 82.16% ABOVE the band edge 227.27", gate
  bar 2.5%); AMD 7/08 (low 498.15 vs band 495.35, 0.57%) debriefs
  `unfilled_never_traded_back` — the two unfilled classes finally separate.
- **Tests:** `debrief.test.ts` (35 — every taxonomy tag both directions incl. the real
  AMD/DELL fixtures, MFE/MAE math exact, first-touch buckets from timestamped bars,
  thesis verdicts, pulled counterfactual edges), `debrief-aggregate.test.ts` (14 —
  anti-blend, blocked value, retro mirror, queue shape, LOW-N never suggests),
  `debrief-persist.test.ts` (11 — first-write-wins, fail-soft both passes, same-bar-
  path counterfactuals, ungradeable persisted with reason), + 8 Largo cases
  (pin-only rendering, session-debrief routing/envelope). tsc clean; full npm test
  green.
- **Deliberately unchanged:** grading itself (`resolveOutcome`), the edition builder/
  scorer, publish-gates.ts (its constants are imported as the single source of truth),
  `HawkRecordStrip` (parallel agent owns the playbook UI), and gate thresholds — the
  Debrief produces the evidence to move them; it never moves them itself.

## 2026-07-14 — Vector morning-gate backlog (fix/vector-morning-gate)

### P2 — Multi-day replay seed too shallow for the monthly DTE horizon (FIXED, tested)
- **Severity:** P2 (correct data, but the chart/replay canvas didn't span the horizon the member
  is trading — monthly-DTE beads/replay sat over ~3 days of chart under a 30-day wall rail).
- **Root cause:** `TARGET_SEED_SESSIONS = 3` in `src/features/vector/lib/vector-seed-bars.ts:45`.
  The seed feeds the chart candles, the wall rail, and the replay timeline. The MONTHLY DTE horizon
  is 35 calendar days (`HORIZON_MAX_DTE.monthly`, `vector-dte-horizon.ts:23`), and the 30-day
  wall-history retention keeps a month of beads — but only 3 sessions of chart existed to scrub
  them over. The bar-count ceiling `MAX_SEED_BARS = 3000` (~7.7 sessions of 1m) was the real
  governor, so a naive constant bump alone would have been silently capped and ineffective.
- **Evidence:** monthly-DTE replay/beads reference a ~30-day rail; the pre-fix seed returned 3
  sessions (today + 2 prior). New unit test `newest 3 sessions stay 1m; older sessions are
  decimated to 5m` proves the fix returns 22 sessions at `3 × 390 (1m) + 19 × 78 (5m) = 2,652`
  bars for an index.
- **Fix:** `TARGET_SEED_SESSIONS = 22` (≈30 calendar days of trading). To keep the deep seed
  payload-bounded, ported the decimation mechanism (older-than-`FULL_RES_SESSIONS=3` sessions
  aggregated to 5m via `aggregateVectorBars`), parallel target-sized batched Polygon fetches (22
  sequential SSR round-trips would add seconds), `MAX_SEED_BARS = 7000` (fits 22 index AND
  extended-hours-stock sessions; trims only pathological sub-minute density, whole-oldest-session
  first), `MAX_SESSION_WALKBACK = 35`. Added `targetSessions` param (default 22); the two
  lightweight callers — bars-route reconnect backfill (`src/app/api/market/vector/bars/route.ts`)
  and server technicals (`vector-server-technicals.ts`) — pass `3` explicitly so only the page SSR
  seed pays for the depth, AND so 5m-decimated priors never contaminate fixed-period EMA/RSI/MACD
  windows or the reconnect merge-by-time union.
- **Perf/payload note (verified by construction):** index seed ≈ 2,652 bars ≈ 240 KB JSON / ~30 KB
  gzip; extended-hours stock worst case ≈ 6,528 bars ≈ 590 KB / ~80 KB gzip — bounded by
  `MAX_SEED_BARS`. Decimation keeps the deep seed at ~1/3 of the raw-1m size (raw 22×1m ≈ 800 KB).
  Live SSE payload is untouched (candle/bead ticks only — the seed is a one-time SSR cost).
- **Relationship to held branches:** `origin/fix/vector-multiday-replay` (46 commits behind trunk,
  925 lines / 17 files) is the FULL multi-day feature (wall-history DB persistence, replay-UI depth,
  page wiring) and set the seed to 15. This PR adopts ONLY its self-contained seed-bars decimation
  at the decision's 22-session target; the larger wall-history-persistence half of that branch
  remains separate work (needs live RTH verification), NOT resurrected here.
- **Status:** FIXED. `vector-seed-bars.test.ts` extended (11 cases; decimation, targetSessions=3
  parity, ceiling drops oldest-first, empty result). tsc clean; full suite green.

### N5-1 — Flip/regime single-source: seed-time canonicalized; live-cadence coherence noted (PARTIAL, tested)
- **Severity:** P3 (no live wrong number today — the client flip is already single-sourced; this is
  drift-PREVENTION + a remaining coherence gap).
- **Audit result:** the gamma flip is ALREADY canonical on both sides. Server: every horizon flip
  flows from `getVectorGammaFlip` / `getVectorGammaFlipForHorizon` (`vector-snapshot.ts`) →
  `getGexPositioning` / per-expiry ladder. Client: the chart banner, flip line, and the terminal's
  proximity/magnet/confluence all read the chart's single `liveGammaFlip()` =
  `pickHorizonScopedValue(horizon, horizonFlipRef, gammaFlipRef)` (`vector-dte-horizon.ts:71`,
  `VectorChart.tsx:1647`) and one shared `deriveVectorRegime`. The GEX-ladder API returns rows+spot
  only — no independent flip. (`vector-key-levels.ts` is Fib/HOD/pivots, NOT the gamma flip.)
- **Root cause fixed (seed-time):** `VectorPageShell.tsx` seeded the banner regime, terminal
  proximity, and magnet with THREE separate inline derivations — and the magnet re-ran
  `deriveVectorRegime` a SECOND time just to read its posture. Two derivations from the same flip
  are one refactor (a changed default, a reordered wall) away from silently disagreeing on first
  paint — the literal ">1 source" the decision flagged.
- **Fix:** new pure `deriveVectorSurfaceSeed()` (`src/features/vector/lib/vector-surface-seed.ts`):
  one spot + one flip + one wall set in, regime derived ONCE, its posture threaded into the magnet;
  returns `{ regime, proximity, magnet, wallIntegrity }`. PageShell now seeds all four surfaces from
  this single object. `vector-surface-seed.test.ts` (4 cases) pins the invariant (seed regime ==
  standalone derive; magnet posture == the banner's regime; honest empty seed; populated when
  walls+spot present).
- **Remaining (NOT done here — larger, needs live RTH verification):** the LIVE-cadence coherence —
  chart, GEX ladder, max-pain, and expected-move poll on FOUR independent 15s clocks, so at any
  instant the ladder's king row / max-pain can describe a slightly different moment than the chart.
  The held `origin/fix/vector-surface-sync` branch (590 lines) fixes this properly with an atomic
  per-15s `VectorHorizonSnapshot` store (`use-vector-horizon-snapshot.ts`) every surface consumes.
  That's a real refactor whose acceptance criteria are all live-RTH (identical numbers on all three
  surfaces at one instant; shared `asOf` in lockstep; failure coherence) — it must be finalized +
  validated on the deployed build during RTH, not merged blind off-hours. Also noted: the SSR
  regime seed uses the "all"-horizon flip while the chart/ladder default to the "weekly" horizon,
  so the banner briefly shows the all-horizon regime until the first weekly fetch lands (transient,
  self-correcting; a server-side weekly seed flip would close it but is out of this small scope).
- **Status:** PARTIAL — seed-time single-source shipped + tested; live-cadence snapshot store
  tracked to `fix/vector-surface-sync` (finalize during RTH).
## 2026-07-14 — Largo gauntlet + hardcore (#339) remaining defects — PR-L4de

### P0 — scenario engine (#340) DEPLOYED but never reached: compound decomposer splits the what-if (FIXED, tested)
- **Severity:** P0 — the scenario engine is worthless until routing reaches it.
- **Root cause:** ORDERING. `runLargoQuery` runs `isCompoundQuestion` → `composeCompound`
  (`src/lib/largo-terminal.ts:297`) BEFORE intent routing. The run-on splitter
  (`decompose.ts:splitRunOn`) chopped a scenario what-if into ≥3 comma/"and" fragments. The scenario
  double-gate (`router.ts:scenarioRoute`) needs BOTH the hypothetical trigger ("if") AND a parseable
  shift ("drops 1%") in the SAME string — both live only in fragment 1 — so fragments 2-3 got
  "no deterministic read" and fragment 1 timed out under the 4s per-friend cap. The engine never saw
  the whole question.
- **Evidence (live staging, fired by the coordinator):** "If SPX drops 1% at tomorrow's open, what
  happens to the dealer positioning picture — does the regime flip, and which walls become live?" →
  "Answering 3 parts (0 with live data, 3 unavailable): 1) …timed out; 2) …no deterministic read;
  3) …no deterministic read."
- **Fix:** a coherent-scenario guard in `decompose.ts:splitCompoundQuestion` — when the hypothetical
  trigger appears in the LEADING clause (first ~60 chars) AND the double-gate `isScenarioQuestion`
  (new shared predicate in `scenario-read.ts`, now the single source of truth used by both the router
  and the decomposer) holds, the message routes WHOLE (returns `[q]`), never run-on-split. The
  leading-clause requirement is what keeps a genuine multi-topic run-on with a buried throwaway "if"
  (`…just say so if you can't get data`) still splitting. Once whole, the question runs on the normal
  single-intent path (no 4s compound cap) → the scenario composer, resolving the timeout too.
- **Belt-and-suspenders (L4e-2):** `composeCompound` now falls back to answering the WHOLE question
  through the best single intent whenever <half the decomposed parts returned live data — a general
  guard against mostly-"unavailable" stub walls, not just the scenario shape.
- **After:** `isCompoundQuestion(SCENARIO_Q) === false` and `classifyBieIntent(SCENARIO_Q) →
  scenario`; the buried-"if" run-on still splits ≥3. `decompose.test.ts`, `router.test.ts`.
- **Status:** FIXED (tsc clean, suite green). Deterministic.

### L4d-1 (honesty) — off-topic asks topic-swapped into a market dump (FIXED, tested)
- **Root cause:** the staging BIE-only last-resort `classifyBieStagingFallback` (`router.ts`) had no
  off-topic guard — anything that matched no intent fell through to the terminal `market_context`
  dump.
- **Evidence (gauntlet):** "Write me a poem" → a full SPX-desk + HELIX-tape dump, no scope statement.
- **Fix:** an off-topic detector (`isOffTopicQuestion`) placed AFTER every specific-intent router (so
  an edition pick-why "why was CSX picked", a cortex decision-why, etc. keep their homes even with no
  generic market vocabulary) and BEFORE the generic `market_context`/ticker catch-alls (every one of
  which requires a market subject anyway). A question with NO market/platform subject — no ticker, no
  `$`-symbol, no glossary term, no market/platform vocabulary — routes to a new `off_topic` intent
  whose composer returns an honest scope envelope ("I'm the BlackOut desk intelligence … I can't
  write poems / do general chat"), never a market read.
- **Evidence it doesn't over-trigger:** a battery of terse LEGIT asks ("flip spx", "nh", "gex",
  "$NVDA", "our record", "why was CSX picked tonight?") is never flagged; imperative/chat off-topic
  ("write me a poem", "tell me a joke", injection imperatives) → `off_topic`; "what is …"-style
  off-topic ("what is 2+2") resolves to the honest glossary-miss (also non-dump). `router.test.ts`.
- **Status:** FIXED (tsc clean, suite green).

### L4d-2 (honesty) — off-hours "right now" reads carried no staleness marker (FIXED, tested)
- **Root cause:** the desk / Vector string briefs render a live "right now" read from a CAPTURED
  snapshot but never surfaced its as-of, so an off-hours prior-close capture read as fresh.
- **Fix:** `staleness.ts:stalenessMarker(asOf, now)` — a compact "· as of HH:MM ET[, prior close]"
  marker computed from the data's OWN timestamp, appended to the SPX desk read (`desk.as_of`) and the
  Vector read (`state.asOf`) in `composers.ts`, but ONLY when genuinely stale: off-hours (weekend /
  before 09:30 / at-or-after 16:00 ET → "prior close") or older than a 15-min freshness threshold
  during RTH (→ "delayed"). Fresh RTH data → no marker. Injectable `now` clock → fully deterministic
  test (the task's exact "· as of 20:10 ET, prior close" example is asserted). `staleness.test.ts`.
- **Status:** FIXED (tsc clean, suite green).

### L4e-1 (routing) — "honest record" asks fell to market_context instead of the record (FIXED, tested)
- **Root cause:** COVERAGE. "our record" / "track record" / "how are the plays doing overall" matched
  no intent (the concept branch or the terminal `market_context` swallowed them).
- **Fix:** `NH_RECORD_ASK_RE` (exported from `router.ts`, single source of truth) routes these to
  `nighthawk_edition` (ticker-less), BEFORE the concept branch (a record ask is not a definition), and
  `composeNighthawkEditionRead` dispatches a ticker-less record ask to a NEW
  `readNighthawkOverallRecord` — the honest aggregate win rate across every graded edition, pulled +
  unfilled EXCLUDED from the denominator both directions (same rule as `debrief-aggregate.ts`), with a
  by-conviction split. Distinct from the edition read ("why was X picked" — has a ticker) and the
  session debrief ("how did last night do" — `NH_DEBRIEF_ASK_RE`); neither is stolen.
- **Evidence/after:** the "11.1% (1–8 over 9 scoreable across 2 editions)" aggregate renders with the
  pulled/unfilled exclusion note. `nighthawk-edition-read.test.ts`, `router.test.ts`.
- **Status:** FIXED (tsc clean, suite green).

### L4e-3 (freshness) — "tomorrow's plays" served a stale (4-day-old) edition (FIXED, tested)
- **Root cause:** SELECTION. `nighthawk-edition-read.ts:editionRowFor` preferred the latest PLAYABLE
  edition unconditionally, so when a newer edition existed that the playable-only query skipped, the
  read served the older playbook.
- **Fix:** read BOTH the latest-playable and the latest-of-any-kind and select the newer by
  `edition_for` (`pickLatestEdition`, ties → the plays-carrying playable row). "tomorrow's plays" now
  serves the LATEST published edition (max edition_for). `nighthawk-edition-read.test.ts`.
- **Status:** FIXED (tsc clean, suite green).

### L4e-4 (cross-surface) — a desk/Vector disagreement went unflagged (FIXED, tested)
- **Root cause:** COVERAGE. A cross-check ask ("do they agree?") had no intent; it fell to
  `vector_read` for SPX and answered ONE surface silently.
- **Fix:** a `cross_check` intent (`isCrossCheckQuestion`: a cross-check/reconcile verb OR an
  agreement cue + BOTH surfaces named; placed before `VECTOR_RE` so "vector" isn't stolen) →
  `cross-check-read.ts:composeCrossCheck`, which reads the SAME metric (max pain / gamma flip / regime
  posture) from the SPX desk AND the Vector engine and FLAGS a MATERIAL divergence (>0.3% relative)
  explicitly in the headline, rather than choosing a side. Honest partial state when a surface is
  unavailable (never one side dressed as both).
- **Evidence (gauntlet):** max pain 7,525 (desk) vs 7,400 (Vector) now renders "The SPX desk and
  Vector DISAGREE on max pain … (Δ 125 pts, 1.7%)". `cross-check-read.test.ts`.
- **Status:** FIXED (tsc clean, suite green).
