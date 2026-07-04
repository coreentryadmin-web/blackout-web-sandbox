-- 1. Market regime snapshots (written by market-regime-detector cron every 30min)
CREATE TABLE IF NOT EXISTS market_regime (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gex_regime TEXT NOT NULL,          -- STRONG_POSITIVE | POSITIVE | NEGATIVE | STRONG_NEGATIVE
  vol_regime TEXT NOT NULL,          -- HIGH_VOL | NORMAL_VOL | LOW_VOL
  trend_regime TEXT NOT NULL,        -- UPTREND | DOWNTREND | CHOPPY
  flow_regime TEXT NOT NULL,         -- BULL_FLOW | BEAR_FLOW | NEUTRAL_FLOW
  composite TEXT NOT NULL,           -- BREAKOUT_BULL | BREAKDOWN_BEAR | RANGE_BOUND | MIXED
  playbook TEXT,
  net_gex NUMERIC,
  iv_percentile NUMERIC,
  above_vwap BOOLEAN,
  flow_ratio NUMERIC,
  raw JSONB
);
CREATE INDEX IF NOT EXISTS market_regime_captured_at_idx ON market_regime(captured_at DESC);

-- 2. Flow anomalies (written by anomaly-detection-flows cron every 5min)
CREATE TABLE IF NOT EXISTS flow_anomalies (
  id BIGSERIAL PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anomaly_type TEXT NOT NULL,        -- CONCENTRATION | COORDINATED_SWEEP | PREMIUM_SPIKE | PUT_SURGE
  ticker TEXT,
  detail TEXT NOT NULL,
  premium NUMERIC,
  direction TEXT,
  severity TEXT NOT NULL,            -- CRITICAL | HIGH | MEDIUM | LOW
  raw JSONB
);
CREATE INDEX IF NOT EXISTS flow_anomalies_detected_at_idx ON flow_anomalies(detected_at DESC);
CREATE INDEX IF NOT EXISTS flow_anomalies_severity_idx ON flow_anomalies(severity, detected_at DESC);

-- 3. Coaching alerts (written by position-coaching-monitor cron every 10min)
CREATE TABLE IF NOT EXISTS coaching_alerts (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_type TEXT NOT NULL,        -- NEAR_CALL_WALL | BELOW_PUT_WALL | CONTRA_FLOW | VWAP_ABOVE_ROOM | EOD_THETA
  alert_text TEXT NOT NULL,
  urgency TEXT NOT NULL,             -- CRITICAL | HIGH | MEDIUM | LOW
  spx_price NUMERIC,
  call_wall NUMERIC,
  put_wall NUMERIC,
  vwap NUMERIC,
  for_longs BOOLEAN DEFAULT true,
  for_shorts BOOLEAN DEFAULT false,
  raw JSONB
);
CREATE INDEX IF NOT EXISTS coaching_alerts_generated_at_idx ON coaching_alerts(generated_at DESC);

-- 4. Platform briefs (pre-market and EOD, written by respective crons)
CREATE TABLE IF NOT EXISTS platform_briefs (
  id BIGSERIAL PRIMARY KEY,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  brief_date DATE NOT NULL,
  brief_type TEXT NOT NULL,          -- premarket | eod
  content TEXT NOT NULL,
  spx_price NUMERIC,
  call_wall NUMERIC,
  put_wall NUMERIC,
  king_strike NUMERIC,
  net_gex NUMERIC,
  gex_bias TEXT,
  metadata JSONB,
  UNIQUE(brief_date, brief_type)
);
CREATE INDEX IF NOT EXISTS platform_briefs_date_type_idx ON platform_briefs(brief_date DESC, brief_type);

-- 5. Signal events (every signal the platform generates)
--
-- ORPHANED (2026-07-04, docs/audit/FINDINGS.md): this table + signal_outcomes below were
-- meant to unify SPX Slayer + Night Hawk signal accuracy under one ledger, but nothing in
-- the codebase ever writes to it — POST /api/signals/record (the only INSERT path) has zero
-- callers outside its own route file, confirmed by grepping the entire src/ tree. The two
-- real, live outcome ledgers are spx_play_outcomes (SPX Slayer, src/lib/db.ts) and
-- nighthawk_play_outcomes (Night Hawk, src/lib/db.ts) — /api/platform/intel and the Night
-- Hawk platform-intel snapshot now read accuracy from those instead (src/lib/signal-accuracy.ts).
-- Left in place (not dropped) because /api/signals/open and its sibling routes
-- (src/app/api/signals/{record,open,outcome}/route.ts) are still exercised by
-- scripts/gha-http-smoke.mjs + scripts/validate-deploy.mjs as an auth-gate smoke check;
-- removing the table would require also touching those scripts for no functional gain, since
-- nothing depends on the DATA in this table anymore. Do not add new writers here — extend
-- spx_play_outcomes/nighthawk_play_outcomes instead.
CREATE TABLE IF NOT EXISTS signal_events (
  id BIGSERIAL PRIMARY KEY,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_source TEXT NOT NULL,       -- SPX_SLAYER | NIGHT_HAWK | GEX_WALL
  signal_type TEXT NOT NULL,         -- APPROVE_BUY | APPROVE_SELL | PLAY_LONG | PLAY_SHORT
  grade TEXT,                        -- A | B | C
  spx_price NUMERIC,
  call_wall NUMERIC,
  put_wall NUMERIC,
  confluence_score NUMERIC,
  ticker TEXT,
  strike NUMERIC,
  expiry TEXT,
  option_type TEXT,
  entry_mark NUMERIC,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS signal_events_fired_at_idx ON signal_events(fired_at DESC);
CREATE INDEX IF NOT EXISTS signal_events_source_idx ON signal_events(signal_source, fired_at DESC);

-- 6. Signal outcomes (T+15, T+30, T+60, EOD checkpoints for each signal)
-- ORPHANED alongside signal_events above — see that comment. Never populated in production.
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id BIGSERIAL PRIMARY KEY,
  signal_event_id BIGINT REFERENCES signal_events(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checkpoint TEXT NOT NULL,          -- T+15 | T+30 | T+60 | EOD
  price_at_checkpoint NUMERIC,
  price_change NUMERIC,
  direction_correct BOOLEAN,
  pnl_pct NUMERIC,
  outcome TEXT                       -- WIN | LOSS | OPEN
);
CREATE INDEX IF NOT EXISTS signal_outcomes_event_idx ON signal_outcomes(signal_event_id, checkpoint);
