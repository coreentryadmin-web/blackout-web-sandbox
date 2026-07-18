---
name: platform-audit
description: Canonical BlackOut production audit probes, env names, and validation commands. Use for RTH audits, deep platform audits, connectivity checks, and Cloud Agent sessions. Synced from docs/api-audit/AUDIT-SKILL-REFERENCE.md.
---

# BlackOut platform audit (canonical)

**Repo:** `coreentryadmin-web/blackout-web` on `main` only. Never edit stale `BO-AAI/` copies.

**Prime directive:** Every number a user sees is real, live, and correct, or it isn't shown.

## Quick validation

```bash
npm run validate:deploy          # after every main push
npm run validate:rth-open        # weekday RTH (09:00–16:15 ET)
npm run validate:spx-rth         # SPX all-day audit (matrix + desk + play + E2E)
npm run validate:spx-e2e         # SPX /dashboard click-through + cross-tool
npm run validate:gha-smoke       # prod HTTP smoke
node scripts/gha-rth-audit.mjs   # full GHA audit (needs CRON_SECRET)
```

## Environment names (prod)

| Wrong | Correct |
|---|---|
| `UNUSUAL_WHALES_API_KEY` | `UW_API_KEY` |
| `/api/market/spx-pulse` | `/api/market/spx/pulse` |
| `/api/flows` | `/api/market/flows` |
| `/api/nighthawk/latest-edition` | `/api/market/nighthawk/edition` |
| `PlatformShell.tsx` | `src/app/(site)/layout.tsx` |

## HTTP smoke (public)

- `GET /api/health`, `/api/ready`, `/api/market/regime`, `/api/public/track-record` → 200
- `GET /api/signals/open`, `/api/admin/debug-uw`, `/api/engine/health` → **401** (expected)
- Track-record split-brain guard: `/api/track-record` SPX block must match `/api/public/track-record`

## Cron plane (Bearer CRON_SECRET)

| Route | Purpose |
|---|---|
| `/api/cron/data-correctness?force=1` | 6-layer numeric scorecard |
| `/api/cron/data-integrity?force=1` | Cross-tool numeric reconcile → incidents |
| `/api/cron/provider-health-reconcile?force=1` | Provider API failures → incidents |
| `/api/cron/cron-staleness-watchdog` | Stale crons + error spike alerts |

## GitHub Actions (weekdays ET)

- **09:30** pre-open smoke · **09:32** cloud agent · **09:35** prod smoke
- **10:00 / 14:00 / 16:30** deep audit · **17:15** post-close smoke
- **Every main push:** deploy smoke

## Ops runbooks

- RTH: `docs/ops/RTH-OPEN-RUNBOOK.md`
- Auto-fix: `docs/ops/OPS-AUTO-FIX.md`
- Merge policy: `CLAUDE.md` § Merge authorization — **auto-merge to `main` once CI green; no approval**
- Open issues: `docs/api-audit/OPEN-ISSUES.md`
- Full probe reference: `docs/api-audit/AUDIT-SKILL-REFERENCE.md`

## Do not duplicate on GitHub

Writer crons (`flow-ingest`, `heatmap-warm`, etc.) — already provisioned as ECS scheduled tasks.
