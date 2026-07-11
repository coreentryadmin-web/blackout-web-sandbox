# Staging F4 — Monday RTH proof (autonomous)

**Do not ask the user.** Run on the first **weekday** session when America/New_York ≥ **09:00**.

## One-line agent prompt (Cursor scheduled task)

> Run `docs/ops/STAGING-F4-MONDAY.md` on staging: `npm run validate:staging-rth` until GREEN; after 09:35 ET confirm spx-evaluate + options-socket via Cognito admin (`fsm-today`, `promotion-report`); on failure fix → PR → auto-merge → re-run; log result in `WORK-LEDGER.md`; do not ask me.

## Checklist

| Step | When (ET) | Command / action |
|------|-----------|------------------|
| 1 | ≥ 09:00 | `npm run validate:staging-rth` (fix loop until GREEN) |
| 2 | ≥ 09:35 | Re-run step 1 or grep ECS logs: `spx-evaluate` ok + `options-socket` authenticated |
| 3 | 09:35–16:00 | Cognito admin (AWS secrets — no user): `GET /api/admin/playbook/fsm-today`, `GET /api/admin/playbook/promotion-report` — confirm `instances` / pipeline during live session |
| 4 | ≥ 09:40 | `GET /api/market/spx/play` — `playbook_shadow` block text when `market_open: true` |
| 5 | Post-close | `npm run analyze:track-record-staging` — refresh counterfactual JSON |
| 6 | Optional | If staging Postgres reachable from agent: `node --import tsx scripts/backfill-thesis-outcomes.mjs` then `--apply` if 1-row mismatch (id=9 scratch); skip if ECONNRESET |
| 7 | On GREEN | Mark **F4 ✅** in `docs/ops/WORK-LEDGER.md`; trigger seventh-pass Claude validation section |

## Success criteria (F4 GREEN)

- `validate:staging-rth` exits 0 on a trading day during RTH window
- `spx-evaluate` ok run within last 20m (Postgres `cron_job_runs` or VPC fallback)
- `options-socket` authenticated after 09:30 ET
- Admin `fsm-today` returns instances (not `available: false` for auth)
- No new fix PR required, or fix merged and re-validated same session

## On failure

1. Diagnose from script output + `npm run validate:staging-live`
2. Branch `cursor/fix-staging-f4-<topic>-261c` → fix → push → PR to `blackout-web-sandbox`
3. `gh pr merge <n> --auto --squash --delete-branch` when CI green
4. Wait for ECS deploy (`npm run validate:deploy` with staging env)
5. Re-run from step 1

## References

- `docs/ops/RTH-OPEN-RUNBOOK.md` (prod Railway — parallel, not a substitute)
- `docs/ops/STAGING-CONNECT.md` § validation
- `docs/ops/WORK-LEDGER.md` foundation checklist
