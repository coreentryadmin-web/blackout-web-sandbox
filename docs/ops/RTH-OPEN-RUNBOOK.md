# RTH-open runbook (autonomous — no user prompt)

**Cloud agents:** run this at the start of every **weekday** session when US equity RTH is
open or warming up (09:00 ET+). **Do not ask the user** — execute immediately, fix failures,
commit, push, re-validate until GREEN.

## Trigger (agent self-start)

| Condition | Action |
|---|---|
| Weekday, ET ≥ 09:00 | Run `npm run validate:rth-open` first thing |
| User message is empty / "continue" / "keep going" on a weekday | Same — treat as RTH resume |
| Weekend or ET < 09:00 | Skip RTH checks unless `--force`; routine work only |
| After every push to `main` | `npm run validate:deploy` (any time) |

## Command

```bash
npm run validate:rth-open
# off-hours override:
node scripts/rth-open-check.mjs --force
```

## What it checks

1. **`validate:deploy`** — Railway SUCCESS, live HTTP, Postgres, Sentry, sockets, crons
2. **RTH-only** (09:00–16:15 ET weekdays):
   - `spx-evaluate` ok run in last 20m
   - `market_regime` writes in last 20m
   - `data-correctness` latest run ok
   - options-socket **authenticated** (after 09:30 ET)
   - no uw-socket stall storms

## Fix loop (until GREEN)

1. Diagnose failing check (Postgres `cron_job_runs`, Railway logs, Sentry)
2. Fix in code if needed → branch → PR → merge
3. Poll Railway until deploy SUCCESS
4. Re-run `npm run validate:rth-open`
5. Confirm first SPX play / lotto ticket shows **real premium** (not "—") after chain fixes (#36, #39)

## References

- Probe paths for audits: `docs/api-audit/AUDIT-SKILL-REFERENCE.md`
- Open issues: `docs/api-audit/OPEN-ISSUES.md`
- Agent instructions: `AGENTS.md` § Autonomous RTH resume
