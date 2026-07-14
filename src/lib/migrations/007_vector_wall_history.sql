-- Durable Postgres write-through for the Vector wall-history rail.
-- The rail was Redis-only (48h TTL). This table gives it durability across Redis
-- restarts and ~90 days of past sessions for replay. Reads stay Redis-first with a
-- Postgres fallback; the db-cleanup cron prunes rows older than 90 days.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations()
-- (that inline version is what actually runs on ECS cold-start). This file mirrors it for
-- documentation/consistency with 004-006.
CREATE TABLE IF NOT EXISTS vector_wall_history (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  session_ymd DATE NOT NULL,
  bucket_time BIGINT NOT NULL,
  walls JSONB NOT NULL,
  gamma_flip DOUBLE PRECISION,
  vex_walls JSONB,
  vex_flip DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, session_ymd, bucket_time)
);
CREATE INDEX IF NOT EXISTS vector_wall_history_lookup_idx ON vector_wall_history (ticker, session_ymd, bucket_time);
CREATE INDEX IF NOT EXISTS vector_wall_history_updated_at_idx ON vector_wall_history (updated_at DESC);
