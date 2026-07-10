# Playbook Evidence Base — mined from prod outcomes (2026-07-10)

Source: Railway prod Postgres (`spx_play_outcomes` n=19, 2026-06-29 → 2026-07-06;
`market_regime` n=776; `spx_engine_snapshots` n=306). Small sample — directional
evidence, not statistical proof. Re-run after each RTH week.

## Headline numbers

| Metric | Value |
|--------|-------|
| Overall | 6W / 13L (31.6% win), avg −0.91 pts |
| `cold_buy` | 1W / 5L (17%) |
| `watch_promote` | 5W / 8L (38%) |
| STOP exits | 4, avg **−8.25** pts |
| THESIS exits | 15, avg +1.05 pts |
| **All 19 plays were LONG** | zero shorts ever fired |

## What the data says (and what we changed)

1. **Grade/score don't predict outcomes.** A+ won 1/4, A won 1/6, B won 4/9.
   Two 100-score A+ plays lost. → Confirms design goal: BUY must key on a *named
   setup trigger*, not the confluence scalar. (Phase 3 `PLAYBOOK_LIVE_GATE`.)
2. **Every entry fought the gamma pin.** 18/19 joined `market_regime` rows show
   `gex_regime=mean_revert` (dealer-dampened tape) at entry, all longs, mostly
   breakout-style theses — the engine repeatedly bought momentum inside a pin.
   → Added **PB-04 Gamma Pin Fade** (trade *with* the pin: fade wall touches
   toward the interior, 11:30–15:00 ET) to the registry + matcher.
3. **Only the 14:00+ ET band was net-positive** (avg +2.05 pts on 4 plays;
   every other hour negative; 09:xx single play −5.75).
   → Added **PB-08 Power Hour Momentum** (15:00–15:55 ET, dominant-flow +
   session-extreme break). Also validates PB-01's 09:45 start and the
   opening-range BUY block.
4. **Losses are stop-shaped, wins are thesis-shaped.** Stops sat 3.1–5.1 pts
   below entry with 12–14 pt targets (~3:1 R:R on paper), but the 4 STOP exits
   averaged −8.25 — worse than stop distance (gap/slippage through stop).
   MAE of winners ≤0.9 pts: good entries never went against us. A future
   "cut at −2 if no MFE within N minutes" rule is worth testing (not encoded).
5. **Directional monoculture.** 19/19 long. PB-02 (reject short) and the short
   sides of PB-01/03/04/08 give the engine its first systematic short exposure —
   watch whether shadow shorts would have paid on red tape.
6. **13:00–14:00 ET was the worst band** (5 plays, avg −2.05): lunch chop inside
   the pin. PB-04 covers this window with a fade (not a breakout) shape;
   PB-01's window already ends at 14:00.

## Current calibrations derived from this data

| Playbook | Evidence hook |
|----------|---------------|
| PB-01 VWAP Reclaim | 09:45–14:00 window skips the worst late-lunch band for breakout-style longs |
| PB-02 VWAP Reject | first systematic short; weak/distribution regime only |
| PB-03 ORB | true OR from bars; halt-degraded suppression |
| PB-04 Gamma Pin Fade | **new** — 18/19 entries were inside a pin; fade it instead |
| PB-08 Power Hour | **new** — only net-positive band in track record |

## Data gaps to close (before promoting anything to live gate)

- No `playbook_pb_*` shadow rows in prod yet — staging RTH is primary shadow capture.
- `spx_confluence_shadow_observations` (567k rows) has rich factor shadows but
  no outcome join key — join via `session_date` + `observed_at`→`opened_at`
  proximity when sample grows.
- 19 outcomes is too small to rank playbooks; MIN_EVIDENCE=10 *per playbook*
  before any live-gate default flips.

## Re-run

```sql
-- outcomes joined to regime at entry
SELECT o.outcome, o.pnl_pts, r.composite, r.gex_regime
FROM spx_play_outcomes o
LEFT JOIN LATERAL (
  SELECT * FROM market_regime r
  WHERE r.captured_at BETWEEN o.opened_at - interval '15 min' AND o.opened_at + interval '2 min'
  ORDER BY r.captured_at DESC LIMIT 1
) r ON true;
```
