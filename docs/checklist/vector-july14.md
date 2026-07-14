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
