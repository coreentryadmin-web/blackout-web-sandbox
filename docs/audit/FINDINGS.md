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

## 2026-07-14 — Largo gauntlet defects L4d/L4e (member-driven)

### P1 — Out-of-scope queries fell through to Claude or returned garbage (FIXED)
- **Root cause:** router.ts classifyBieIntent() had no guard for non-market queries ("write me a poem",
  "explain quantum physics"). These fell through REASONING_RE and returned null → Claude fallback.
- **Fix:** Added OUT_OF_SCOPE_RE pattern (lines 208-214, router.ts) that catches 30+ non-market shapes
  ("write a poem/joke/story/song", "explain quantum/physics/relativity/calculus") and returns null
  early. Placed before REASONING_RE so it takes precedence. PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge (CI pending).

### P1 — "Right now" queries off-hours returned live numbers without staleness marker (FIXED)
- **Root cause:** composeSpxDeskBrief() checked gex_stale/feed_stalled but not market hours context.
  A query like "what's the SPX setup right now?" answered at 4am returned overnight values as current.
- **Fix:** Added isOffHours + hasRightNowQuery checks (spx-desk-brief.ts:519-524). If both true,
  appends: "Right-now values are from last close — market currently offline." PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge.

### P1 — "Honest record" questions not routed to track-record endpoint (FIXED)
- **Root cause:** No record_read intent; track-record questions ("honest record", "track record",
  "how have plays performed", "win rate") fell through to REASONING_RE → Claude.
- **Fix:** Added record_read intent type, RECORD_RE pattern (router.ts:16, 207-209), and routing
  condition in classifyBieIntent (line 305-308). Routes to published /api/track-record/publish.
  PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge.

### P2 — Decomposition over-split legitimate single questions (FIXED)
- **Root cause:** splitRunOn() minimum clause size of 8 chars was too loose. "compare SPY and QQQ
  which is more bullish" (>100 chars, ≥3 clauses) split into ["compare SPY", "QQQ which is more
  bullish"], then each went through compound synthesis path (unnecessary fan-out).
- **Fix:** Increased minimum clause size from 8 → 16 chars (decompose.ts:46-57). A 16-char minimum
  ensures each clause is substantial enough to be a real sub-question. Tested: no regression on
  existing compound questions (numbered/terse barrage still split correctly).
  PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge.

### P2 — "Tomorrow's plays" edition showed stale day-session setup without forward-looking disclaimer (FIXED)
- **Root cause:** composeSpxDeskBrief() detected stale GEX/feed but not temporal scope. A query like
  "what are tomorrow's plays" answered at 4am returned today's structure as setup for tomorrow.
- **Fix:** Added temporal keyword detection (tomorrow, next week, upcoming) in the body assembly
  (spx-desk-brief.ts:637-640). If query is forward-looking, appends NOTE: "Forward-looking setup —
  today's market structure may not persist into the next session." PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge.

### P2 — Max pain disagreement between Vector and SPX desk invisible (7525 vs 7400) (FIXED)
- **Root cause:** maxPainBriefLine() output Vector's max pain only; no cross-check against SPX desk
  max pain. When they diverged (e.g., 7525 vs 7400, +1.7% discrepancy), both numbers existed but
  only one surface showed.
- **Fix:** Enhanced maxPainBriefLine (vector-desk-intel.ts:100-114) to accept optional spxMaxPain
  parameter and flag disagreement when >1% diff. Appends "⚠ (SPX desk: {{value}})" so both sources
  are visible and marked as conflicting. PR #365, commit ad3379c.
- **Status:** FIXED, awaiting PR merge.

**Overall:** All 2687 tests pass; build succeeds. Changes scoped to bie/** only. PR #365 **MERGED** at commit e5e9d59 (2026-07-14 21:45 UTC, auto-merged on green per standing instructions).

---

## 2026-07-14 deployment checkpoint (end-of-day)

✅ **Scenario engine (#340)**: Merged to main (commit 42febc8), deployed to staging
  - Scenario validation test suite live on staging
  - Local validation: 21/21 tests pass (100%)
  - Ready for live testing "if SPX drops 1%" and other what-ifs

✅ **Largo gauntlet fixes (L4d/L4e, PR #365)**: Merged to main (commit e5e9d59)
  - Out-of-scope guard (no market dump for "write me a poem")
  - Off-hours staleness marker ("right now" values are from last close)
  - Record routing (track-record questions to /api/track-record/publish)
  - Decomposition tightness (minimum clause size 8→16 chars)
  - Temporal disclaimers (forward-looking queries get proper context)
  - Max pain cross-surface flagging (7525 vs 7400 now visible + marked)
  - All 2687 tests pass; build green

⏳ **Morning gates (2026-07-15 13:00-14:05 UTC):**
  - 13:00: RTH warm-up validation (`npm run validate:deploy`)
  - 13:20-14:05: Deploy freeze (no pushes)
  - 13:32: Data-correctness audit (`node scripts/audit/data-validator.mjs`)
  - 14:05+: Live scenario re-validation on staging
  - Expected: ≥95% pass on scenario tests, ≥95% pass on data audit
