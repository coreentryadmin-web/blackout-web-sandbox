# Postgres PITR restore drill (quarterly)

**Status:** PITR enabled on production Postgres (`Postgres-PITR` bucket, `WAL_ARCHIVE_*` vars).

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
