# PgBouncer Setup on Railway

## Why
At 150+ concurrent users, Next.js serverless functions exhaust the default Postgres connection limit.
PgBouncer sits in front of Postgres and multiplexes connections in transaction mode.

## Railway Steps
1. In your Railway project, click your Postgres service → Plugins → Add PgBouncer
2. Railway auto-generates PGBOUNCER_URL — copy it
3. In your Next.js service env vars:
   - Change DATABASE_URL to the value of PGBOUNCER_URL
   - Add PG_POOL_MAX=5 (our pool size — PgBouncer handles the rest)

## PgBouncer settings to configure in Railway
- pool_mode = transaction  (required — session mode doesn't work with serverless)
- max_client_conn = 1000   (total clients PgBouncer accepts)
- default_pool_size = 20   (actual Postgres connections PgBouncer maintains)
- server_idle_timeout = 30

## Verify
After enabling, check Railway logs for "PgBouncer connected" and run:
  SELECT count(*) FROM pg_stat_activity;
Should stay under 25 even with 100 concurrent users.

## Code change already made
src/lib/db.ts pool max is now controlled by PG_POOL_MAX env var (default 5).
Previously the production pool was hardcoded to max: 8.
