# SPX Playbook — Implementation Roadmap

Tracks ChatGPT + Claude external-review recommendations against staging (`blackout-web-sandbox`).

**Last updated:** 2026-07-10

---

## P0 — Evidence foundation

| Item | Status | Notes |
|------|--------|-------|
| `PLAYBOOK_LIVE_ALLOWLIST` gate A17 | ✅ Shipped (#62) | Staging default PB-01–04 |
| Persistent state machine + `instance_id` | ✅ Shipped | `playbook-state.ts`, `spx_playbook_instances` |
| Per-instance telemetry + feature snapshot | ✅ Shipped | `feature_snapshot`, `instance_transitions` on shadow rows |
| Short-side pipeline audit counters | ✅ Shipped | `playbook-pipeline-audit.ts`, surfaced on `playbook_shadow` panel |
| Unknown regime fail-closed (live BUY) | ✅ Shipped | `isUnknownPlaybookRegime` in gate A17 |
| PB-11 rolling 30m range | ✅ Shipped (#61) | |
| PB-01 strict 15m VWAP pre | ✅ Shipped (#61) | |

## P1 — Cost-adjusted evidence

| Item | Status | Notes |
|------|--------|-------|
| Data-quality degraded mode (event/breakout PBs) | ✅ Shipped | `playbook-data-quality.ts` blocks PB-03,05,09,13,14 on live gate |
| PB-02 flow materiality threshold | ✅ Shipped | `PLAYBOOK_FLOW_MATERIALITY_MIN` default 100k |
| Option execution simulator (spread/slippage) | 🟡 Stub | `playbook-option-sim.ts` — wire to outcomes next |
| Gate category split (operational/risk/validity/quality) | ⏳ Planned | Documented in FULL-SPEC §6; code still flat `blocks[]` |

## P2 — Production discipline

| Item | Status | Notes |
|------|--------|-------|
| Playbook-specific exit management | ⏳ Planned | Legacy engine exits still own open plays |
| Session risk governor | 🟡 Partial | `playSessionMaxEntries` / `playSessionMaxLosses` exist |
| Evidence-aware primary ranking | ⏳ Planned | Static `PRIMARY_PRIORITY` tie-break only |

## P3 — Catalog hygiene

| Item | Status | Notes |
|------|--------|-------|
| Typed registry → doc matrices | ⏳ Planned | Prevent E2E/registry drift |
| PB-14 break memory | ⏳ Blocked | Needs durable state before live allowlist |
| Expand beyond 14 playbooks | ❌ Frozen | Per decision log |

---

## Validation

```bash
npm test -- --test-name-pattern 'playbook'
npx tsc --noEmit
npm run validate:staging-playbook   # after ECS deploy
```

---

## Promotion tiers (unchanged)

See `PLAYBOOK-EXTERNAL-REVIEW-2026-07-10.md` §1 — research ≥30 triggers / staging ≥50–75 prospective trades before limited-live prod.
