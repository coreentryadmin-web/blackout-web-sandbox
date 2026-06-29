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
| After every push to `main` | `deploy-smoke.yml` auto-runs; locally: `npm run validate:deploy-wait && npm run validate:gha-smoke` |

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

## Scheduled automations

| Method | Schedule (ET, weekdays) | Secrets required |
|---|---|---|
| **`deploy-smoke.yml`** | **on every `main` push** | `CRON_SECRET` optional (SPX desk probe) |
| **`rth-preopen-smoke.yml`** | **09:30** | `CRON_SECRET` optional |
| **`rth-cloud-agent.yml`** | **09:32** | `CURSOR_API_KEY` |
| **`rth-prod-smoke.yml`** | **09:35** | `CRON_SECRET` optional (enables SPX desk probe) |
| **`rth-deep-audit.yml`** | **10:00, 14:00, 16:30** | `CRON_SECRET` (required), `POLYGON_API_KEY`, `DATABASE_PUBLIC_URL`, `SENTRY_AUTH_TOKEN` optional |
| **`rth-post-close-smoke.yml`** | **17:15** | `CRON_SECRET`, `SENTRY_AUTH_TOKEN` optional |

All scheduled workflows also support **Run workflow** (manual) from GitHub → Actions.

### GitHub secrets — add before first scheduled run

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required for | Source |
|---|---|---|
| `CRON_SECRET` | deep audit + smoke desk probe | Railway `blackout-web` |
| `POLYGON_API_KEY` | SPX oracle in deep audit | Railway `blackout-web` |
| `DATABASE_PUBLIC_URL` | Postgres writer/cron freshness | Railway **Postgres** service |
| `CURSOR_API_KEY` | Cloud Agent auto-launch | Cursor → Integrations → API key |
| `SENTRY_AUTH_TOKEN` | Sentry token smoke (deep audit + post-close) | Sentry → Settings → Auth Tokens |

### One-time: enable API-triggered agents

1. Cursor → Settings → Integrations → create **User API key** (or service account)
2. GitHub repo → Settings → Secrets → Actions → add `CURSOR_API_KEY`
3. Next weekday 09:32 ET, `rth-cloud-agent.yml` starts an agent with this runbook prompt

### Cursor Automation template (dashboard)

- **Schedule:** Mon–Fri 09:32 AM ET (cron `32 13 * * 1-5` in EDT months; add `32 14` for EST)
- **Repo:** `coreentryadmin-web/blackout-web` on `main`
- **Prompt:** same as `rth-cloud-agent.yml` (run RTH-OPEN-RUNBOOK autonomously)

## References

- Probe paths for audits: `docs/api-audit/AUDIT-SKILL-REFERENCE.md`
- Open issues: `docs/api-audit/OPEN-ISSUES.md`
- Agent instructions: `AGENTS.md` § Autonomous RTH resume
