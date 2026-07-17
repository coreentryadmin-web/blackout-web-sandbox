# Cron schedules (AWS EventBridge)

**Prod + staging:** EventBridge rules in `blackout-infra/terraform/modules/crons/cron-jobs.json`
fire **AWS Lambda → HTTPS `GET /api/cron/*`** with `Authorization: Bearer $CRON_SECRET`.

**UTC convention:** EventBridge cron expressions use **UTC**. The RTH band `11-21` Mon–Fri
≈ 7:00 AM–5:59 PM Eastern (EDT) / 6:00 AM–4:59 PM (EST). Routes apply in-app ET gates
(`inMarketHours` / `inOptionsMarketHours`) so fires outside 9:30 AM–4:00 PM ET are cheap no-ops.

## Registry vs infra manifest

| Source | Purpose |
|--------|---------|
| `src/lib/cron-registry.ts` | App registry (stale thresholds, descriptions, admin UI) |
| `blackout-infra/.../cron-jobs.json` | EventBridge schedule + path (infra source of truth) |
| `npm run validate:cron-manifest` | CI: every registry key has a `/api/cron/*/route.ts` |

Sync schedules into Terraform: `node scripts/sync-cron-schedules.mjs` in **blackout-infra**.

## Manual cron hit (local / ops)

```bash
CRON_SECRET=... CRON_TARGET_BASE_URL=https://staging.blackouttrades.com \
  node scripts/hit-cron.mjs /api/cron/socket-health
```

## Verify after deploy

```bash
npm run validate:cron-manifest
npm run validate:cron          # needs DATABASE_URL — latest cron_job_runs per key
CRON_TARGET_BASE_URL=https://staging.blackouttrades.com npm run validate:deploy
```

See also: `docs/ops/STAGING-CONNECT.md`, `docs/ops/AWS-MIGRATION-PLAN.md`.
