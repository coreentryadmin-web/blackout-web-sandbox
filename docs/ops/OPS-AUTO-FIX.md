# Ops auto-fix — errors → action items → Cloud Agent → validate

**Goal:** Any prod cron/health error becomes a **GitHub issue** (action item) and **dispatches a Cursor Cloud Agent** to fix and re-validate — no user prompt.

## Pipeline

```
Every 20 min (GitHub Actions: ops-auto-fix.yml)
    → scripts/ops-collect-action-items.mjs   (Postgres + live watchdog HTTP)
    → if items > 0:
        scripts/ops-dispatch-agent.mjs       (GitHub issue + Cloud Agent)
    → Agent reads this doc → fixes → validate → closes issue
```

Also triggers when **RTH deep audit** or **cron audit query** workflows fail.

## What gets collected

| Source | Examples |
|--------|----------|
| **Postgres `cron_job_runs`** | Never fired, failed in last 4h, latest status not ok/skipped |
| **Postgres `error_events`** | Spike ≥25 (P1) or ≥75 (P0) in 15m |
| **Live `/api/cron/cron-staleness-watchdog`** | RTH-stale crons, stale/failed jobs, error spike |
| **Live `/api/cron/data-correctness?force=1`** | Numeric FLAGS |

## GitHub action items

- Label: **`ops-auto-fix`**
- Title: `[ops-auto] P0: N action item(s) · fp:<fingerprint>`
- Body contains a checklist table + `<!-- ops-fingerprint:... -->` for dedupe
- Same fingerprint → comment on existing issue (no duplicate issues)
- Cloud Agent URL posted as issue comment

## Agent fix loop (until GREEN)

1. Read this doc + `docs/ops/RTH-OPEN-RUNBOOK.md`
2. Fix each action item (code, Railway `configFile`, secrets, etc.)
3. Branch → PR → merge (or direct push if allowed)
4. Poll Railway deploy **SUCCESS**
5. Re-run:
   ```bash
   node scripts/ops-collect-action-items.mjs   # must exit 0
   npm run validate:deploy
   npm run validate:cron
   ```
6. Comment on the GitHub issue; **close** when count = 0

## Manual commands

```bash
# Scan prod (exit 1 if items found; JSON on stdout)
npm run ops:collect

# Pretty-print
node scripts/ops-collect-action-items.mjs --pretty

# Create issue + launch agent (stdin JSON from collect)
npm run ops:collect 2>/dev/null | node scripts/ops-dispatch-agent.mjs || \
  node scripts/ops-collect-action-items.mjs 2>/dev/null | node scripts/ops-dispatch-agent.mjs

# Dry-run dispatch
node scripts/ops-collect-action-items.mjs > /tmp/items.json || true
node scripts/ops-dispatch-agent.mjs --dry-run --file /tmp/items.json
```

## Required secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `DATABASE_PUBLIC_URL` | Postgres cron + error scan |
| `CRON_SECRET` | Live watchdog + data-correctness probe |
| `CURSOR_API_KEY` | Launch Cloud Agent |
| `GITHUB_TOKEN` | Auto-provided — create/update issues |

## Railway / Discord (existing)

Crons still alert **Discord** on failure (`logCronRun`, watchdog). This pipeline adds the **agent** path so fixes are attempted automatically, not only announced.

## Cloud Agent sessions

On **any** Cloud Agent weekday session, also run:

```bash
node scripts/ops-collect-action-items.mjs --pretty || true
```

If items exist, execute this runbook before other work.
