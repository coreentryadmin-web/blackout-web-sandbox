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

## 2026-07-14 — Vector data refresh rate optimization (member-reported, real-time responsiveness)

### P2 — Slow Vector data updates (spot every 3s, GEX ladder every 60s, flow/history every 30-60s) (FIXED, pending deploy verify)
- **Root cause:** SWR refresh intervals set conservatively for minimal server load; member reported Vector felt "static" and laggy, not responsive to market moves. Multiple Vector surfaces refreshing at different rates (3s/30s/60s).
- **Requirement:** All Vector data (GEX, VEX, DEX, charm) should update with uniform 15-second cadence across all stocks (universe + non-universe), timeframes, and DTEs. Spot prices 1 second from playbook.
- **Fix:** Standardized all Vector refresh intervals to 15 seconds default:
  - **Commit a3aced5:**
    - VectorDeskTerminal.tsx:61: SPX playbook refresh `3_000` → `1_000` (every 1s)
    - VectorGexLadder.tsx:105: GEX matrix refresh `60_000` → `15_000` (every 15s)
  - **Commit 78cdf74:**
    - VectorChart.tsx:1514: Flow data fetch `30_000` → `15_000` (every 15s)
    - VectorChart.tsx:1982: Wall history fetch `60_000` → `15_000` (every 15s)
    - VectorScanner.tsx:45: Universe scanner refresh `30_000` → `15_000` (every 15s)
