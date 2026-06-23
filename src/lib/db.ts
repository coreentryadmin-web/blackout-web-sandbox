import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let poolInit: Promise<Pool> | null = null;
let activeMode: "private" | "public" | "unknown" = "unknown";

/** A pg executor — the pool or a checked-out client (lets callers thread a real txn). */
export type Db = Pool | PoolClient;

export function dbConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() || process.env.DATABASE_PUBLIC_URL?.trim()
  );
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Stateful engines require Postgres in production — no per-instance memory fallbacks. */
export function requireDatabaseInProduction(): Response | null {
  if (isProductionRuntime() && !dbConfigured()) {
    return new Response(
      JSON.stringify({
        error: "Database required",
        detail: "Set DATABASE_URL in production — play/lotto state cannot run in memory.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

export function databaseConnectionMode(): "private" | "public" | "unknown" {
  return activeMode;
}

function poolSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "0") return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) return false;
  // Railway private network — traffic never leaves the internal VPC, no TLS needed
  if (connectionString.includes(".railway.internal")) return false;
  // Set DATABASE_SSL_STRICT=1 when using a managed Postgres with a properly-signed CA cert.
  // Default false because Railway's public endpoint uses a cert not in Node's default trust store.
  const strict = process.env.DATABASE_SSL_STRICT === "1";
  return { rejectUnauthorized: strict };
}

function connectionCandidates(): Array<{ url: string; mode: "private" | "public" }> {
  const privateUrl = process.env.DATABASE_URL?.trim();
  const publicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";

  if (isBuild && publicUrl) return [{ url: publicUrl, mode: "public" }];

  const out: Array<{ url: string; mode: "private" | "public" }> = [];
  if (privateUrl) out.push({ url: privateUrl, mode: "private" });
  if (publicUrl && publicUrl !== privateUrl) {
    out.push({ url: publicUrl, mode: "public" });
  }
  return out;
}

async function createPool(): Promise<Pool> {
  const candidates = connectionCandidates();
  if (!candidates.length) throw new Error("DATABASE_URL not set");

  let lastError: unknown;
  for (const candidate of candidates) {
    const test = new Pool({
      connectionString: candidate.url,
      max: 1,
      ssl: poolSsl(candidate.url),
      connectionTimeoutMillis: 10_000,
    });
    try {
      await test.query("SELECT 1");
      await test.end();

      activeMode = candidate.mode;
      if (candidate.mode === "public") {
        console.warn(
          "[db] Private Postgres DNS failed — using DATABASE_PUBLIC_URL. " +
            "Switch blackout-web to Railway V2 runtime for free private networking."
        );
      }

      // PgBouncer sits in front of Postgres on Railway. It handles real connection pooling.
      // We keep our own pool small (default 5) — PgBouncer multiplexes these to many clients.
      // Set PG_POOL_MAX env var to override (e.g. PG_POOL_MAX=5 in Railway service env vars).
      return new Pool({
        connectionString: candidate.url,
        max: parseInt(process.env.PG_POOL_MAX ?? "5", 10),
        idleTimeoutMillis: 30_000,
        ssl: poolSsl(candidate.url),
        connectionTimeoutMillis: 15_000,
      });
    } catch (error) {
      lastError = error;
      await test.end().catch(() => undefined);
      console.warn(
        `[db] ${candidate.mode} connect failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(message || "Database connection failed");
}

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  if (!poolInit) {
    poolInit = createPool().then((p) => {
      pool = p;
      return p;
    });
  }
  return poolInit;
}

let schemaReady: Promise<void> | null = null;

const MIGRATION_LOCK_ID = 42;

async function runMigrations(): Promise<void> {
  const p = await getPool();
  // Hold the migration advisory lock on ONE dedicated connection for the whole run.
  // Session-level locks acquired via pool.query() land on a random pooled connection
  // and unlock on another — leaking the lock and failing to serialize concurrent
  // cold-start instances. A dedicated client keeps acquire + hold + release on one session.
  const lockClient = await p.connect();
  try {
    // Statement timeout bounds the lock wait if a crashed instance still holds it.
    await lockClient.query(`SET statement_timeout = '30000'`);
    await lockClient.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_ID]);
    await lockClient.query(`RESET statement_timeout`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS flow_alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_id TEXT UNIQUE,
      ticker TEXT,
      strike NUMERIC,
      expiry DATE,
      option_type TEXT,
      total_premium NUMERIC,
      score NUMERIC DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'unusual_whales',
      created_at TIMESTAMPTZ,
      inserted_at TIMESTAMPTZ DEFAULT NOW(),
      raw_payload JSONB
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_flow_alerts_created_at
    ON flow_alerts(created_at DESC);
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_flow_alerts_ticker
    ON flow_alerts(ticker);
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_flow_alerts_ticker_created
    ON flow_alerts(ticker, created_at DESC NULLS LAST);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  /* platform_meta: shared KV (key TEXT PK, value TEXT, updated_at). See platform-meta-keys.ts */
  await p.query(`
    CREATE TABLE IF NOT EXISTS spx_signal_log (
      id BIGSERIAL PRIMARY KEY,
      signal_key TEXT NOT NULL,
      action TEXT NOT NULL,
      bias TEXT NOT NULL,
      score INT NOT NULL,
      confidence INT NOT NULL,
      price NUMERIC,
      entry NUMERIC,
      stop NUMERIC,
      target NUMERIC,
      headline TEXT NOT NULL,
      factors JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_signal_log_created_at
    ON spx_signal_log(created_at DESC);
  `);
  // Dedup + unique index in one transaction with a table lock so concurrent
  // inserts from api-telemetry-persist cannot sneak in between the DELETE and
  // CREATE UNIQUE INDEX and re-introduce duplicates.
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE spx_signal_log IN SHARE ROW EXCLUSIVE MODE");
    await client.query(`
      DELETE FROM spx_signal_log a
      USING spx_signal_log b
      WHERE a.id > b.id AND a.signal_key = b.signal_key;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spx_signal_log_signal_key
      ON spx_signal_log(signal_key);
    `);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await p.query(`
    CREATE TABLE IF NOT EXISTS spx_open_play (
      id BIGSERIAL PRIMARY KEY,
      session_date DATE NOT NULL,
      direction TEXT NOT NULL,
      entry_price NUMERIC NOT NULL,
      stop NUMERIC,
      target NUMERIC,
      grade TEXT NOT NULL,
      headline TEXT NOT NULL,
      trim_done BOOLEAN DEFAULT FALSE,
      mfe_pts NUMERIC DEFAULT 0,
      mae_pts NUMERIC DEFAULT 0,
      opened_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'open'
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_open_play_session_status
    ON spx_open_play(session_date, status);
  `);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spx_open_play_one_open_per_session
    ON spx_open_play(session_date) WHERE status = 'open';
  `);
  await p.query(`
    ALTER TABLE spx_open_play
    ADD COLUMN IF NOT EXISTS option_strike NUMERIC,
    ADD COLUMN IF NOT EXISTS option_type TEXT,
    ADD COLUMN IF NOT EXISTS option_label TEXT,
    ADD COLUMN IF NOT EXISTS option_premium TEXT,
    ADD COLUMN IF NOT EXISTS entry_score INT;
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS spx_play_outcomes (
      id BIGSERIAL PRIMARY KEY,
      open_play_id BIGINT NOT NULL,
      session_date DATE NOT NULL,
      direction TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      grade TEXT NOT NULL,
      score INT NOT NULL,
      confidence INT NOT NULL,
      entry_price NUMERIC NOT NULL,
      exit_price NUMERIC,
      stop NUMERIC,
      target NUMERIC,
      mfe_pts NUMERIC DEFAULT 0,
      mae_pts NUMERIC DEFAULT 0,
      trim_done BOOLEAN DEFAULT FALSE,
      pnl_pts NUMERIC,
      outcome TEXT NOT NULL DEFAULT 'open',
      exit_action TEXT,
      headline TEXT NOT NULL,
      factors JSONB,
      confirmations JSONB,
      mtf JSONB,
      claude JSONB,
      option_ticket JSONB,
      opened_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_open_play
    ON spx_play_outcomes(open_play_id);
  `);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spx_play_outcomes_one_open
    ON spx_play_outcomes(open_play_id) WHERE outcome = 'open';
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_closed
    ON spx_play_outcomes(closed_at DESC) WHERE outcome <> 'open';
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_entry_path
    ON spx_play_outcomes(entry_path, outcome);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS lotto_plays (
      id BIGSERIAL PRIMARY KEY,
      session_date DATE NOT NULL,
      pick_index INT NOT NULL DEFAULT 1,
      is_reversal BOOLEAN DEFAULT FALSE,
      phase TEXT NOT NULL,
      direction TEXT NOT NULL,
      strike NUMERIC NOT NULL,
      contract_label TEXT NOT NULL,
      entry_zone NUMERIC,
      target_price NUMERIC,
      target_pts NUMERIC,
      invalidation_level NUMERIC,
      catalyst_summary TEXT,
      catalysts JSONB,
      confidence INT,
      headline TEXT,
      thesis TEXT,
      entry_price NUMERIC,
      exit_price NUMERIC,
      outcome TEXT,
      picked_at TIMESTAMPTZ,
      buy_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lotto_plays_session_pick
    ON lotto_plays(session_date, pick_index);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS largo_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_largo_sessions_user
    ON largo_sessions(user_id, updated_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS largo_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES largo_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      tools_used JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_largo_messages_session
    ON largo_messages(session_id, created_at ASC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS nighthawk_editions (
      id BIGSERIAL PRIMARY KEY,
      edition_for DATE NOT NULL UNIQUE,
      session_date DATE NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recap_headline TEXT,
      recap_summary TEXT,
      market_recap JSONB NOT NULL DEFAULT '{}'::jsonb,
      plays JSONB NOT NULL DEFAULT '[]'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nighthawk_editions_published
    ON nighthawk_editions(published_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS nighthawk_play_outcomes (
      id BIGSERIAL PRIMARY KEY,
      edition_for DATE NOT NULL,
      ticker VARCHAR(16) NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
      conviction TEXT NOT NULL,
      entry_range_low NUMERIC,
      entry_range_high NUMERIC,
      target NUMERIC,
      stop NUMERIC,
      score INT,
      sector TEXT,
      next_day_open NUMERIC,
      next_day_close NUMERIC,
      session_high NUMERIC,
      session_low NUMERIC,
      hit_target BOOLEAN DEFAULT FALSE,
      hit_stop BOOLEAN DEFAULT FALSE,
      outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('target', 'stop', 'open', 'ambiguous', 'pending')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (edition_for, ticker)
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nighthawk_play_outcomes_pending
    ON nighthawk_play_outcomes(edition_for DESC) WHERE outcome = 'pending';
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nighthawk_play_outcomes_resolved
    ON nighthawk_play_outcomes(edition_for DESC) WHERE outcome <> 'pending';
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS nighthawk_jobs (
      id BIGSERIAL PRIMARY KEY,
      edition_for DATE NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      current_stage TEXT,
      context_json JSONB,
      candidates_json JSONB,
      scored_json JSONB,
      error TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );
  `);
  await p.query(`
    ALTER TABLE nighthawk_jobs ADD COLUMN IF NOT EXISTS synthesis_json JSONB;
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nighthawk_jobs_status
    ON nighthawk_jobs(status, updated_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS nighthawk_dossiers_staging (
      id BIGSERIAL PRIMARY KEY,
      edition_for DATE NOT NULL,
      ticker TEXT NOT NULL,
      dossier_json JSONB NOT NULL,
      scored_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (edition_for, ticker)
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nighthawk_dossiers_staging_edition
    ON nighthawk_dossiers_staging(edition_for);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS nighthawk_job_log (
      id BIGSERIAL PRIMARY KEY,
      edition_for DATE NOT NULL,
      level TEXT NOT NULL,
      stage TEXT,
      message TEXT NOT NULL,
      meta_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_nh_job_log_edition
    ON nighthawk_job_log(edition_for, created_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS cron_job_runs (
      id BIGSERIAL PRIMARY KEY,
      job_key TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INT,
      message TEXT,
      meta_json JSONB
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_cron_job_runs_key_at
    ON cron_job_runs(job_key, started_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS api_telemetry_events (
      seq_id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      correlation_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status INT,
      ok BOOLEAN NOT NULL,
      latency_ms INT NOT NULL,
      error TEXT,
      severity TEXT NOT NULL,
      rate_limited BOOLEAN DEFAULT FALSE,
      sla_breach BOOLEAN DEFAULT FALSE,
      attempt INT NOT NULL,
      max_attempts INT NOT NULL,
      retry_status TEXT NOT NULL,
      phase TEXT NOT NULL,
      request_url TEXT,
      request_body TEXT,
      response_snippet TEXT,
      headers_sent JSONB DEFAULT '[]'::jsonb,
      at TIMESTAMPTZ NOT NULL
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_api_telemetry_events_at
    ON api_telemetry_events(at DESC);
  `);
  /* Existing deployments used app-assigned seq_id; wire Postgres sequence for multi-instance safety. */
  await p.query(`
    CREATE SEQUENCE IF NOT EXISTS api_telemetry_events_seq_id_seq;
  `);
  await p.query(`
    ALTER TABLE api_telemetry_events
    ALTER COLUMN seq_id SET DEFAULT nextval('api_telemetry_events_seq_id_seq');
  `);
  await p.query(`
    ALTER SEQUENCE api_telemetry_events_seq_id_seq OWNED BY api_telemetry_events.seq_id;
  `);
  await p.query(`
    SELECT setval(
      'api_telemetry_events_seq_id_seq',
      GREATEST(1, COALESCE((SELECT MAX(seq_id) FROM api_telemetry_events), 0) + 1),
      false
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      detail JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
    ON admin_audit_log(created_at DESC);
  `);
  await p.query(`
    ALTER TABLE nighthawk_play_outcomes DROP CONSTRAINT IF EXISTS nighthawk_play_outcomes_outcome_check;
  `);
  await p.query(`
    ALTER TABLE nighthawk_play_outcomes ADD CONSTRAINT nighthawk_play_outcomes_outcome_check CHECK (outcome IN ('target', 'stop', 'open', 'ambiguous', 'pending'));
  `);
  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_spx_play_outcomes_open_play'
      ) THEN
        ALTER TABLE spx_play_outcomes
          ADD CONSTRAINT fk_spx_play_outcomes_open_play
          FOREIGN KEY (open_play_id) REFERENCES spx_open_play(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  } finally {
    // Release the advisory lock + return the dedicated connection to the pool.
    try { await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_ID]); } catch { /* ignore */ }
    lockClient.release();
  }
}

export async function ensureSchema(): Promise<void> {
  if (!dbConfigured()) return;
  try {
    if (!schemaReady) schemaReady = runMigrations();
    await schemaReady;
  } catch (error) {
    schemaReady = null;
    pool = null;
    poolInit = null;
    throw error;
  }
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) {
  await ensureSchema();
  return (await getPool()).query<T>(text, values);
}

/** Acquire a pool client for manual transaction management (caller must release). */
export async function dbClient() {
  await ensureSchema();
  return (await getPool()).connect();
}

export async function pingDatabase(): Promise<{
  ok: boolean;
  error?: string;
  mode?: string;
}> {
  if (!dbConfigured()) return { ok: false, error: "DATABASE_URL not set" };
  try {
    await ensureSchema();
    await (await getPool()).query("SELECT 1");
    return { ok: true, mode: activeMode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, mode: activeMode };
  }
}

export async function getDatabasePoolStats(): Promise<{
  configured: boolean;
  total: number;
  idle: number;
  waiting: number;
} | null> {
  if (!dbConfigured()) {
    return { configured: false, total: 0, idle: 0, waiting: 0 };
  }
  try {
    const p = await getPool();
    return {
      configured: true,
      total: p.totalCount,
      idle: p.idleCount,
      waiting: p.waitingCount,
    };
  } catch {
    return { configured: true, total: 0, idle: 0, waiting: 0 };
  }
}

// Session-level advisory locks MUST be acquired and released on the SAME connection,
// and that connection must stay checked out for the lock's whole lifetime. pool.query()
// grabs a random pooled connection per call, so lock-on-A / unlock-on-B leaks the lock
// forever and gives no real mutual exclusion. We hold a dedicated client per held key.
const heldLockClients = new Map<string, PoolClient>();

async function acquireHeldLock(mapKey: string, lockSql: string, arg: string | number): Promise<boolean> {
  if (heldLockClients.has(mapKey)) return false; // already held by this process
  const client = await (await getPool()).connect();
  try {
    const res = await client.query<{ ok: boolean }>(lockSql, [arg]);
    if (res.rows[0]?.ok === true) {
      heldLockClients.set(mapKey, client);
      return true;
    }
    client.release();
    return false;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function releaseHeldLock(mapKey: string, unlockSql: string, arg: string | number): Promise<void> {
  const client = heldLockClients.get(mapKey);
  if (!client) return;
  heldLockClients.delete(mapKey);
  try {
    await client.query(unlockSql, [arg]);
  } finally {
    client.release();
  }
}

export async function tryAdvisoryLock(lockKey: string): Promise<boolean> {
  if (!dbConfigured()) return true;
  await ensureSchema();
  return acquireHeldLock(
    `gen:${lockKey}`,
    `SELECT pg_try_advisory_lock(hashtext($1::text)) AS ok`,
    lockKey
  );
}

export async function releaseAdvisoryLock(lockKey: string): Promise<void> {
  if (!dbConfigured()) return;
  await releaseHeldLock(`gen:${lockKey}`, `SELECT pg_advisory_unlock(hashtext($1::text))`, lockKey);
}

export async function getMeta(key: string): Promise<string | null> {
  await ensureSchema();
  const res = await (await getPool()).query<{ value: string }>(
    "SELECT value FROM platform_meta WHERE key = $1",
    [key]
  );
  return res.rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string, db?: Db): Promise<void> {
  await ensureSchema();
  const q = db ?? (await getPool());
  if (value === "") {
    await q.query("DELETE FROM platform_meta WHERE key = $1", [key]);
    return;
  }
  await q.query(
    `INSERT INTO platform_meta (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

/** Advisory lock for SPX evaluator — single-writer across Railway replicas. */
const SPX_EVAL_LOCK_ID = 872341;

export async function tryAcquireSpxEvaluateLock(): Promise<boolean> {
  await ensureSchema();
  return acquireHeldLock("spx-eval", `SELECT pg_try_advisory_lock($1) AS ok`, SPX_EVAL_LOCK_ID);
}

export async function releaseSpxEvaluateLock(): Promise<void> {
  await ensureSchema();
  await releaseHeldLock("spx-eval", `SELECT pg_advisory_unlock($1)`, SPX_EVAL_LOCK_ID);
}

export type FlowRow = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
  /** Real created_at from UW; null when unknown (do NOT fall back to inserted_at). */
  event_at?: string | null;
  dte?: number;
  alert_rule?: string;
  ask_pct?: number;
  underlying_price?: number;
  open_interest?: number;
  implied_volatility?: number;
  otm_pct?: number;
};

export async function fetchRecentFlows(params: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
  since_hours?: number;
}): Promise<FlowRow[]> {
  await ensureSchema();
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  let i = 1;

  // Default to last 48h — keeps the tape current without pulling months of history
  const sinceHours = params.since_hours ?? 48;
  clauses.push(`COALESCE(created_at, inserted_at) >= NOW() - ($${i++} || ' hours')::interval`);
  values.push(sinceHours);

  if (params.ticker) {
    clauses.push(`ticker = $${i++}`);
    values.push(params.ticker.toUpperCase());
  }
  if (params.min_premium && params.min_premium > 0) {
    clauses.push(`COALESCE(total_premium, 0) >= $${i++}`);
    values.push(params.min_premium);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const limit = params.limit ?? 5000;
  values.push(limit);

  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT ticker,
           COALESCE(total_premium, 0) AS premium,
           option_type,
           TO_CHAR(expiry, 'YYYY-MM-DD') AS expiry,
           strike,
           CASE WHEN LOWER(option_type) LIKE 'c%' THEN 'bullish' ELSE 'bearish' END AS direction,
           COALESCE(score, 0) AS score,
           CASE
             WHEN COALESCE(total_premium, 0) >= 1000000 THEN 'whale'
             WHEN expiry = CURRENT_DATE THEN '0dte'
             ELSE 'stock'
           END AS route,
           COALESCE(created_at, inserted_at) AS alerted_at,
           created_at AS event_at,
           (expiry - CURRENT_DATE) AS dte,
           NULLIF(COALESCE(
             raw_payload->>'alert_rule',
             raw_payload->>'rule_name'
           ), '') AS alert_rule,
           (raw_payload->>'ask_side_pct')::numeric AS ask_pct,
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'underlying_last')  = 'number' THEN (raw_payload->>'underlying_last')::numeric  END,
             CASE WHEN jsonb_typeof(raw_payload->'underlying_price') = 'number' THEN (raw_payload->>'underlying_price')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'stock_price')      = 'number' THEN (raw_payload->>'stock_price')::numeric      END
           ) AS underlying_price,
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'open_interest') = 'number' THEN (raw_payload->>'open_interest')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'oi')            = 'number' THEN (raw_payload->>'oi')::numeric            END
           ) AS open_interest,
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'iv')                 = 'number' THEN (raw_payload->>'iv')::numeric                 END,
             CASE WHEN jsonb_typeof(raw_payload->'implied_volatility') = 'number' THEN (raw_payload->>'implied_volatility')::numeric END
           ) AS implied_volatility
    FROM flow_alerts
    ${where}
    ORDER BY COALESCE(total_premium, 0) DESC NULLS LAST
    LIMIT $${i}
    `,
    values
  );

  return res.rows.map((row) => ({
    ticker: String(row.ticker ?? ""),
    premium: Number(row.premium ?? 0),
    option_type: String(row.option_type ?? "").toUpperCase(),
    expiry: row.expiry ?? "",
    strike: Number(row.strike ?? 0),
    direction: String(row.direction ?? "bullish"),
    score: Number(row.score ?? 0),
    route: String(row.route ?? "stock"),
    alerted_at: row.alerted_at ? new Date(String(row.alerted_at)).toISOString() : new Date().toISOString(),
    event_at: row.event_at ? new Date(String(row.event_at)).toISOString() : null,
    dte: row.dte != null ? Number(row.dte) : undefined,
    alert_rule: row.alert_rule ? String(row.alert_rule) : undefined,
    ask_pct: row.ask_pct != null ? Number(row.ask_pct) : undefined,
    underlying_price: row.underlying_price != null ? Number(row.underlying_price) : undefined,
    open_interest: row.open_interest != null ? Number(row.open_interest) : undefined,
    implied_volatility: row.implied_volatility != null ? Number(row.implied_volatility) : undefined,
    otm_pct: (() => {
      if (row.underlying_price != null) {
        const stock = Number(row.underlying_price);
        const k     = Number(row.strike ?? 0);
        if (stock > 0 && k > 0) {
          const isCall = String(row.option_type ?? "").toLowerCase().startsWith("c");
          return Math.round(((isCall ? k - stock : stock - k) / stock) * 1000) / 10;
        }
      }
      return undefined;
    })(),
  }));
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function parseTimestamptz(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function insertFlowAlert(row: {
  alert_id: string;
  ticker: string;
  strike: number | null;
  expiry: string | null;
  option_type: string;
  total_premium: number;
  score: number;
  created_at: string | null;
  raw_payload: unknown;
}): Promise<boolean> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    INSERT INTO flow_alerts (
      alert_id, ticker, strike, expiry, option_type,
      total_premium, score, source, created_at, raw_payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,'unusual_whales',$8,$9::jsonb)
    ON CONFLICT (alert_id) DO NOTHING
    RETURNING id
    `,
    [
      row.alert_id,
      row.ticker,
      row.strike,
      parseDate(row.expiry),
      row.option_type,
      row.total_premium,
      Number.isFinite(row.score) ? row.score : 0,
      parseTimestamptz(row.created_at),
      JSON.stringify(row.raw_payload ?? {}),
    ]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function insertSpxSignalLog(row: {
  signal_key: string;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: unknown;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO spx_signal_log (
      signal_key, action, bias, score, confidence, price,
      entry, stop, target, headline, factors
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT (signal_key) DO NOTHING
    `,
    [
      row.signal_key,
      row.action,
      row.bias,
      row.score,
      row.confidence,
      row.price,
      row.entry,
      row.stop,
      row.target,
      row.headline,
      JSON.stringify(row.factors ?? []),
    ]
  );
}

export async function fetchRecentSpxSignalLogs(limit = 50): Promise<
  Array<{
    id: number;
    signal_key: string;
    action: string;
    bias: string;
    score: number;
    confidence: number;
    price: number | null;
    entry: number | null;
    stop: number | null;
    target: number | null;
    headline: string;
    factors: unknown;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, signal_key, action, bias, score, confidence, price,
           entry, stop, target, headline, factors, created_at
    FROM spx_signal_log
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    signal_key: String(r.signal_key),
    action: String(r.action),
    bias: String(r.bias),
    score: Number(r.score),
    confidence: Number(r.confidence),
    price: r.price != null ? Number(r.price) : null,
    entry: r.entry != null ? Number(r.entry) : null,
    stop: r.stop != null ? Number(r.stop) : null,
    target: r.target != null ? Number(r.target) : null,
    headline: String(r.headline),
    factors: r.factors,
    created_at: new Date(String(r.created_at)).toISOString(),
  }));
}

export async function fetchOpenSpxPlay(sessionDate: string): Promise<{
  id: number;
  session_date: string;
  direction: "long" | "short";
  entry_price: number;
  entry_score: number;
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  trim_done: boolean;
  mfe_pts: number;
  mae_pts: number;
  opened_at: string;
  status: "open" | "closed";
  option_strike?: number | null;
  option_type?: string | null;
  option_label?: string | null;
  option_premium?: string | null;
} | null> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, session_date, direction, entry_price, entry_score, stop, target, grade, headline,
           trim_done, mfe_pts, mae_pts, opened_at, status,
           option_strike, option_type, option_label, option_premium
    FROM spx_open_play
    WHERE session_date = $1::date AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
    `,
    [sessionDate]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    session_date: String(r.session_date).slice(0, 10),
    direction: r.direction === "short" ? "short" : "long",
    entry_price: Number(r.entry_price),
    entry_score: Number(r.entry_score ?? 0),
    stop: r.stop != null ? Number(r.stop) : null,
    target: r.target != null ? Number(r.target) : null,
    grade: String(r.grade),
    headline: String(r.headline),
    trim_done: Boolean(r.trim_done),
    mfe_pts: Number(r.mfe_pts ?? 0),
    mae_pts: Number(r.mae_pts ?? 0),
    opened_at: new Date(String(r.opened_at)).toISOString(),
    status: "open",
    option_strike: r.option_strike != null ? Number(r.option_strike) : null,
    option_type: r.option_type != null ? String(r.option_type) : null,
    option_label: r.option_label != null ? String(r.option_label) : null,
    option_premium: r.option_premium != null ? String(r.option_premium) : null,
  };
}

export async function insertOpenSpxPlay(row: {
  session_date: string;
  direction: string;
  entry_price: number;
  entry_score: number;
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  opened_at: string;
  option_strike?: number | null;
  option_type?: string | null;
  option_label?: string | null;
  option_premium?: string | null;
}): Promise<{ id: number; created: boolean }> {
  await ensureSchema();
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE spx_open_play SET status = 'closed', closed_at = NOW() WHERE session_date = $1::date AND status = 'open'`,
      [row.session_date]
    );
    try {
      const res = await client.query<{ id: string }>(
        `
    INSERT INTO spx_open_play (
      session_date, direction, entry_price, entry_score, stop, target, grade, headline, opened_at, status,
      option_strike, option_type, option_label, option_premium
    )
    VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12,$13)
    RETURNING id
    `,
        [
          row.session_date,
          row.direction,
          row.entry_price,
          row.entry_score,
          row.stop,
          row.target,
          row.grade,
          row.headline,
          row.opened_at,
          row.option_strike ?? null,
          row.option_type ?? null,
          row.option_label ?? null,
          row.option_premium ?? null,
        ]
      );
      await client.query("COMMIT");
      return { id: Number(res.rows[0]?.id ?? 0), created: true };
    } catch (err) {
      await client.query("ROLLBACK");
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        const existing = await fetchOpenSpxPlay(row.session_date);
        if (existing) return { id: existing.id, created: false };
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

export async function updateOpenSpxPlayRow(
  id: number,
  patch: {
    stop?: number | null;
    target?: number | null;
    trim_done?: boolean;
    mfe_pts?: number;
    mae_pts?: number;
  }
): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.stop !== undefined) {
    sets.push(`stop = $${i++}`);
    vals.push(patch.stop);
  }
  if (patch.target !== undefined) {
    sets.push(`target = $${i++}`);
    vals.push(patch.target);
  }
  if (patch.trim_done !== undefined) {
    sets.push(`trim_done = $${i++}`);
    vals.push(patch.trim_done);
  }
  if (patch.mfe_pts !== undefined) {
    sets.push(`mfe_pts = $${i++}`);
    vals.push(patch.mfe_pts);
  }
  if (patch.mae_pts !== undefined) {
    sets.push(`mae_pts = $${i++}`);
    vals.push(patch.mae_pts);
  }
  if (!sets.length) return;
  vals.push(id);
  await (await getPool()).query(
    `UPDATE spx_open_play SET ${sets.join(", ")} WHERE id = $${i} AND status = 'open'`,
    vals
  );
}

export async function closeOpenSpxPlayRow(id: number, db?: Db): Promise<void> {
  await ensureSchema();
  await (db ?? await getPool()).query(
    `UPDATE spx_open_play SET status = 'closed', closed_at = NOW() WHERE id = $1 AND status = 'open'`,
    [id]
  );
}

function mapPlayOutcomeRow(r: QueryResultRow): import("@/lib/spx-play-outcomes").PlayOutcomeRow {
  return {
    id: Number(r.id),
    open_play_id: Number(r.open_play_id),
    session_date: String(r.session_date).slice(0, 10),
    direction: r.direction === "short" ? "short" : "long",
    entry_path: r.entry_path === "watch_promote" ? "watch_promote" : "cold_buy",
    grade: String(r.grade),
    score: Number(r.score),
    confidence: Number(r.confidence),
    entry_price: Number(r.entry_price),
    exit_price: r.exit_price != null ? Number(r.exit_price) : null,
    stop: r.stop != null ? Number(r.stop) : null,
    target: r.target != null ? Number(r.target) : null,
    mfe_pts: Number(r.mfe_pts ?? 0),
    mae_pts: Number(r.mae_pts ?? 0),
    trim_done: Boolean(r.trim_done),
    pnl_pts: r.pnl_pts != null ? Number(r.pnl_pts) : null,
    outcome: String(r.outcome) as "open" | "win" | "loss" | "breakeven",
    exit_action:
      r.exit_action != null ? (String(r.exit_action) as import("@/lib/spx-play-outcomes").PlayExitAction) : null,
    headline: String(r.headline),
    opened_at: new Date(String(r.opened_at)).toISOString(),
    closed_at: r.closed_at != null ? new Date(String(r.closed_at)).toISOString() : null,
  };
}

export async function insertPlayOutcomeEntry(row: {
  open_play_id: number;
  session_date: string;
  direction: string;
  entry_path: string;
  grade: string;
  score: number;
  confidence: number;
  entry_price: number;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: unknown;
  confirmations: unknown;
  mtf: unknown;
  claude: unknown;
  option_ticket: unknown;
  opened_at: string;
}): Promise<number> {
  await ensureSchema();
  const res = await (await getPool()).query<{ id: string }>(
    `
    INSERT INTO spx_play_outcomes (
      open_play_id, session_date, direction, entry_path, grade, score, confidence,
      entry_price, stop, target, headline, factors, confirmations, mtf, claude,
      option_ticket, opened_at, outcome
    )
    VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,'open')
    ON CONFLICT (open_play_id) WHERE outcome = 'open' DO NOTHING
    RETURNING id
    `,
    [
      row.open_play_id,
      row.session_date,
      row.direction,
      row.entry_path,
      row.grade,
      row.score,
      row.confidence,
      row.entry_price,
      row.stop,
      row.target,
      row.headline,
      JSON.stringify(row.factors ?? []),
      JSON.stringify(row.confirmations ?? null),
      JSON.stringify(row.mtf ?? null),
      JSON.stringify(row.claude ?? null),
      JSON.stringify(row.option_ticket ?? null),
      row.opened_at,
    ]
  );
  return Number(res.rows[0]?.id ?? 0);
}

export async function closePlayOutcomeRow(
  openPlayId: number,
  close: {
    exit_price: number;
    exit_action: string;
    mfe_pts: number;
    mae_pts: number;
    trim_done: boolean;
    pnl_pts: number;
    outcome: string;
    closed_at: string;
  },
  db?: Db
): Promise<void> {
  await ensureSchema();
  await (db ?? await getPool()).query(
    `
    UPDATE spx_play_outcomes
    SET exit_price = $2,
        exit_action = $3,
        mfe_pts = $4,
        mae_pts = $5,
        trim_done = $6,
        pnl_pts = $7,
        outcome = $8,
        closed_at = $9::timestamptz
    WHERE open_play_id = $1 AND outcome = 'open'
    `,
    [
      openPlayId,
      close.exit_price,
      close.exit_action,
      close.mfe_pts,
      close.mae_pts,
      close.trim_done,
      close.pnl_pts,
      close.outcome,
      close.closed_at,
    ]
  );
}

export async function fetchClosedPlayOutcomes(limit = 500): Promise<
  import("@/lib/spx-play-outcomes").PlayOutcomeRow[]
> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, open_play_id, session_date, direction, entry_path, grade, score, confidence,
           entry_price, exit_price, stop, target, mfe_pts, mae_pts, trim_done, pnl_pts,
           outcome, exit_action, headline, opened_at, closed_at
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    ORDER BY closed_at DESC NULLS LAST
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map(mapPlayOutcomeRow);
}

export async function fetchRecentPlayOutcomeRows(limit = 50): Promise<
  import("@/lib/spx-play-outcomes").PlayOutcomeRow[]
> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, open_play_id, session_date, direction, entry_path, grade, score, confidence,
           entry_price, exit_price, stop, target, mfe_pts, mae_pts, trim_done, pnl_pts,
           outcome, exit_action, headline, opened_at, closed_at
    FROM spx_play_outcomes
    ORDER BY opened_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map(mapPlayOutcomeRow);
}

export async function fetchSpxAdminRollups(): Promise<{
  grade_breakdown: Array<{
    grade: string;
    count: number;
    wins: number;
    losses: number;
    win_rate: number;
    avg_pnl: number;
  }>;
  exit_breakdown: Array<{ exit_action: string; count: number; avg_pnl: number }>;
  daily_rollup: Array<{
    day: string;
    trades: number;
    wins: number;
    losses: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  signal_actions_30d: Array<{ action: string; count: number }>;
  signals_today: number;
  flow_alerts_today: number;
  open_outcomes: number;
  avg_pnl_pts: number;
  avg_mfe_pts: number;
  avg_mae_pts: number;
  recent_signals: Awaited<ReturnType<typeof fetchRecentSpxSignalLogs>>;
}> {
  await ensureSchema();
  const pool = await getPool();

  const gradeRes = await pool.query(
    `
    SELECT grade,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
           COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
           COALESCE(AVG(pnl_pts) FILTER (WHERE pnl_pts IS NOT NULL), 0) AS avg_pnl
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    GROUP BY grade
    ORDER BY grade
    `
  );

  const exitRes = await pool.query(
    `
    SELECT COALESCE(exit_action, 'UNKNOWN') AS exit_action,
           COUNT(*)::int AS count,
           COALESCE(AVG(pnl_pts), 0) AS avg_pnl
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    GROUP BY exit_action
    ORDER BY count DESC
    `
  );

  const dailyRes = await pool.query(
    `
    SELECT to_char(closed_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS trades,
           COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
           COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
           COALESCE(AVG(pnl_pts), 0) AS avg_pnl,
           COALESCE(SUM(pnl_pts), 0) AS total_pnl
    FROM spx_play_outcomes
    WHERE outcome <> 'open' AND closed_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 21
    `
  );

  const signalActionsRes = await pool.query(
    `
    SELECT action, COUNT(*)::int AS count
    FROM spx_signal_log
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY action
    ORDER BY count DESC
    `
  );

  const signalsTodayRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM spx_signal_log WHERE (created_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date`
  );

  const flowTodayRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM flow_alerts WHERE (inserted_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date`
  );

  const openRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM spx_play_outcomes WHERE outcome = 'open'`
  );

  const avgRes = await pool.query<{
    avg_pnl: string;
    avg_mfe: string;
    avg_mae: string;
  }>(
    `
    SELECT COALESCE(AVG(pnl_pts), 0) AS avg_pnl,
           COALESCE(AVG(mfe_pts), 0) AS avg_mfe,
           COALESCE(AVG(mae_pts), 0) AS avg_mae
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    `
  );

  const recent_signals = await fetchRecentSpxSignalLogs(30);

  return {
    grade_breakdown: gradeRes.rows.map((r) => {
      const count = Number(r.count);
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      return {
        grade: String(r.grade),
        count,
        wins,
        losses,
        win_rate: count > 0 ? wins / count : 0,
        avg_pnl: Number(r.avg_pnl),
      };
    }),
    exit_breakdown: exitRes.rows.map((r) => ({
      exit_action: String(r.exit_action),
      count: Number(r.count),
      avg_pnl: Number(r.avg_pnl),
    })),
    daily_rollup: dailyRes.rows.map((r) => ({
      day: String(r.day),
      trades: Number(r.trades),
      wins: Number(r.wins),
      losses: Number(r.losses),
      avg_pnl: Number(r.avg_pnl),
      total_pnl: Number(r.total_pnl),
    })),
    signal_actions_30d: signalActionsRes.rows.map((r) => ({
      action: String(r.action),
      count: Number(r.count),
    })),
    signals_today: Number(signalsTodayRes.rows[0]?.count ?? 0),
    flow_alerts_today: Number(flowTodayRes.rows[0]?.count ?? 0),
    open_outcomes: Number(openRes.rows[0]?.count ?? 0),
    avg_pnl_pts: Number(avgRes.rows[0]?.avg_pnl ?? 0),
    avg_mfe_pts: Number(avgRes.rows[0]?.avg_mfe ?? 0),
    avg_mae_pts: Number(avgRes.rows[0]?.avg_mae ?? 0),
    recent_signals,
  };
}

export async function insertLottoPlay(row: {
  session_date: string;
  pick_index: number;
  is_reversal: boolean;
  phase: string;
  direction: string;
  strike: number;
  contract_label: string;
  entry_zone: number;
  target_price: number;
  target_pts: number;
  invalidation_level: number;
  catalyst_summary: string;
  catalysts: string[];
  confidence: number;
  headline: string;
  thesis: string;
  picked_at: string;
}): Promise<number | null> {
  if (!dbConfigured()) return null;
  await ensureSchema();
  const res = await (await getPool()).query<{ id: string }>(
    `
    INSERT INTO lotto_plays (
      session_date, pick_index, is_reversal, phase, direction, strike, contract_label,
      entry_zone, target_price, target_pts, invalidation_level, catalyst_summary, catalysts,
      confidence, headline, thesis, picked_at
    )
    VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
    ON CONFLICT (session_date, pick_index) DO NOTHING
    RETURNING id
    `,
    [
      row.session_date,
      row.pick_index,
      row.is_reversal,
      row.phase,
      row.direction,
      row.strike,
      row.contract_label,
      row.entry_zone,
      row.target_price,
      row.target_pts,
      row.invalidation_level,
      row.catalyst_summary,
      JSON.stringify(row.catalysts),
      row.confidence,
      row.headline,
      row.thesis,
      row.picked_at,
    ]
  );
  return res.rows[0] ? Number(res.rows[0].id) : null;
}

export async function updateLottoPlay(
  id: number,
  patch: {
    phase: string;
    entry_price?: number | null;
    buy_at?: string | null;
    outcome?: string | null;
    exit_price?: number | null;
    closed_at?: string | null;
  }
): Promise<void> {
  if (!dbConfigured()) return;
  await ensureSchema();
  await (await getPool()).query(
    `
    UPDATE lotto_plays
    SET phase = $2,
        entry_price = COALESCE($3, entry_price),
        buy_at = COALESCE($4, buy_at),
        outcome = COALESCE($5, outcome),
        exit_price = COALESCE($6, exit_price),
        closed_at = COALESCE($7, closed_at)
    WHERE id = $1
    `,
    [
      id,
      patch.phase,
      patch.entry_price ?? null,
      patch.buy_at ?? null,
      patch.outcome ?? null,
      patch.exit_price ?? null,
      patch.closed_at ?? null,
    ]
  );
}

export async function fetchLottoPlaysForDate(sessionDate: string): Promise<
  Array<{
    id: number;
    session_date: string;
    pick_index: number;
    phase: string;
    direction: string;
    strike: number;
    contract_label: string;
    catalyst_summary: string | null;
    outcome: string | null;
    headline: string | null;
    picked_at: string | null;
    buy_at: string | null;
    closed_at: string | null;
  }>
> {
  if (!dbConfigured()) return [];
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, session_date, pick_index, phase, direction, strike, contract_label,
           catalyst_summary, outcome, headline, picked_at, buy_at, closed_at
    FROM lotto_plays
    WHERE session_date = $1::date
    ORDER BY pick_index ASC, id ASC
    `,
    [sessionDate]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    session_date: String(r.session_date).slice(0, 10),
    pick_index: Number(r.pick_index),
    phase: String(r.phase),
    direction: String(r.direction),
    strike: Number(r.strike),
    contract_label: String(r.contract_label),
    catalyst_summary: r.catalyst_summary != null ? String(r.catalyst_summary) : null,
    outcome: r.outcome != null ? String(r.outcome) : null,
    headline: r.headline != null ? String(r.headline) : null,
    picked_at: r.picked_at != null ? new Date(String(r.picked_at)).toISOString() : null,
    buy_at: r.buy_at != null ? new Date(String(r.buy_at)).toISOString() : null,
    closed_at: r.closed_at != null ? new Date(String(r.closed_at)).toISOString() : null,
  }));
}

export type NighthawkEditionRow = {
  edition_for: string;
  session_date: string;
  published_at: string;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown>;
  plays: unknown[];
  meta: Record<string, unknown>;
};

export async function upsertNighthawkEdition(row: {
  edition_for: string;
  session_date: string;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown>;
  plays: unknown[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO nighthawk_editions (
      edition_for, session_date, published_at,
      recap_headline, recap_summary, market_recap, plays, meta
    ) VALUES ($1::date, $2::date, NOW(), $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
    ON CONFLICT (edition_for) DO UPDATE SET
      session_date = EXCLUDED.session_date,
      published_at = NOW(),
      recap_headline = EXCLUDED.recap_headline,
      recap_summary = EXCLUDED.recap_summary,
      market_recap = EXCLUDED.market_recap,
      plays = EXCLUDED.plays,
      meta = EXCLUDED.meta
    `,
    [
      row.edition_for,
      row.session_date,
      row.recap_headline,
      row.recap_summary,
      JSON.stringify(row.market_recap),
      JSON.stringify(row.plays),
      JSON.stringify(row.meta ?? {}),
    ]
  );
}

export async function fetchNighthawkEditionByDate(
  editionFor: string
): Promise<NighthawkEditionRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT edition_for, session_date, published_at,
           recap_headline, recap_summary, market_recap, plays, meta
    FROM nighthawk_editions
    WHERE edition_for = $1::date
    LIMIT 1
    `,
    [editionFor]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    edition_for: String(r.edition_for).slice(0, 10),
    session_date: String(r.session_date).slice(0, 10),
    published_at: new Date(String(r.published_at)).toISOString(),
    recap_headline: r.recap_headline != null ? String(r.recap_headline) : null,
    recap_summary: r.recap_summary != null ? String(r.recap_summary) : null,
    market_recap: (r.market_recap as Record<string, unknown>) ?? {},
    plays: Array.isArray(r.plays) ? r.plays : [],
    meta: (r.meta as Record<string, unknown>) ?? {},
  };
}

export async function fetchLatestNighthawkEdition(): Promise<NighthawkEditionRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT edition_for, session_date, published_at,
           recap_headline, recap_summary, market_recap, plays, meta
    FROM nighthawk_editions
    ORDER BY edition_for DESC
    LIMIT 1
    `
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    edition_for: String(r.edition_for).slice(0, 10),
    session_date: String(r.session_date).slice(0, 10),
    published_at: new Date(String(r.published_at)).toISOString(),
    recap_headline: r.recap_headline != null ? String(r.recap_headline) : null,
    recap_summary: r.recap_summary != null ? String(r.recap_summary) : null,
    market_recap: (r.market_recap as Record<string, unknown>) ?? {},
    plays: Array.isArray(r.plays) ? r.plays : [],
    meta: (r.meta as Record<string, unknown>) ?? {},
  };
}

export async function cacheNighthawkPlayExplanation(
  editionFor: string,
  ticker: string,
  explanation: string
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    UPDATE nighthawk_editions
    SET meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      ARRAY['play_explanations', $2],
      to_jsonb($3::text),
      true
    )
    WHERE edition_for = $1::date
    `,
    [editionFor, ticker.toUpperCase(), explanation]
  );
}

export async function fetchTickerFlowDailyNet(
  ticker: string,
  lookbackDays = 10
): Promise<Array<{ day: string; net: number; call: number; put: number }>> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT
      (COALESCE(created_at, inserted_at) AT TIME ZONE 'America/New_York')::date AS day,
      COALESCE(SUM(CASE WHEN LOWER(option_type) LIKE 'c%' THEN COALESCE(total_premium, 0) ELSE 0 END), 0) AS call_prem,
      COALESCE(SUM(CASE WHEN LOWER(option_type) LIKE 'p%' THEN COALESCE(total_premium, 0) ELSE 0 END), 0) AS put_prem
    FROM flow_alerts
    WHERE ticker = $1
      AND COALESCE(created_at, inserted_at) >= (NOW() AT TIME ZONE 'America/New_York')::date - ($2::int || ' days')::interval
    GROUP BY 1
    ORDER BY day DESC
    `,
    [ticker.toUpperCase(), lookbackDays]
  );
  return res.rows.map((row) => {
    const call = Number(row.call_prem ?? 0);
    const put = Number(row.put_prem ?? 0);
    return {
      day: String(row.day).slice(0, 10),
      call,
      put,
      net: call - put,
    };
  });
}

/** Trailing average daily total premium per ticker (excludes today). */
export async function fetchTickersAvgDailyPremium(
  tickers: string[],
  lookbackDays = 30
): Promise<Record<string, number>> {
  if (!tickers.length) return {};
  await ensureSchema();
  const syms = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT ticker,
           COALESCE(AVG(daily_prem), 0) AS avg_premium
    FROM (
      SELECT ticker,
             (COALESCE(created_at, inserted_at) AT TIME ZONE 'America/New_York')::date AS day,
             SUM(COALESCE(total_premium, 0)) AS daily_prem
      FROM flow_alerts
      WHERE ticker = ANY($1::text[])
        AND COALESCE(created_at, inserted_at) >= (NOW() AT TIME ZONE 'America/New_York')::date - ($2::int || ' days')::interval
        AND (COALESCE(created_at, inserted_at) AT TIME ZONE 'America/New_York')::date < (NOW() AT TIME ZONE 'America/New_York')::date
      GROUP BY ticker, day
    ) daily
    GROUP BY ticker
    `,
    [syms, lookbackDays]
  );
  const out: Record<string, number> = {};
  for (const row of res.rows) {
    out[String(row.ticker).toUpperCase()] = Number(row.avg_premium ?? 0);
  }
  return out;
}

/** Per-ticker daily call/put nets for batch streak computation. */
export async function fetchTickersFlowDailyNets(
  tickers: string[],
  lookbackDays = 10
): Promise<Record<string, Array<{ day: string; net: number; call: number; put: number }>>> {
  if (!tickers.length) return {};
  await ensureSchema();
  const syms = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT
      ticker,
      (COALESCE(created_at, inserted_at) AT TIME ZONE 'America/New_York')::date AS day,
      COALESCE(SUM(CASE WHEN LOWER(option_type) LIKE 'c%' THEN COALESCE(total_premium, 0) ELSE 0 END), 0) AS call_prem,
      COALESCE(SUM(CASE WHEN LOWER(option_type) LIKE 'p%' THEN COALESCE(total_premium, 0) ELSE 0 END), 0) AS put_prem
    FROM flow_alerts
    WHERE ticker = ANY($1::text[])
      AND COALESCE(created_at, inserted_at) >= (NOW() AT TIME ZONE 'America/New_York')::date - ($2::int || ' days')::interval
    GROUP BY ticker, day
    ORDER BY ticker ASC, day DESC
    `,
    [syms, lookbackDays]
  );
  const out: Record<string, Array<{ day: string; net: number; call: number; put: number }>> = {};
  for (const row of res.rows) {
    const ticker = String(row.ticker).toUpperCase();
    const call = Number(row.call_prem ?? 0);
    const put = Number(row.put_prem ?? 0);
    const bucket = out[ticker] ?? [];
    bucket.push({
      day: String(row.day).slice(0, 10),
      call,
      put,
      net: call - put,
    });
    out[ticker] = bucket;
  }
  return out;
}

export type NighthawkPlayOutcomeRow = {
  id: number;
  edition_for: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string;
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
  score: number | null;
  sector: string | null;
  next_day_open: number | null;
  next_day_close: number | null;
  session_high: number | null;
  session_low: number | null;
  hit_target: boolean;
  hit_stop: boolean;
  outcome: "target" | "stop" | "open" | "ambiguous" | "pending";
  created_at: string;
};

function mapNighthawkPlayOutcomeRow(r: QueryResultRow): NighthawkPlayOutcomeRow {
  return {
    id: Number(r.id),
    edition_for: String(r.edition_for).slice(0, 10),
    ticker: String(r.ticker),
    direction: String(r.direction) as "LONG" | "SHORT",
    conviction: String(r.conviction),
    entry_range_low: r.entry_range_low != null ? Number(r.entry_range_low) : null,
    entry_range_high: r.entry_range_high != null ? Number(r.entry_range_high) : null,
    target: r.target != null ? Number(r.target) : null,
    stop: r.stop != null ? Number(r.stop) : null,
    score: r.score != null ? Number(r.score) : null,
    sector: r.sector != null ? String(r.sector) : null,
    next_day_open: r.next_day_open != null ? Number(r.next_day_open) : null,
    next_day_close: r.next_day_close != null ? Number(r.next_day_close) : null,
    session_high: r.session_high != null ? Number(r.session_high) : null,
    session_low: r.session_low != null ? Number(r.session_low) : null,
    hit_target: Boolean(r.hit_target),
    hit_stop: Boolean(r.hit_stop),
    outcome: String(r.outcome) as NighthawkPlayOutcomeRow["outcome"],
    created_at: new Date(String(r.created_at)).toISOString(),
  };
}

export async function upsertNighthawkPlayOutcomes(
  rows: Array<{
    edition_for: string;
    ticker: string;
    direction: "LONG" | "SHORT";
    conviction: string;
    entry_range_low: number | null;
    entry_range_high: number | null;
    target: number | null;
    stop: number | null;
    score: number;
    sector: string | null;
  }>
): Promise<void> {
  if (!rows.length) return;
  await ensureSchema();
  const pool = await getPool();
  for (const row of rows) {
    await pool.query(
      `
      INSERT INTO nighthawk_play_outcomes (
        edition_for, ticker, direction, conviction,
        entry_range_low, entry_range_high, target, stop, score, sector, outcome
      ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      ON CONFLICT (edition_for, ticker) DO UPDATE SET
        direction = EXCLUDED.direction,
        conviction = EXCLUDED.conviction,
        entry_range_low = EXCLUDED.entry_range_low,
        entry_range_high = EXCLUDED.entry_range_high,
        target = EXCLUDED.target,
        stop = EXCLUDED.stop,
        score = EXCLUDED.score,
        sector = EXCLUDED.sector,
        updated_at = NOW()
      WHERE nighthawk_play_outcomes.outcome = 'pending'
      `,
      [
        row.edition_for,
        row.ticker,
        row.direction,
        row.conviction,
        row.entry_range_low,
        row.entry_range_high,
        row.target,
        row.stop,
        row.score,
        row.sector,
      ]
    );
  }
}

export async function fetchPendingNighthawkOutcomes(lookbackDays = 7): Promise<NighthawkPlayOutcomeRow[]> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, edition_for, ticker, direction, conviction,
           entry_range_low, entry_range_high, target, stop, score, sector,
           next_day_open, next_day_close, session_high, session_low,
           hit_target, hit_stop, outcome, created_at
    FROM nighthawk_play_outcomes
    WHERE outcome = 'pending'
      AND edition_for >= ((NOW() AT TIME ZONE 'America/New_York')::date - ($1::int || ' days')::interval)
    ORDER BY edition_for ASC, ticker ASC
    `,
    [lookbackDays]
  );
  return res.rows.map(mapNighthawkPlayOutcomeRow);
}

export async function updateNighthawkPlayOutcome(
  id: number,
  patch: {
    next_day_open: number;
    next_day_close: number;
    session_high: number;
    session_low: number;
    hit_target: boolean;
    hit_stop: boolean;
    outcome: "target" | "stop" | "open" | "ambiguous" | "pending";
  }
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    UPDATE nighthawk_play_outcomes
    SET next_day_open = $2,
        next_day_close = $3,
        session_high = $4,
        session_low = $5,
        hit_target = $6,
        hit_stop = $7,
        outcome = $8,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      id,
      patch.next_day_open,
      patch.next_day_close,
      patch.session_high,
      patch.session_low,
      patch.hit_target,
      patch.hit_stop,
      patch.outcome,
    ]
  );
}

export async function fetchNighthawkOutcomeAnalytics(windowDays = 30): Promise<{
  rows: NighthawkPlayOutcomeRow[];
  pending_count: number;
}> {
  await ensureSchema();
  const pool = await getPool();
  const [resolvedRes, pendingRes] = await Promise.all([
    pool.query(
      `
      SELECT o.id, o.edition_for, o.ticker, o.direction, o.conviction,
             o.entry_range_low, o.entry_range_high, o.target, o.stop, o.score, o.sector,
             o.next_day_open, o.next_day_close, o.session_high, o.session_low,
             o.hit_target, o.hit_stop, o.outcome, o.created_at
      FROM nighthawk_play_outcomes o
      INNER JOIN nighthawk_editions e ON e.edition_for = o.edition_for
      WHERE o.outcome <> 'pending'
        AND o.edition_for >= (CURRENT_DATE - ($1::int || ' days')::interval)
      ORDER BY o.edition_for DESC, o.ticker ASC
      `,
      [windowDays]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM nighthawk_play_outcomes WHERE outcome = 'pending'`
    ),
  ]);
  return {
    rows: resolvedRes.rows.map(mapNighthawkPlayOutcomeRow),
    pending_count: Number(pendingRes.rows[0]?.count ?? 0),
  };
}

export type NighthawkJobRow = {
  id: number;
  edition_for: string;
  status: string;
  current_stage: string | null;
  context_json: Record<string, unknown> | null;
  candidates_json: string[] | null;
  scored_json: unknown[] | null;
  synthesis_json: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  published_at: string | null;
};

function mapNighthawkJobRow(r: QueryResultRow): NighthawkJobRow {
  const candidates = r.candidates_json;
  return {
    id: Number(r.id),
    edition_for: String(r.edition_for).slice(0, 10),
    status: String(r.status),
    current_stage: r.current_stage != null ? String(r.current_stage) : null,
    context_json: (r.context_json as Record<string, unknown>) ?? null,
    candidates_json: Array.isArray(candidates) ? candidates.map((t) => String(t).toUpperCase()) : null,
    scored_json: Array.isArray(r.scored_json) ? r.scored_json : null,
    synthesis_json: (r.synthesis_json as Record<string, unknown>) ?? null,
    error: r.error != null ? String(r.error) : null,
    started_at: new Date(String(r.started_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
    published_at: r.published_at != null ? new Date(String(r.published_at)).toISOString() : null,
  };
}

export async function upsertNighthawkJob(
  editionFor: string,
  fields: {
    status?: string;
    current_stage?: string | null;
    context_json?: Record<string, unknown> | null;
    candidates_json?: string[] | null;
    scored_json?: unknown[] | null;
    synthesis_json?: Record<string, unknown> | null;
    error?: string | null;
    published_at?: string | null;
  }
): Promise<void> {
  await ensureSchema();
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [editionFor];
  let idx = 2;

  const add = (col: string, val: unknown, json = false) => {
    sets.push(`${col} = $${idx}${json ? "::jsonb" : ""}`);
    values.push(val);
    idx += 1;
  };

  if (fields.status !== undefined) add("status", fields.status);
  if (fields.current_stage !== undefined) add("current_stage", fields.current_stage);
  if (fields.context_json !== undefined) add("context_json", JSON.stringify(fields.context_json ?? null), true);
  if (fields.candidates_json !== undefined) add("candidates_json", JSON.stringify(fields.candidates_json ?? []), true);
  if (fields.scored_json !== undefined) add("scored_json", JSON.stringify(fields.scored_json ?? []), true);
  if (fields.synthesis_json !== undefined) add("synthesis_json", JSON.stringify(fields.synthesis_json ?? null), true);
  if (fields.error !== undefined) add("error", fields.error);
  if (fields.published_at !== undefined) add("published_at", fields.published_at);

  await (await getPool()).query(
    `
    INSERT INTO nighthawk_jobs (edition_for, status, current_stage)
    VALUES ($1::date, 'running', 'stage_context')
    ON CONFLICT (edition_for) DO UPDATE SET ${sets.join(", ")}
    `,
    values
  );
}

export async function fetchNighthawkJob(editionFor: string): Promise<NighthawkJobRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, edition_for, status, current_stage, context_json, candidates_json, scored_json,
           synthesis_json, error, started_at, updated_at, published_at
    FROM nighthawk_jobs
    WHERE edition_for = $1::date
    LIMIT 1
    `,
    [editionFor]
  );
  const row = res.rows[0];
  return row ? mapNighthawkJobRow(row) : null;
}

export async function updateNighthawkJobStage(
  editionFor: string,
  stage: string,
  status: string
): Promise<void> {
  await upsertNighthawkJob(editionFor, { current_stage: stage, status });
}

export async function saveDossierStaging(
  editionFor: string,
  ticker: string,
  dossierJson: Record<string, unknown>,
  scoredJson?: Record<string, unknown> | null
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO nighthawk_dossiers_staging (edition_for, ticker, dossier_json, scored_json)
    VALUES ($1::date, $2, $3::jsonb, $4::jsonb)
    ON CONFLICT (edition_for, ticker) DO UPDATE SET
      dossier_json = EXCLUDED.dossier_json,
      scored_json = EXCLUDED.scored_json,
      created_at = NOW()
    `,
    [editionFor, ticker.toUpperCase(), JSON.stringify(dossierJson), JSON.stringify(scoredJson ?? null)]
  );
}

export async function fetchStagedDossiers(
  editionFor: string
): Promise<Array<{ ticker: string; dossier: Record<string, unknown>; scored: Record<string, unknown> | null }>> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT ticker, dossier_json, scored_json
    FROM nighthawk_dossiers_staging
    WHERE edition_for = $1::date
    ORDER BY ticker ASC
    `,
    [editionFor]
  );
  return res.rows.map((r) => ({
    ticker: String(r.ticker).toUpperCase(),
    dossier: (r.dossier_json as Record<string, unknown>) ?? {},
    scored: (r.scored_json as Record<string, unknown>) ?? null,
  }));
}

export async function fetchStagedDossierTickers(editionFor: string): Promise<string[]> {
  await ensureSchema();
  const res = await (await getPool()).query<{ ticker: string }>(
    `SELECT ticker FROM nighthawk_dossiers_staging WHERE edition_for = $1::date ORDER BY ticker ASC`,
    [editionFor]
  );
  return res.rows.map((r) => String(r.ticker).toUpperCase());
}

export function logNighthawkJob(
  editionFor: string,
  level: "info" | "warn" | "error",
  stage: string | null,
  message: string,
  meta?: Record<string, unknown>
): void {
  void (async () => {
    try {
      await ensureSchema();
      await (await getPool()).query(
        `
        INSERT INTO nighthawk_job_log (edition_for, level, stage, message, meta_json)
        VALUES ($1::date, $2, $3, $4, $5::jsonb)
        `,
        [editionFor, level, stage, message, JSON.stringify(meta ?? null)]
      );
    } catch (err) {
      console.warn("[nighthawk/job-log] failed:", err);
    }
  })();
}

export async function clearNighthawkStaging(editionFor: string): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(`DELETE FROM nighthawk_dossiers_staging WHERE edition_for = $1::date`, [editionFor]);
}

export async function fetchLatestNighthawkJob(): Promise<NighthawkJobRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, edition_for, status, current_stage, context_json, candidates_json, scored_json,
           synthesis_json, error, started_at, updated_at, published_at
    FROM nighthawk_jobs
    ORDER BY updated_at DESC
    LIMIT 1
    `
  );
  const row = res.rows[0];
  return row ? mapNighthawkJobRow(row) : null;
}

export type CronJobRunRow = {
  id: number;
  job_key: string;
  status: string;
  started_at: string;
  duration_ms: number | null;
  message: string | null;
  meta_json: Record<string, unknown> | null;
};

function mapCronJobRunRow(row: Record<string, unknown>): CronJobRunRow {
  return {
    id: Number(row.id),
    job_key: String(row.job_key),
    status: String(row.status),
    started_at: String(row.started_at),
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    message: row.message != null ? String(row.message) : null,
    meta_json: (row.meta_json as Record<string, unknown>) ?? null,
  };
}

export async function recordCronJobRun(input: {
  job_key: string;
  status: string;
  duration_ms?: number;
  message?: string;
  meta_json?: Record<string, unknown>;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO cron_job_runs (job_key, status, duration_ms, message, meta_json)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      input.job_key,
      input.status,
      input.duration_ms ?? null,
      input.message ?? null,
      JSON.stringify(input.meta_json ?? null),
    ]
  );
}

export async function fetchCronJobLastRuns(): Promise<CronJobRunRow[]> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT DISTINCT ON (job_key)
      id, job_key, status, started_at, duration_ms, message, meta_json
    FROM cron_job_runs
    ORDER BY job_key, started_at DESC
    `
  );
  return res.rows.map(mapCronJobRunRow);
}

export async function fetchCronJobRecentRuns(limit = 48): Promise<CronJobRunRow[]> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, job_key, status, started_at, duration_ms, message, meta_json
    FROM cron_job_runs
    ORDER BY started_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map(mapCronJobRunRow);
}

export async function fetchCronJobRunCount(): Promise<number> {
  await ensureSchema();
  const res = await (await getPool()).query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM cron_job_runs`
  );
  return Number(res.rows[0]?.count ?? 0);
}
