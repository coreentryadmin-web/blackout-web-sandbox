# Audit SKILL reference (canonical — sync external task configs to this file)

Last updated: 2026-07-06

> **Purpose:** Scheduled deep-audit / connectivity / https-monitor tasks often ship with a
> `SKILL.md` outside this repo. When those probes use stale paths or env names they generate
> **false P0/P1 every run** and drown real regressions. **This file is the source of truth**
> for probe lists, env names, and field-name heuristics. In-repo Cursor skill copy:
> `.cursor/skills/platform-audit/SKILL.md`

---

## Environment variable names (prod / Railway `blackout-web`)

| Wrong (stale) | Correct |
|---|---|
| `UNUSUAL_WHALES_API_KEY` | `UW_API_KEY` |
| `MASSIVE_API_KEY` alone | `POLYGON_API_KEY` or `MASSIVE_API_KEY` (both accepted) |
| `SENTRY_ORG` / `SENTRY_PROJECT` required | Optional — `SENTRY_AUTH_TOKEN` + `SENTRY_DSN` auto-discover via `npm run validate:deploy` |
| Missing `REPLICA_COUNT` on multi-replica | Set `REPLICA_COUNT` to live replica count (currently **5**) |

---

## HTTP probe paths (Phase 1 smoke)

Use these paths. **Do not** use the stale aliases in the right column.

| Purpose | Canonical path | Stale (404 / wrong) |
|---|---|---|
| Health | `GET /api/health` | — |
| Readiness | `GET /api/ready` | — |
| Public track record | `GET /api/public/track-record` | — |
| Market regime (cron writer) | `GET /api/market/regime` | — |
| SPX desk | `GET /api/market/spx/desk` | `/api/market/spx-pulse` |
| SPX pulse | `GET /api/market/spx/pulse` | `/api/market/spx-pulse` |
| Flows (HELIX) | `GET /api/market/flows` | `/api/flows` |
| GEX positioning | `GET /api/market/gex-positioning` | — (401 unauth = expected) |
| Night Hawk edition | `GET /api/market/nighthawk/edition` | `/api/nighthawk/latest-edition` |
| News | `GET /api/market/news` | `/api/grid/news` (no such route) |
| Grid panels | `GET /api/grid/{analysts,catalysts,congress,dark-pool,earnings,economy,movers,sectors}` | `/api/grid/news` |
| Signals open (cron) | `POST /api/signals/open` | Must return **401** without cron auth |
| Admin debug | `GET /api/admin/debug-uw` | Must return **401** without admin |
| Engine health | `GET /api/engine/health` | Must return **401** without admin |

**Auth note:** Most market/grid routes return **401** without Clerk session + premium tier. That is
correct — unauthenticated 401 is **not** a failure. Use `CRON_SECRET` bearer for cron routes or
an admin session for data reconciliation during RTH.

**HTTPS / CSP probe:** Use canonical apex `https://blackouttrades.com/` (200 + CSP). Do **not**
probe `https://www.blackouttrades.com/` with `-MaximumRedirection 0` — that measures the www→apex
301 hop which lacks CSP and causes a false "CSP MISSING" alarm.

---

## Source path corrections

| Wrong | Correct |
|---|---|
| `lib/run-tool.ts` | `lib/largo/run-tool.ts` |
| `lib/market/gex-positioning.ts` | `lib/providers/gex-positioning.ts` |
| `PlatformShell.tsx` (dead) | `src/app/(site)/layout.tsx` |
| `BO-AAI/` or root `blackout-web/` | Canonical repo only — never edit stale copies |

---

## Postgres pool error-handler grep

The live handler is on **`livePool.on("error", …)`** in `src/lib/db.ts` (~line 113), not `pool.on`.
Regex should match both `pool.on("error"` and `livePool.on("error"`.

---

## Field-name heuristics (avoid false FAIL)

These channels are **wired** but use different field names than older audit scripts expect:

| Audit heuristic (stale) | Real fields / locations |
|---|---|
| `flowBias`, `netFlow` on SPX desk | `flow_0dte_net`, `spx_flows`, `spx_option_flows` via `mergeFlowIntoDesk` |
| `FOMC\|CPI` only in `spx-desk-merge.ts` | `macro_events` populated in `spx-desk.ts`; `macroHardBlock` in `spx-signals.ts` |
| GEX walls from separate UW-only path | Single source: `getGexPositioning()` / `lib/providers/gex-positioning.ts` |

---

## Post-deploy validation (operator / agent)

After every push to `main`:

```bash
npm run validate:deploy
```

Checks: Railway deploy SUCCESS, 10 live HTTP endpoints, Postgres (`error_events`, cron latest run,
API telemetry), Sentry (token auto-discovers org/project), socket churn, `REPLICA_COUNT`.

---

## Open issues log

Live bug tracker: `docs/api-audit/OPEN-ISSUES.md`