- **Impact:** All Vector surfaces now refresh on same 15s cadence; spot prices update every 1s from playbook/SSE stream; gamma Greeks (GEX/VEX/DEX/charm) refresh 4x per minute instead of every 1-2 minutes.
- **Evidence expected:** Post-deploy, GEX/flow/history all update 4 times per minute; consistent refresh across all tickers and horizons; member experience no longer "static".
- **Status:** Fixed (commit 78cdf74), staged on `claude/three-repos-review-36t217`, awaiting staging deployment verification. Full UI validation requires Cognito authentication (https://staging.blackouttrades.com/vector)

## 2026-07-14 — Vector GEX ladder asymmetry (discovered during wall-birth validation)

### P1 — Scoped DTE ladder strikes mismatched chart walls (FIXED)
- **Root cause:** The GEX ladder panel (gex-ladder API endpoint) computed the ladder for narrowed horizons (0DTE/WEEKLY/MONTHLY) using OI-only GEX values, while the chart walls used volumeAdjusted GEX (OI + today's per-strike traded volume). This created an asymmetry: ladder UI showed different strike sets and values than the chart's beads, breaking cross-surface truth.
  - `src/features/vector/lib/vector-dte-walls-server.ts:95` — `getHorizonStrikeTotals()` called `gexLadderAtSpot(filtered, spot, today)` without `volumeAdjusted` flag (defaulted to false).
  - Chart walls used `{ volumeAdjusted: true }` (vector-dte-walls-core.ts:58) for mid-day births.
- **Evidence:** Test failures showed NVDA scoped ladder 44 UI strikes vs 89 API ladder strikes (49% data), banner support rendering NaN, cross-surface disagreement on king strikes (banner 210/NaN vs ladder 215/180). All consistent with unmatched GEX computation.
- **Fix:** Pass `{ volumeAdjusted: true }` to `gexLadderAtSpot()` in `getHorizonStrikeTotals()` (line 95). Since the ladder is fetched every 15s during live session, it must show dynamic walls (OI + dayVolume) that birth mid-day, not static OI-only structures.
  - **Commit 107c450:** Single-line fix + deep-dive comment in PR write-up.
- **Rationale:** The ladder is displayed live alongside the chart and polls every 15s. It should reflect the same volumeAdjusted positioning the chart uses for wall/bead rendering — consistency and honest mid-day births. Reconstruction (historical playback) still uses OI-only (no options passed).
- **Status:** Fixed (commit 107c450). Pending staging E2E re-validation (ladder strike count, banner/king alignment, cross-surface agreement).

## 2026-07-14 — Vector wall death visibility (user-observed)

### P2 — Dead walls not visually distinguished from live walls (FIXED)
- **Observation:** Old walls that dropped below the dominant set (top-3 by strength) were still visible on the chart at the same brightness as active walls, making it unclear which walls were live vs stale/dead.
- **Root cause:** Inactive walls (marked `active: false` when `lastSeen < latest` bucket) were dimmed to only 40% opacity (`STALE_TRAIL_FADE = 0.4`). At 40%, they're still faintly prominent and could read as "still forming" rather than "departed".
- **Code flow (verified correct):**
  - `trailsByStrike()`: Only records points for strikes in the DOMINANT set (top-3 per bucket by |pct| strength)
  - Strikes that drop below top-3 don't get a point in that bucket → `lastSeen` stops
  - `strikeTrailLifecycle()`: Sets `active = (lastSeen === latest)`. A wall is inactive if it's not in the latest bucket.
  - `VectorChart.tsx:740`: Applies `staleFade` multiplier to alpha (40% for inactive)
- **Fix:** Increased wall fade for inactive trails from 40% to 15% opacity (commit 70df3ea). Dead walls now render at the same ghost-opacity as modeled/reconstructed beads, making the "alive vs dead" distinction unmistakable. Visual hierarchy: solid beads (100%) > modeled beads (15%) ≈ dead walls (15%) > background.
- **Status:** Fixed (commit 70df3ea). Visual distinction should now be clear on staging — dead walls fade to a faint historical artifact level instead of remaining visually prominent.

## 2026-07-15 — Night Hawk publish gates too strict off-hours/staging

### P1 — Staging/off-hours Night Hawk editions published zero plays after G-N3 gate merged (FIXED, CI green, deployable)
- **Root cause:** PR-N3 (commit 9c9c122) added publish-gate G-N3 (stale-quote basis check). Price from Polygon fallback to hourly bars (no daily bar) yields `price_session=null`. The gate failed-closed: null=unknown=indistinguishable from stale → BLOCK. All plays blocked on staging (off-hours, no daily bars). Real issue: the gate couldn't distinguish "no daily bar" (legitimate, current data) from "stale quote" (wrong trading day).
- **Fix:** G-N3 now only blocks when `price_session` is KNOWN but STALE (wrong trading day). Null passes — data-gap ≠ staleness proof. `src/features/nighthawk/lib/publish-gates.ts:200,207`. Commit 53e1f67. Test updated (was fail-closed on null; now passes "hourly fallback is valid off-hours").
- **Verification:** (1) All 3487 unit tests pass, including deterministic-edition.test.ts (10/10 green). (2) TypeScript clean (`npx tsc --noEmit`). (3) Test updated: "G-N3 lenient: an UNDATEABLE quote (price_session null) passes — hourly fallback is valid off-hours" asserts `verdict="PUBLISH"`.
- **Blast radius:** Fix is isolated to the G-N3 gate logic in publish-gates.ts; no other code paths reference stale-quote checks. Deterministic edition builder, candidate extraction, and scoring all untouched.
- **Status:** Fixed (commit 53e1f67), deployable; Night Hawk on staging should now publish with plays. Trigger with `?force=1` post-deploy and verify 5 plays generate for tomorrow.

## 2026-07-15 — 0DTE desk bundle cache stampede (architecture audit)

### P3 — No single-flight coalescing on `fetchPolygonOdteDeskBundle` (FIXED)
- **Severity:** P3 (minor — wastes API quota, not data correctness)
- **Root cause:** `fetchPolygonOdteDeskBundle` (`polygon-options-gex.ts:177`) uses a plain `cachedOdteBundle` variable with no inflight guard. During a cache miss (every 5s at the new TTL), N concurrent requests each independently call `loadOdteContracts` → `aggregateGexRows`, producing N redundant Polygon API calls. The main heatmap path (`heatmapInflight` Map at line 1120) already prevents this correctly — the 0DTE path was never given the same treatment.
- **Evidence:** Code inspection — no inflight promise variable existed; the heatmap path has `heatmapInflight = new Map<string, Promise<...>>()` with `.finally(() => delete)` cleanup, but the 0DTE path had no equivalent. Under load (deploy cold start, 5s cache expiry with multiple SSE streams polling), all concurrent callers would independently fetch the same Polygon chain snapshot.
- **Fix:** Added `odteBundleInflight` promise variable (single key — always SPX). When a build is in progress, concurrent callers share the in-flight promise. The promise is cleared in `.finally()` so a thrown build can't wedge the slot. Cache checks (in-memory + Redis) remain outside the guard since they're fast reads. `polygon-options-gex.ts:92,225-247`.
- **Blast radius:** Single caller at line 2932 (`aggregateGexRows` in the SPX desk route). Return type unchanged (`Promise<{ rows, maxPain }>`). The positioning bundle (`fetchPolygonPositioningBundle` at line 3063) has the same pattern but is keyed per-ticker, so stampede risk is distributed — not fixed here, lower priority.
- **Status:** Fixed (this PR).
