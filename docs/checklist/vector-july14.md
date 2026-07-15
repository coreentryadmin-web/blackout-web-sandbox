# Vector — validation checklist 2026-07-14 (all times UTC; open 13:30, checkpoint 14:05)

## Pre-open (13:00–13:30)
- [ ] Review + merge overnight branches `fix/vector-multiday-replay`, `fix/vector-surface-sync` (tsc, tests, build, VERIFICATION.md) — merge ONLY if clean; deploy must settle ≥10 min before 13:30
- [ ] Trunk deployed & settled (no rolling replicas — probe toggle testids twice, 5 min apart)
- [ ] Recorder cron log: tickers count includes dynamic names (UBER, SNAP seeded 07-13); spx0dteRailLen fields present

## At/after open (13:30–14:05) — the decisive checks
- [ ] **WALL BIRTHS MID-SESSION** (THE test): by ~14:00, SPX/TSLA weekly rails must show trails starting at candles AFTER 13:30 — not all tracing to the open (vol-adjusted engine a63f162, clean data day 1)
- [ ] **TSLA 0DTE honest gap**: Tuesday — TSLA has no 0DTE chain → empty/near-empty 0DTE rail, NO full-width mislabeled trails (bb4ddeb)
- [ ] **Dynamic universe**: UBER + SNAP recorded from 13:30 with NO viewer (rail exists on first view at 14:05)
- [ ] **Flip correctness after N4-1 fix**: SPX banner flip ≈ terminal ≈ dashboard ≈ Largo (~same value, spot-relative sane); flip line visible on-chart; banner regime wording matches ladder sign structure
- [ ] Bead lifecycle: births at current candle w/ bright bead, deaths dim + stop, rebirth bead on re-entry; top-3 sparsity (Skylit NODES=3 look)
- [ ] DTE grind (3 horizons × SPX,TSLA,NVDA): banner==API kings both sides, terminal re-scopes, no stale carryover, race check
- [ ] Zoom persistence re-check (wheel 5/5)
- [ ] If multiday merged: 15-session seed renders, replay scrubs across days, no cross-session wall bridging
- [ ] If sync merged: identical numbers chart/ladder/terminal + shared asOf stamp visible

## Known-open to re-verify status
- [ ] N4-2: ladder body empty ~5s before fill (add skeleton?) — P2
- [ ] Ghost backfill for narrowed horizons (first-day gap) — not built yet
- [ ] AAPL one-sided horizon walls boundary flapping — watch

## Added post-sweep-#5 (2026-07-13 late)
- [ ] **N5-1 (P1) TSLA flip incoherence**: Vector narrowed flip ~420-425 SHORT-γ vs Largo 393.48 LONG-γ (was agreeing ~394.68 pre-2c6c689). Investigate at open with live ladder signs: is the OI-only per-expiry crossing (420 shelf, +7% from spot) the artifact, or the blended 393.5? Decide ONE flip source for all surfaces (ties into surface-sync merge); consider tightening plausibility band or nearest-spot tie-breaking by ladder-sign coherence.
- [ ] N5-2 (P2): Largo NEWS line leaks raw HTML entity (&#34;) — decode entities in the news composer.
- [ ] N5-3 (P2): Largo offline "SESSION WRAPPED" headline clips at 1920/1440 — CSS fix.
- [ ] BIE Largo bias card + triggers + feed: could not be exercised post-close — MUST verify live at open (14:05).

## Added post-replay-questions (2026-07-13 night) — replay coverage gaps
- [x] ~~Replay button missing on desk embed after-hours (P1)~~ **RESOLVED same night — NOT an app bug.**
  Two probe bugs stacked: (1) a full-screen modal (`fixed inset-0 z-[100]`) intercepted the click →
  Playwright TimeoutError read as "button not found"; (2) the scrub set `el.value=` directly, which
  React's value tracker dedupes → cursor stuck at frame 1 (screenshot showed `9:30:00 AM · 1/1722`).
  Fixed probe (modal dismissal + native value setter): embed replay FULLY VERIFIED —
  1,721 frames, beads 0→5,835→13,933 at 5%/50%/95%, rail visibly formed in late-frame screenshot.
- [x] **Replay bead-formation × MULTIPLE TIMEFRAMES — TESTED 07-13 night** (`scratchpad/replay-multitf-test.mjs`,
  standalone /vector SPX): 3m PASS (0→5,308→12,910 beads), 5m PASS (0→5,079→9,654), 15m PASS
  (0→3,659→3,727), all 3/3 distinct frames. Note: TF switching is DISABLED during replay by design
  (`VectorChart.tsx:2730` `timeframeDisabled={replayMode}`) so the mid-replay-switch seam doesn't exist.
- [ ] **1H replay bead-count anomaly (P3, watch)**: at 60m the bead-pixel count DROPPED mid→late
  (5,245→2,982) while frames stayed distinct. Could be legit wall fade/autoscale compression at
  coarse aggregation, could be a rail-scaling bug at 1H. Eyeball screenshots at the gate; if real,
  file as fix branch.
- [ ] Fold a `REPLAY_TFS` sweep (3m/5m/15m × replay 5/50/95) into `vector-hardcore-e2e.mjs` so the
  combination stays covered permanently ("KEEP GROWING IT").
- [ ] Replay flip-line historicity sanity: during embed replay at ~3:15 PM the on-chart flip label read
  7528 while the (live) banner read 7,519.56 — expected if the chart shows the replay-time flip and the
  banner stays live, but confirm that's the intended split rather than a desync.
