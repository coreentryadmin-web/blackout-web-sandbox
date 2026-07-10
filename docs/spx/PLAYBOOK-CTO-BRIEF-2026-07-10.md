# SPX Playbook — CTO Brief (2026-07-10 RTH)

> **Full architecture narrative:** see `PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md` (old model, evidence, 14 rules, implementation, trade logic).

## Executive summary

**Named playbooks are live on staging** in shadow + **playbook lab** mode: all **14 setups (PB-01…PB-14)** evaluate every play poll. **Playbook-gated BUY is always on staging** — hardwired via `isStagingDeploy()` (staging URL at Docker build), not an env default. BUY requires a fired primary playbook + aligned direction (starter sizing). **Prod** uses legacy confluence BUY until `PLAYBOOK_LIVE_GATE=1` is set explicitly.

**Jul 10, 2026 session:** bullish tape, **mean-revert gamma**. Morning **PB-01 VWAP Reclaim** armed; afternoon **PB-04 Gamma Pin Fade** at resistance (~7575). Engine stayed flat on prod-style gates; playbooks and BIE agreed — informational setups, no forced bad entry inside the pin.

## What shipped (staging branch)

| Deliverable | Why |
|-------------|-----|
| `playbook-registry.ts` PB-01…14 | Named setup catalog |
| `playbook-shadow-matcher.ts` | All 14 matchers + primary priority |
| `playbook-regime-router.ts` | Regime eligibility matrix |
| `spx_playbook_shadow_observations` | Evidence — shadow transitions |
| Playbook + Play terminal tabs | PB catalog vs trade runway (HOLD/TRIM/SELL) |
| Live open chips `7400C @ 5.2` | Polygon chain quotes on kanban |
| `npm run validate:staging-playbook` | Automated shadow panel proof |
| `npm run validate:staging-desk-live` | 14 verdicts + desk/matrix coherence |

## Architecture (current)

```
Desk + Technicals → matchPlaybooksShadow() → playbook_shadow (API + UI)
                  ↘ evaluateSpxPlay()      → BUY/WATCH/SCAN (legacy + optional live gate)
```

**Phase 2:** ARM UI, kanban tags, Playbook terminal — done.  
**Phase 3:** `PLAYBOOK_LIVE_GATE` / staging lab — shipped on staging; prod default off.  
**Phase 5+:** State machine, per-PB checklist UI, watch keys — next.

## Documentation map

| File | Contents |
|------|----------|
| `PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md` | **Start here** — migration story, model, ideas, code paths, trade logic |
| `PLAYBOOK-FULL-SPEC-v2.md` | Per-PB rules, gates A1–A17, priority, sizing target |
| `PLAYBOOK-EVIDENCE-BASE.md` | Prod outcome mining (n=19) — why PB-04/08 exist |
| `PLAYBOOK-E2E-FOUNDATION.md` | Mermaid E2E + phased rollout |

## Gaps still open (priority)

1. **Outcome correlation** — join `spx_playbook_shadow_observations` ↔ `spx_play_outcomes` for win-rate by `playbook_id`.
2. **Prod live gate** — progressive tiers per `PLAYBOOK-EXTERNAL-REVIEW-2026-07-10.md`; not n=10.
3. **State machine** — durable IDLE→ARMED→TRIGGERED→OPEN (today: stateless recompute per tick).
4. **Per-PB checklist UI** — replace global confluence soup when primary is ARMED.

## Recommendation (CEO/CTO)

- **This week:** Let shadow telemetry accumulate on staging RTH; compare shadow primary vs legacy BUY/WATCH.
- **Before prod gate:** Research → staging → limited-live tiers; initial allowlist PB-01/02/03/04/14.
- **Member messaging:** Playbook tab shows `mode: shadow` on prod; staging lab is internal validation.
