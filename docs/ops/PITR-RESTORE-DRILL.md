# Postgres PITR restore drill (quarterly)

> **Infra note (2026-07-14):** Railway is **decommissioned** — production Postgres now runs on
> **AWS RDS**. The dashboard steps below describe the old **Railway** PITR flow and are **stale**:
> on RDS, PITR is "Restore to point in time" from the RDS console / `aws rds
> restore-db-instance-to-point-in-time`, retention set by the automated-backup window. Treat the
> procedure below as historical until rewritten for RDS. See `docs/ops/AWS-MIGRATION-PLAN.md`.

**Status:** PITR enabled on production Postgres (historically the Railway `Postgres-PITR` bucket + `WAL_ARCHIVE_*` vars; now AWS RDS automated backups).

## Goal

Prove you can restore to a point in time and validate data before a real incident.

## Steps (Railway dashboard)

1. Open **Postgres** → **Backups** tab.
2. Confirm PITR range shows a non-empty restore window (starts after first post-enable base backup).
3. Pick a timestamp **within the last hour** (test fork, not production cutover).
4. Click **Restore to this moment** — Railway creates a sibling service `Postgres-restored-YYYYMMDD-HHMM`.
5. Wait for deploy **SUCCESS** on the fork.
6. From the fork’s **Connect** tab, run:
   ```sql
   SELECT COUNT(*) FROM cron_job_runs;
   SELECT MAX(started_at) FROM cron_job_runs;
   ```
7. Compare row counts / max timestamps to production (sanity — should match pre-target state).
8. **Decommission** the fork when done (delete service + volume if not needed).

## RPO / RTO (fill after drill)

| Metric | Observed |
|--------|----------|
| RPO (max data loss) | _TBD_ |
| RTO (time to fork ready) | _TBD_ |
| Last drill date | _TBD_ |

## Do not

- Run `railway deploy -t postgres-pitr` on the existing DB (creates duplicate Postgres services).
- Point `blackout-web` `DATABASE_URL` at the fork without a formal cutover plan.
