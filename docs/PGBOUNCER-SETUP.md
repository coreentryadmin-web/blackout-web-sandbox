# PgBouncer on Railway (production)

> **DEPRECATED** — Railway decommissioned 2026-07. Database now runs on Amazon RDS
> with RDS Proxy for connection pooling. Retained for historical reference.

## Why
`blackout-web` runs long-lived Node (`next start`) with **5 replicas** and a small app-side pool
(`PG_POOL_MAX`, default 15). PgBouncer multiplexes client connections to a bounded set of Postgres
backends (`default_pool_size = 20`).

## Enable (Railway UI)
1. Open the **Postgres** service → **Database** tab → **Config** → **Connection Pooling** (PgBouncer).
2. Railway provisions a **PgBouncer** service and `${{PgBouncer.DATABASE_*}}` references.
3. On **blackout-web**, set `DATABASE_URL` (and related `DATABASE_*`) to **`${{PgBouncer.DATABASE_URL}}`** refs.

Legacy docs mentioned “Plugins”; the current path is **Database → Config → Connection Pooling**.

## Production settings (verified)
| Setting | Value | Notes |
|---------|-------|-------|
| `POOL_MODE` | **session** | Required for advisory locks + session-scoped Postgres behavior in SPX/migration paths |
| `DEFAULT_POOL_SIZE` | 20 | Backend connections to Postgres |
| `MAX_CLIENT_CONN` | 1000 | Client ceiling from all web replicas |
| `PG_POOL_MAX` (web) | 15 | App pool per replica × 5 replicas → pooler multiplexes |

**Session vs transaction:** Older runbooks assumed “serverless → transaction mode.” This app is **not**
serverless on Railway; session mode is intentional. `src/lib/db.ts` omits `statement_timeout` startup
params when the host is a pooler.

## Region layout (2026-07 audit)
- **Postgres + Redis:** `iad`
- **PgBouncer:** `iad` ×2 + `us-west2` ×1 (colocated with web + Postgres; west pooler for `us-west2` replicas)
- **blackout-web:** `iad` ×3 + `us-west2` ×2

## Verify
- Admin → Operations → System Vitals: `database_via_pooler: true`
- `GET /api/ready` → `db: connected`
- Under load: `SELECT count(*) FROM pg_stat_activity;` stays bounded vs `max_connections`

## Code
- Pool size: `src/lib/db.ts` (`PG_POOL_MAX`, pooler detection)
- Ops posture: `src/lib/ops-config-status.ts`
