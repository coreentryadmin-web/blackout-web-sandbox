# Work Ledger — blackout-web-sandbox

**Staging:** https://staging.blackouttrades.com  
**Primary branch:** `blackout-web-sandbox`  
**Last updated:** 2026-07-11 (Saturday, market closed)

---

## Current assignment

**P0 — F4 RTH proof** (foundation gate). No new feature work until F4 is GREEN on a weekday RTH session.

**Scheduled:** Monday (first weekday) — see **`docs/ops/STAGING-F4-MONDAY.md`** for autonomous agent checklist + one-line prompt.

---

## Implementation plan (F4)

1. Monday weekday, ET ≥ 09:00 → **`docs/ops/STAGING-F4-MONDAY.md`** + `npm run validate:staging-rth`
2. After 09:35 ET → confirm `spx-evaluate` cron + options-socket `authenticated` (ECS logs / socket-health)
3. Cognito admin via AWS (no user): `GET /api/admin/playbook/fsm-today`, `GET /api/admin/playbook/promotion-report`
4. On failure → reproduce → focused fix PR → auto-merge → re-validate until GREEN
5. Seventh-pass Claude validation prompt after F4 GREEN

---

## Track-record counterfactual (2026-07-11 — settled)

Ran `npm run analyze:track-record-staging` against live staging (25 closed plays, 2026-06-29 → 2026-07-10).

| Question | Answer |
|----------|--------|
| Could all historical plays be winners? | **No** |
| Stored ledger | 12W / 13L / 0BE (48% WR) |
| Regraded (current logic) | 12W / 12L / 1BE (1 scratch fix: id=9) |
| Losses where MFE ≥ target | **0 / 12** |
| Playbook OOS sample | **0** instance-linked rows — need new RTH data |

**Implication:** Stop tuning for 100% winners on n=25. Post-F4 goal = accumulate **instance-linked** closes and re-run promotion report when n ≥ ~50.

Artifact: `audit-output/track-record-counterfactual.json` (regenerate after RTH sessions).

---

## Session log (2026-07-11)

### Completed PRs (merged to `blackout-web-sandbox`)

| PR | Branch | Summary |
|----|--------|---------|
| #100 | `cursor/playbook-fifth-pass-fixes-261c` | F2 full data-quality + Q4 idle-desync assert |
| #101 | `claude/spx-deep-system-sweep` | Deep sweep doc |
| #102 | `cursor/hod-break-fix-261c` | P0 hod_break/lod_break |
| #104 | `cursor/deep-sweep-fixes-261c` | BIE, persistence, gates, desk batch |
| #105 | `cursor/deep-sweep-deferred-261c` | Intel validation, rounding, daily cap, Largo playbook, Q4 DB re-read |
| #106 | `cursor/sixth-pass-q4-reconcile-261c` | Sixth-pass docs + Q4 reconcile |
| #107 | `cursor/sixth-pass-info-entry-261c` | FINDINGS INFO entry |
| #109 | `cursor/work-ledger-261c` | Work ledger doc |
| #110 | `cursor/catch-up-fixes-261c` | #9 cleanup tasks, #3 buildSpxDeskFlow .catch, #10/#11 playCloseWasLoss, Q4 resolver test |
| #112 | `cursor/residual-sweep-261c` | #27 audit join, #31 UW REST, #32 spot guard, #38 FKs, SPX_CLAUDE_GATE staging default |

### Open / pending merge

| PR | Branch | Summary |
|----|--------|---------|
| #113 | `cursor/track-record-staging-analysis-261c` | `analyze:track-record-staging` HTTP audit script |

### Closed superseded

- #87, #103, #108 — merged into later docs/fix PRs

### Commands run (last verified)

```bash
npx tsc --noEmit          # clean
PLAYBOOK_VERDICT_GUARD_ASSERT=1 npm test   # 2087/2087 pass
npm run validate:staging  # GREEN (Saturday, api-only)
npm run analyze:track-record-staging  # 25 plays, counterfactual NO
```

---

## Foundation checklist

| Item | Status |
|------|--------|
| F1 VWAP fail-closed | ✅ #96 |
| F2 promotion data-quality | ✅ #100 |
| F3 governor single-thread | ✅ #98 |
| Q4 verdict assert | ✅ #105 + #110 |
| F4 RTH proof | ⏳ **Monday** (`STAGING-F4-MONDAY.md`) |
| Deep sweep #1–38 + Q4 | ✅ #102–#112 |
| Track-record “all winners?” | ✅ Settled — **no** (n=25) |

---

## Unresolved blockers

1. **F4** — weekday RTH + Cognito admin routes (AWS available in cloud agents)
2. **Playbook OOS evidence** — 0 instance-linked historical rows; blocked on live FSM→open→close sessions
3. **Browser E2E** — Playwright desk paint optional post-F4

---

## Post-F4 (ordered)

1. Re-run `npm run analyze:track-record-staging` weekly; watch `oos_instance_rows` on promotion-report
2. Optional ledger hygiene: `backfill-thesis-outcomes.mjs --apply` (1 row) if DB reachable from agent
3. Seventh-pass Claude validation doc section
4. Product knobs: launch gates, `SPX_CLAUDE_GATE` prod default (staging already on via #112)

---

## PR status

SPX sweep code complete. Pending: **#113** merge + **F4 Monday proof**.
