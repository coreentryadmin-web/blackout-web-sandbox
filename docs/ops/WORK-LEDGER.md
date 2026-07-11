# Work Ledger — blackout-web-sandbox

**Staging:** https://staging.blackouttrades.com  
**Primary branch:** `blackout-web-sandbox`  
**Last updated:** 2026-07-11 (Saturday, market closed)

---

## Current assignment

**P0 — F4 RTH proof** (foundation gate). No new feature work until F4 is GREEN on a weekday RTH session.

---

## Implementation plan (F4)

1. Monday weekday, ET ≥ 09:00 → `docs/ops/RTH-OPEN-RUNBOOK.md` + `npm run validate:staging-rth`
2. After 09:35 ET → confirm `spx-evaluate` cron + options-socket `authenticated` (Railway/ECS logs)
3. Admin path (if Cognito/AWS available): `GET /api/admin/playbook/fsm-today`, `GET /api/admin/playbook/promotion-report`
4. On failure → reproduce → focused fix PR → auto-merge → re-validate until GREEN
5. Seventh-pass Claude validation prompt after F4 GREEN

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

### Closed superseded

- #87, #103 — merged into later docs/fix PRs

### Files touched (recent)

`spx-desk.ts`, `spx-play-technicals.ts`, `spx-play-claude.ts`, `spx-play-store.ts`, `playbook-verdict-guard.ts`, `playbook-match-resolver.ts`, `useMergedDesk.ts`, `composers.ts`, `gamma-desk.ts`, `engine-intel-overlay.ts`, `db.ts`, BIE synthesis/brief, admin routes, cron TOMLs, FINDINGS + audit docs.

### Tests added

- `engine-intel-overlay.test.ts`
- `admin-playbook-query.test.ts`
- `gamma-desk.test.ts` (topGexWalls limit)
- Updated: `spx-play-outcomes-classify`, `playbook-verdict-guard`, hod_break bars tests

### Commands run (last verified)

```bash
npx tsc --noEmit          # clean
PLAYBOOK_VERDICT_GUARD_ASSERT=1 npm test   # 2081/2081 pass
npm run validate:staging  # GREEN (Saturday, api-only)
```

### Staging paths tested

- `validate:staging` — health, ready, bootstrap, pulse, desk, play, gex-heatmap, flows, nighthawk, zerodte
- **Not tested this session:** RTH cron proof, browser paint, admin playbook routes (Cognito), live playbook_shadow block text (market closed)

---

## Foundation checklist

| Item | Status |
|------|--------|
| F1 VWAP fail-closed | ✅ #96 |
| F2 promotion data-quality | ✅ #100 (sixth-pass confirmed) |
| F3 governor single-thread | ✅ #98 |
| Q4 verdict assert | ✅ partial #100 + #105 (prod DB re-read) |
| F4 RTH proof | ⏳ **NEXT** |
| Deep sweep #1–37 | ✅ mostly #102–#105 |
| Open hygiene | #27, #31–32, #38 |

---

## Open PRs (unrelated to SPX sweep)

| PR | Title |
|----|-------|
| #38 | Cognito staging auth Phase 1 |
| #12 | UW cluster concurrency |
| #5–#9 | Dependabot (do not auto-merge major bumps) |

---

## Review feedback (Claude sixth-pass)

- F2: closed — no action
- Q4: reopen valid at #103 time → **addressed #105** → reconciled #106
- F3: clean — no action
- F4: open — scheduled Monday

---

## Unresolved blockers

1. **F4** — requires weekday RTH + optionally Cognito admin for `fsm-today`
2. **#38 DB FK** — schema migration; needs orphan audit before ALTER
3. **Browser E2E** — Playwright blocked in some sandboxes for desk paint proof

---

## Follow-up opportunities (post-F4)

1. `alert-outcome-sync` fuzzy join hardening (#27)
2. Playbook instance FK constraints (#38)
3. `SPX_CLAUDE_GATE=1` on staging (product decision)
4. Seventh-pass Claude validation doc section

---

## PR status

No open SPX/playbook fix PRs. Staging deploy current through #107.
