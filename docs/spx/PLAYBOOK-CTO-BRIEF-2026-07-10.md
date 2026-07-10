# SPX Playbook — CTO Brief (2026-07-10 RTH)

## Executive summary

**Named playbooks are live in shadow mode** on staging: five setups (PB-01, 02, 03, 04, 08) evaluate every play poll, surface in the Largo column (BIE), Playbook terminal tab, and kanban ARM hints — but **do not gate BUY**. The legacy confluence engine remains authoritative (today: SCANNING ~score 34, NO-EDGE BIE brief).

**Today's session (Jul 10, 2026)** was a bullish tape with **mean-revert gamma** — the environment PB-04 was added to exploit. Morning saw **PB-01 VWAP Reclaim** fire; afternoon rotated to **PB-04 Gamma Pin Fade** at resistance (~7575) with spot ~7571. Engine correctly stayed flat (no A-grade confluence). Playbooks and BIE agreed: informational setups, no forced entry.

## What shipped today (this branch)

| Deliverable | Why |
|-------------|-----|
| `spx_playbook_shadow_observations` table | Phase 1 evidence — durable log of primary/fired transitions |
| `maybeLogPlaybookShadowMatch()` | Throttled telemetry on every play read (state-transition cursor) |
| BIE commentary `PLAYBOOK` line | Largo brief names active shadow setup (e.g. PB-04 Gamma Pin Fade) |
| `npm run validate:staging-playbook` | Automated proof shadow panel on staging |

## Architecture (current)

```
Desk + Technicals → matchPlaybooksShadow() → playbook_shadow (API + UI)
                  ↘ evaluateSpxPlay()      → BUY/WATCH/SCAN (unchanged)
```

**Phase 2 (done):** ARM UI, kanban tags, Playbook terminal tab.  
**Phase 1 gap (closed today):** telemetry was documented but never wired — now fixed.  
**Phase 3 (not started):** `PLAYBOOK_LIVE_GATE=1` — BUY requires `primary_playbook_id` + engine agreement.

## Today's playbook timeline (observed live)

| Window (ET) | Primary | Engine | Read |
|-------------|---------|--------|------|
| Open / reclaim | PB-01 VWAP Reclaim | SCANNING | Bullish regime; reclaim fired; score too low for BUY |
| Midday pin | PB-04 Gamma Pin Fade | SCANNING | mean_revert γ; fade at wall; matches evidence-base thesis |
| Power hour | PB-08 (window only) | — | Not yet 15:00 ET at last probe |

## Gaps still open (priority)

1. **Outcome correlation** — after today’s telemetry lands, join `spx_playbook_shadow_observations` ↔ `spx_play_outcomes` for win-rate by `playbook_id`.
2. **Phase 3 live gate** — env `PLAYBOOK_LIVE_GATE=1` + `evaluatePlayGates` hook (only after n≥10 shadow days per playbook).
3. **Remaining catalog** — PB-05–07, PB-09–12 not registered (design doc not in repo).
4. **Staging RTH noise** — `validate:staging-rth` still flags play warm latency + data-correctness cron (infra, not playbook).

## Recommendation (CEO/CTO)

- **This week:** Let shadow telemetry accumulate; do **not** flip live gate until Jul 10+ week shows PB-01/04 hit rate vs flat engine.
- **Next merge:** Phase 3 behind flag on staging only; A/B vs shadow-only for one RTH week.
- **Member messaging:** Playbook tab already says “informational only” — keep until live gate is proven.
