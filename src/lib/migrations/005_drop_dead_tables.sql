-- Drop tables confirmed to have zero INSERT code references in src/ and zero rows in prod.
-- These were scaffold tables from an earlier design that were never wired to writers.

-- spx_signal_log: legacy signal logging superseded by spx_signal_observations (from spx-signal-observe cron).
-- Last write: 2026-06-17 (10+ days stale). No INSERT in src/. Safe to drop.
DROP TABLE IF EXISTS spx_signal_log;

-- spx_pulse_snapshots and spx_watch_setups: dead scaffold tables from a prior SPX engine design.
-- Zero rows all-time, zero INSERT references in src/. Never wired.
DROP TABLE IF EXISTS spx_pulse_snapshots;
DROP TABLE IF EXISTS spx_watch_setups;
