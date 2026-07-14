# SPX Slayer — validation checklist 2026-07-14

## Pre-open (13:00–13:30)
- [ ] Playbook monitor renders: PB states IDLE with window reasons (no NaN/blank)
- [ ] Largo LIVE COMMENTARY panel fills ≤20s (held in #3/#4 — regression check)
- [ ] Kanban shows EOD-flat state from 07-13 (open 7480P should have EOD-closed or carried per rules)

## During RTH (13:30+)
- [ ] Plays flow: ≥1 WATCH by 14:30; PB-01/02 (VWAP) arm when window opens (9:35 ET+); STR SCAN populates
- [ ] Trade lifecycle: OPEN → managed (HOLD/TRIM narration) → CLOSED with outcome; no {{}} leaks in Watch/Changed
- [ ] Flip/regime coherence with Vector (same γ flip value ±0.1%) — esp. after N4-1 flip fix
- [ ] Commentary cross-checks (CROSSCHK section) cite consistent walls with Vector weekly
- [ ] Win-rate/outcome tracking: log day-1 outcomes for tuning (step 2 of 100%-win-rate goal — not started)
