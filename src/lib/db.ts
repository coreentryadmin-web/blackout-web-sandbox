import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { isTransientPgError } from "@/lib/db-transient";

// Deliberately NOT importing rateLimiterEnvNumber from provider-rate-limiter-shared.ts here: that
// module's dynamic `import("@/lib/redis-pubsub")` drags `ioredis` (and `node:diagnostics_channel`)
// into any edge-runtime bundle that transitively imports db.ts, breaking `next build`. This is a
// trivial one-liner — inlined instead of shared.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// PgBouncer sits in front of Postgres on Railway (docs/PGBOUNCER-SETUP.md) and has a fixed
// DEFAULT_POOL_SIZE (backend budget) shared by every web replica. Each replica's own PG_POOL_MAX
// must leave headroom under (budget / REPLICA_COUNT) or N replicas' pools can jointly
// oversubscribe the pooler — confirmed live: production ran PG_POOL_MAX=15 x 5 replicas = 75
// against a 20-backend budget, a real 3.75x oversubscription that a prior "Query read timeout"
// investigation missed by modeling the ceiling off the code default (5) instead of the
// documented production override (15) (docs/audit/FINDINGS.md, 2026-07-03 entry). Both knobs are
// overridable so this stays correct if the topology or PgBouncer config ever changes.
/** Exported for unit testing — pure, no env/module-load-order dependence. */
export function computeSafePgPoolMaxDefault(pgBouncerBackendBudget: number, replicaCount: number): number {
  return Math.max(1, Math.floor(pgBouncerBackendBudget / Math.max(1, Math.floor(replicaCount))));
}

const REPLICA_COUNT_FOR_POOL = Math.max(1, Math.floor(envNumber("REPLICA_COUNT", 1)));
const PGBOUNCER_BACKEND_BUDGET = envNumber("PGBOUNCER_DEFAULT_POOL_SIZE", 20);
const SAFE_PG_POOL_MAX_DEFAULT = computeSafePgPoolMaxDefault(PGBOUNCER_BACKEND_BUDGET, REPLICA_COUNT_FOR_POOL);

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

/** True when the connection string targets PgBouncer (not direct Postgres). */
function connectionViaPooler(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname.toLowerCase();
    return (
      host.includes("pgbouncer") ||
      host.includes("pooler") ||
      host.includes("proxy.rlwy") ||
      host.includes("-pool.") ||
      // AWS RDS Proxy: {name}.proxy-{id}.{region}.rds.amazonaws.com
      host.includes(".proxy-")
    );
  } catch {
    return false;
  }
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
    // Swallow any idle-client 'error' from this short-lived probe pool — without a listener a
    // transient network blip mid-probe would escalate to an unhandled 'error' and crash. The
    // catch below still handles real connect failures (the awaited query rejects).
    test.on("error", () => undefined);
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
      // Default is computed from the documented PgBouncer backend budget divided across replicas
      // (SAFE_PG_POOL_MAX_DEFAULT, see top of file) rather than a flat guess — set PG_POOL_MAX to
      // override explicitly. statement_timeout (server-enforced) + query_timeout (driver-enforced)
      // bound EVERY runtime query so a single blocked/slow query can't pin a pooled connection
      // forever — without that, N unbounded queries would exhaust the pool and stall the replica.
      // Override via PG_STATEMENT_TIMEOUT_MS — keep it above the slowest legit query (heavy
      // flow_alerts JSONB scans).
      const statementTimeoutMs = parseInt(process.env.PG_STATEMENT_TIMEOUT_MS ?? "30000", 10);
      const explicitPoolMax = process.env.PG_POOL_MAX
        ? parseInt(process.env.PG_POOL_MAX, 10)
        : null;
      const poolMax =
        explicitPoolMax != null && Number.isFinite(explicitPoolMax) && explicitPoolMax > 0
          ? explicitPoolMax
          : SAFE_PG_POOL_MAX_DEFAULT;
      // An explicit override can still oversubscribe the pooler (e.g. production ran
      // PG_POOL_MAX=15 x 5 replicas = 75 against a 20-backend budget) — we don't silently clobber
      // an operator's explicit setting, but this makes the risk visible instead of invisible.
      if (poolMax * REPLICA_COUNT_FOR_POOL > PGBOUNCER_BACKEND_BUDGET) {
        console.warn(
          `[db] PG_POOL_MAX=${poolMax} x REPLICA_COUNT=${REPLICA_COUNT_FOR_POOL} = ` +
            `${poolMax * REPLICA_COUNT_FOR_POOL} exceeds the PgBouncer backend budget ` +
            `(PGBOUNCER_DEFAULT_POOL_SIZE=${PGBOUNCER_BACKEND_BUDGET}). Cluster-wide Postgres ` +
            `connection oversubscription risk — lower PG_POOL_MAX or raise PgBouncer's pool size.`
        );
      }
      const viaPooler = connectionViaPooler(candidate.url);
      const livePool = new Pool({
        connectionString: candidate.url,
        max: poolMax,
        idleTimeoutMillis: 30_000,
        ssl: poolSsl(candidate.url),
        connectionTimeoutMillis: 15_000,
        // PgBouncer rejects statement_timeout as a startup parameter — use driver query_timeout only.
        ...(viaPooler || statementTimeoutMs <= 0
          ? {}
          : { statement_timeout: statementTimeoutMs }),
        query_timeout:
          statementTimeoutMs > 0 ? statementTimeoutMs + 5_000 : undefined,
      });
      // CRITICAL: Railway drops idle private-network connections; node-postgres surfaces that
      // as an 'error' event on the pool's idle clients. With NO listener, Node escalates it to
      // an unhandled 'error' and CRASHES the entire replica. Swallow + log — the pool
      // transparently re-establishes on the next query. Mirrors the Redis fix in make-redis.ts.
      livePool.on("error", (err) => {
        console.warn(
          "[db] idle pool client error (recovered, pool will reconnect):",
          err instanceof Error ? err.message : err
        );
      });
      return livePool;
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
  // Supports fetchRecentFlows ORDER BY COALESCE(total_premium, 0) DESC NULLS LAST.
  // Recreate when NULLS LAST was missing on an older deploy (IF NOT EXISTS is a no-op otherwise).
  await p.query(`DROP INDEX IF EXISTS idx_flow_alerts_recency_premium`);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_flow_alerts_recency_premium
    ON flow_alerts(
      (COALESCE(created_at, inserted_at)) DESC NULLS LAST,
      (COALESCE(total_premium, 0)) DESC NULLS LAST
    );
  `);
  // Supports fetchRecentFlows ORDER BY COALESCE(created_at, inserted_at) DESC NULLS LAST
  // (the "recent" tape sort). Separate from recency_premium so PG can pick the cheapest
  // single-column scan for this path (avoid multi-column sort that ignores premium col).
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_flow_alerts_event_at_recency
    ON flow_alerts((COALESCE(created_at, inserted_at)) DESC NULLS LAST);
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
    ALTER TABLE spx_open_play
    ADD COLUMN IF NOT EXISTS playbook_id TEXT;
  `);
  await p.query(`
    ALTER TABLE spx_play_outcomes
    ADD COLUMN IF NOT EXISTS playbook_id TEXT;
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_playbook
    ON spx_play_outcomes(playbook_id, outcome);
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
  // 'unfilled' outcome (grading-honesty fix): re-issue the CHECK so pre-existing prod
  // tables accept it. DROP+ADD as a pair is idempotent across boots.
  await p.query(`
    ALTER TABLE nighthawk_play_outcomes DROP CONSTRAINT IF EXISTS nighthawk_play_outcomes_outcome_check;
  `);
  await p.query(`
    ALTER TABLE nighthawk_play_outcomes ADD CONSTRAINT nighthawk_play_outcomes_outcome_check
    CHECK (outcome IN ('target', 'stop', 'open', 'ambiguous', 'pending', 'unfilled'));
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
  // 0DTE Command scanner ledger — every qualifying setup the always-on scan flags,
  // one row per ticker per session (upserted as the tape evolves), graded against
  // the session close so the board's discovery hit-rate is measurable, not vibes.
  await p.query(`
    CREATE TABLE IF NOT EXISTS zerodte_setup_log (
      session_date DATE NOT NULL,
      ticker TEXT NOT NULL,
      direction TEXT NOT NULL,
      top_strike NUMERIC,
      expiry DATE,
      score INT NOT NULL,
      score_max INT NOT NULL,
      dossier_score INT,
      conviction TEXT,
      gross_premium NUMERIC,
      spike BOOLEAN NOT NULL DEFAULT FALSE,
      underlying_at_flag NUMERIC,
      underlying_latest NUMERIC,
      flags_json JSONB,
      first_flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      close_price NUMERIC,
      move_pct NUMERIC,
      direction_hit BOOLEAN,
      graded_at TIMESTAMPTZ,
      PRIMARY KEY (session_date, ticker)
    );
  `);
  // Contract-plan columns (added after first ship) — idempotent ALTERs so existing
  // prod tables pick them up on the next schema pass.
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS entry_premium NUMERIC;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS flow_avg_fill NUMERIC;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS plan_json JSONB;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS plan_outcome TEXT;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS plan_pnl_pct NUMERIC;
  `);
  // Live play lifecycle (Status column of the plays table) — latched intraday by the
  // scanner: peak/trough of the contract's mark since flag drive sticky transitions.
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS status TEXT;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS last_mark NUMERIC;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS peak_premium NUMERIC;
  `);
  await p.query(`
    ALTER TABLE zerodte_setup_log ADD COLUMN IF NOT EXISTS trough_premium NUMERIC;
  `);
  // BLACKOUT Intelligence Engine — every answered question logged with its route
  // (deterministic router vs Claude fallback) and numeric-claim verification, so
  // router coverage, verification rate, and cost avoided are queryable from day one.
  await p.query(`
    CREATE TABLE IF NOT EXISTS bie_interactions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      question TEXT NOT NULL,
      intent TEXT,
      answer_source TEXT NOT NULL,
      claims_total INT,
      claims_verified INT,
      latency_ms INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_bie_interactions_at ON bie_interactions(created_at DESC);
  `);
  // Task #103 groundwork for #112 (routing Largo turns through BIE's self-eval
  // loop): the loop needs to know what ACTUALLY happened on a turn, not just the
  // question/answer_source pair captured above. `tools_used` mirrors the same
  // JSONB-array idiom `largo_messages.tools_used` already uses (line ~458) — a
  // real JSON array via toJsonbParam()/`::jsonb`, never a bare array bind (that
  // serializes to a Postgres ARRAY-literal, not JSON — see toJsonbParam's doc
  // comment and the Stage-4 audit-trail correction this repo already hit once).
  // `intent_bucket` is additive alongside the existing `intent` column: `intent`
  // stays raw (the router's intent name, or NULL on fallback — unchanged
  // meaning, no existing reader touched), while `intent_bucket` normalizes NULL
  // to the explicit "claude_fallback" sentinel so a query never has to special-
  // case NULL to mean "fell through to Claude" vs. some future different
  // meaning of NULL.
  await p.query(`
    ALTER TABLE bie_interactions ADD COLUMN IF NOT EXISTS tools_used JSONB DEFAULT '[]'::jsonb;
  `);
  await p.query(`
    ALTER TABLE bie_interactions ADD COLUMN IF NOT EXISTS intent_bucket TEXT;
  `);
  // BIE Layer 2 — knowledge store. Embeddings live in portable JSONB (corpus is
  // thousands of chunks; cosine ranking happens in Node) — zero extension
  // dependency, clean upgrade path to pgvector if the corpus outgrows this.
  await p.query(`
    CREATE TABLE IF NOT EXISTS bie_knowledge (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      chunk TEXT NOT NULL,
      chunk_hash TEXT NOT NULL UNIQUE,
      embedding JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_bie_knowledge_kind ON bie_knowledge(kind, created_at DESC);
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
  // Durable error sink (P1: no external error tracking). Written by error-sink.ts
  // when DATABASE_URL is set; inert otherwise. Bounded via opportunistic prune.
  await p.query(`
    CREATE TABLE IF NOT EXISTS error_events (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      scope TEXT,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      meta_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_error_events_created_at
    ON error_events(created_at DESC);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_journal (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      open_play_id BIGINT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_journal_user_play
    ON user_journal(user_id, open_play_id);
  `);
  // Clerk webhook user provisioning table — clerk_user_id is the Clerk sub ("user_xxx").
  // Provisioned on user.created, updated on user.updated. whop_user_id + tier are written
  // by the Whop webhook (or manually by admin) after the Clerk record already exists.
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      whop_user_id TEXT,
      tier TEXT DEFAULT 'free',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users(clerk_user_id);
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
  `);
  // Refund/chargeback revocation denylist — Postgres is the durable source of truth
  // (a security denylist must survive a Redis outage/flush); whop-revocation.ts keeps
  // Redis in front as the hot cache. Rows are permanent: a refunded one-time purchase
  // stays revoked forever, so no TTL/cleanup.
  await p.query(`
    CREATE TABLE IF NOT EXISTS whop_revoked_memberships (
      membership_id TEXT PRIMARY KEY,
      revoked_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- spx_signal_observations/spx_signal_weight_reports: moved here from spx-signal-db.ts's
    -- initSpxSignalTables() (2026-07-03, live deadlock — see docs/audit/FINDINGS.md). That
    -- function guarded its own CREATE TABLE/INDEX/ALTER block with an in-process boolean,
    -- which does nothing across REPLICA_COUNT concurrent replicas booting from the same
    -- deploy — Postgres deadlocked when two fresh replicas ran the same multi-statement DDL
    -- concurrently. This block now runs under the SAME pg_advisory_lock(42) as every other
    -- migration, which already correctly serializes concurrent cold starts.
    CREATE TABLE IF NOT EXISTS spx_signal_observations (
      id                 BIGSERIAL PRIMARY KEY,
      observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      price              NUMERIC NOT NULL,
      vwap               NUMERIC,
      price_vs_vwap      NUMERIC,
      score              INTEGER NOT NULL,
      grade              TEXT NOT NULL,
      direction          TEXT,
      engine_action      TEXT NOT NULL,
      session_window     TEXT NOT NULL DEFAULT 'other',
      vix                NUMERIC,
      market_open        BOOLEAN NOT NULL DEFAULT false,
      factors_json       JSONB NOT NULL DEFAULT '[]',
      raw_json           JSONB NOT NULL DEFAULT '{}',
      gates_blocked_json JSONB NOT NULL DEFAULT '[]',
      outcome_at         TIMESTAMPTZ,
      outcome_price      NUMERIC,
      outcome_move       NUMERIC,
      direction_correct  BOOLEAN
    );
    CREATE INDEX IF NOT EXISTS spx_signal_obs_at
      ON spx_signal_observations (observed_at DESC);
    CREATE INDEX IF NOT EXISTS spx_signal_obs_pending_outcome
      ON spx_signal_observations (observed_at)
      WHERE outcome_at IS NULL;

    CREATE TABLE IF NOT EXISTS spx_signal_weight_reports (
      id            BIGSERIAL PRIMARY KEY,
      computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lookback_days INTEGER NOT NULL,
      total_obs     INTEGER NOT NULL,
      baseline_pct  NUMERIC,
      report_json   JSONB NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS spx_signal_wt_computed_at
      ON spx_signal_weight_reports (computed_at DESC);

    ALTER TABLE spx_signal_observations
      ADD COLUMN IF NOT EXISTS gates_blocked_json JSONB NOT NULL DEFAULT '[]';

    -- BIE Stage 4 — unified per-alert audit trail (docs/bie/AUDIT-TRAIL-SCHEMA.md). Additive
    -- only: zerodte_setup_log and nighthawk_play_outcomes stay the system of record for their
    -- own UI/grading logic; this table is BIE's/admin's cross-product query surface, written
    -- ALONGSIDE those existing writes in a later PR, not a replacement for them. No consumers
    -- read this table yet — this migration alone cannot regress anything by construction.
    CREATE TABLE IF NOT EXISTS alert_audit_log (
      id                BIGSERIAL PRIMARY KEY,
      alert_type        TEXT NOT NULL,          -- 'zerodte' | 'nighthawk'
      source_table      TEXT NOT NULL,          -- 'zerodte_setup_log' | 'nighthawk_play_outcomes'
      source_key        JSONB NOT NULL,         -- source PK, e.g. {"session_date":"...","ticker":"AAPL"}
      ticker            TEXT NOT NULL,
      direction         TEXT,
      fired_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confidence_score  NUMERIC,                -- the DETERMINISTIC score, never a model self-grade
      confidence_label  TEXT,
      trigger_reason    TEXT,
      decision_trace    JSONB,                  -- ordered [{check, passed, value, threshold}]
      input_snapshot    JSONB,                  -- specific values read at decision time
      source_apis       JSONB,                  -- [{provider, endpoint, rate_limited, ok}]
      final_output      JSONB,                  -- the actual member-visible payload
      outcome           TEXT,                   -- mirrors plan_outcome / nighthawk outcome
      outcome_graded_at TIMESTAMPTZ,
      later_correct     BOOLEAN,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_alert_audit_log_fired ON alert_audit_log(fired_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_audit_log_ticker ON alert_audit_log(ticker, fired_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_audit_log_type ON alert_audit_log(alert_type, fired_at DESC);

    -- Dedup for the Night Hawk REJECTED-play write-path (Stage 4 step 4b, not yet wired —
    -- docs/bie/AUDIT-TRAIL-SCHEMA.md). Rejected plays have no upsert-able system-of-record table
    -- to check "have I seen this before" against (unlike zerodte_setup_log / nighthawk_play_
    -- outcomes, which the published-alert write-paths lean on via xmax = 0). A force-rebuild of
    -- an already-published edition resets synthesis_json to null (edition-builder.ts), which
    -- re-triggers generateEditionPlays() and would recompute the same rejections again — this
    -- index lets that future write-path use INSERT ... ON CONFLICT (...) DO NOTHING instead of a
    -- separate read-then-write race. Zero consumers yet (nothing writes alert_type =
    -- 'nighthawk_rejected' rows today) — purely additive, cannot regress anything by construction.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_audit_log_nighthawk_rejected_dedup
      ON alert_audit_log (alert_type, ticker, (source_key->>'edition_for'))
      WHERE alert_type = 'nighthawk_rejected';

    -- SPX Slayer SHADOW-MODE factor observations (docs/audit/FINDINGS.md, "SPX Slayer
    -- shadow signal framework"). Logs what a candidate factor WOULD have contributed
    -- to computeSpxConfluence() (src/lib/spx-signals.ts) WITHOUT it touching the real
    -- score/action/grade — see src/lib/spx-signals-shadow.ts's module doc for the full
    -- rationale (mirrors bie/calibration.ts's "prove it with n>=10 evidence before
    -- acting on it" philosophy). Deliberately GENERIC, not named after its first
    -- factor: factor_name is the discriminator column, so every future shadow factor
    -- (risk-reversal skew + realized vol, UW prediction-market consensus, Benzinga
    -- catalysts, ecosystem cross-instrument agreement) writes into this SAME table
    -- instead of spawning a new one per factor, and a later evidence query can compare
    -- factor_names against each other without a UNION across N tables.
    CREATE TABLE IF NOT EXISTS spx_confluence_shadow_observations (
      id                   BIGSERIAL PRIMARY KEY,
      observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date         DATE NOT NULL,
      factor_name          TEXT NOT NULL,
      available            BOOLEAN NOT NULL,
      implied_weight       NUMERIC NOT NULL,
      direction            TEXT NOT NULL,
      detail               TEXT NOT NULL,
      price_at_observation NUMERIC,
      -- The REAL computeSpxConfluence() score/grade at the same moment this shadow
      -- observation was taken, for later correlation against actual outcomes —
      -- never fed back into the shadow scoring itself.
      actual_score         INTEGER,
      actual_grade         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_spx_confluence_shadow_obs_at
      ON spx_confluence_shadow_observations (observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spx_confluence_shadow_obs_factor
      ON spx_confluence_shadow_observations (factor_name, observed_at DESC);

    -- spx_engine_snapshots (task #108): throttled, state-transition-only log of EVERY
    -- evaluateSpxPlay tick's phase/action/gate outcome (src/lib/spx-play-engine.ts) —
    -- not just committed BUY/SELL/TRIM signals, which is all spx_signal_log above ever
    -- captures. Before this table existed, a gate-blocked entry, a Claude veto, or a
    -- WATCHING/near-miss setup left NO trace anywhere once the next poll tick
    -- overwrote it in memory — "why was the last signal rejected" or "what was the
    -- engine doing at 10:15" was unanswerable after the fact. Deliberately a NEW,
    -- separate table rather than widening spx_signal_log's schema: a rejection/scan
    -- has no committed direction/entry/premium the way a real signal does, so forcing
    -- it into that row shape would mean a wall of nullable signal-only columns here.
    -- Written by maybeLogSpxEngineSnapshot (src/lib/providers/spx-signal-log.ts),
    -- throttled via the SAME platform_meta cursor idiom maybeLogSpxPlay uses above —
    -- one row per distinct phase/action/direction/gates.blocks state, not one row per
    -- poll tick (evaluateSpxPlay runs on every mutate:true poll, effectively every RTH
    -- minute — see spx-evaluator.ts's runSpxEvaluator — so unthrottled writes here
    -- would flood Postgres with near-duplicate rows while the engine idles unchanged).
    CREATE TABLE IF NOT EXISTS spx_engine_snapshots (
      id           BIGSERIAL PRIMARY KEY,
      observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date DATE NOT NULL,
      phase        TEXT NOT NULL,
      action       TEXT NOT NULL,
      direction    TEXT,
      score        INTEGER NOT NULL,
      gates_passed BOOLEAN NOT NULL,
      gates_blocks JSONB NOT NULL DEFAULT '[]',
      thesis       TEXT NOT NULL,
      -- The engine's own as_of (desk.polled_at/desk.as_of at evaluation time) —
      -- kept separate from observed_at (this row's insert time, which lags as_of by
      -- however long the tick took to evaluate) so a caller can tell staleness apart
      -- from write latency.
      as_of        TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_spx_engine_snapshots_observed_at
      ON spx_engine_snapshots (observed_at DESC);

    -- SPX named-playbook shadow observations (Phase 1 evidence — PB-01..08).
    -- Logs what the playbook matcher WOULD have flagged as primary/fired WITHOUT
    -- gating BUY. Throttled at the caller (state-transition cursor) so we get one
    -- row per meaningful playbook shift, not every member poll tick.
    CREATE TABLE IF NOT EXISTS spx_playbook_shadow_observations (
      id                   BIGSERIAL PRIMARY KEY,
      observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date         DATE NOT NULL,
      primary_playbook_id  TEXT,
      regime               TEXT,
      gamma_regime         TEXT,
      price_at_observation NUMERIC,
      engine_action        TEXT NOT NULL,
      engine_score         INTEGER NOT NULL,
      verdicts             JSONB NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_spx_playbook_shadow_obs_at
      ON spx_playbook_shadow_observations (observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spx_playbook_shadow_obs_primary
      ON spx_playbook_shadow_observations (primary_playbook_id, observed_at DESC);

    -- nighthawk_scoring_history (task #129): durable copy of Night Hawk's per-candidate
    -- scoring dossiers, the Night Hawk analogue of spx_engine_snapshots above. scoreCandidate()
    -- (src/lib/nighthawk/scorer.ts) computes a FULL breakdown for every ticker the nightly hunt
    -- considers — flow/tech/pos/news/smart-money/fundamental/short-interest/catalyst sub-scores,
    -- fundamental_block, trading_halt — and edition-builder.ts stages it via saveDossierStaging()
    -- into nighthawk_dossiers_staging DURING the hunt run. But nighthawk_dossiers_staging is a
    -- SCRATCH table: clearNighthawkStaging() deletes it the moment the edition publishes (or the
    -- run collapses to a recap-only fallback), so the existing get_nighthawk_dossier Largo tool
    -- could only answer "why was ticker X scored/excluded tonight" WHILE the run was still in
    -- flight — by the next morning, when a member actually asks, the staging rows were already
    -- gone. This table is a durable copy, archived immediately before every clearNighthawkStaging()
    -- call (see archiveAndClearNighthawkStaging in edition-builder.ts) so the same question stays
    -- answerable indefinitely. UNIQUE(edition_for, ticker) + upsert (not append-only) because a
    -- checkpoint-resumed build can archive the same edition's partial staging more than once as
    -- more tickers get scored across resumes — later archives should supersede earlier ones for
    -- the same ticker, not duplicate them. No throttling needed (unlike spx_engine_snapshots,
    -- which guards against a tight per-minute poll loop): the nightly hunt runs once per night,
    -- and this is a single bulk archive of already-computed rows, not a per-tick write.
    CREATE TABLE IF NOT EXISTS nighthawk_scoring_history (
      id           BIGSERIAL PRIMARY KEY,
      edition_for  DATE NOT NULL,
      ticker       TEXT NOT NULL,
      dossier_json JSONB NOT NULL,
      scored_json  JSONB,
      -- created_at of the staging row this was archived from (when scoreCandidate actually ran),
      -- kept separate from archived_at (when the archive write happened) for the same
      -- staleness-vs-write-latency reason spx_engine_snapshots separates as_of from observed_at.
      staged_at    TIMESTAMPTZ NOT NULL,
      archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (edition_for, ticker)
    );
    CREATE INDEX IF NOT EXISTS idx_nighthawk_scoring_history_edition
      ON nighthawk_scoring_history(edition_for);

    -- zerodte_scan_rejections (task #147): durable near-miss/rejection log for 0DTE
    -- Command's scanner (src/lib/zerodte/board.ts's deriveZeroDteSetups, src/lib/
    -- zerodte/scan.ts's warmZeroDteBoard) — the 0DTE-Command analogue of
    -- spx_engine_snapshots above, for the SEPARATE multi-ticker scanner (NOT SPX
    -- Slayer). deriveZeroDteSetups computes real gate metrics (gross premium,
    -- at-the-ask aggression share, side dominance, OTM%) for every candidate ticker
    -- it aggregates from the HELIX tape and checks them against 4 thresholds
    -- (SETUP_MIN_GROSS/SETUP_MIN_AGGR_SHARE/SETUP_MIN_DOMINANCE/SETUP_MAX_ITM_PCT),
    -- but short-circuits (continue) past any candidate that fails one — before
    -- this table existed nothing was written for a rejected candidate, so "why
    -- didn't ticker X ever hit the Grid board" was unanswerable after the fact.
    -- Committed setups already have a durable record via zerodte_setup_log/
    -- persistZeroDteScan — this table is deliberately the REJECTED half only, never
    -- a duplicate of that one. gate_failed records exactly which of the 4 gates (or
    -- the structural no_dominant_strike guard) stopped the candidate; the numeric
    -- columns are nullable because deriveZeroDteSetups short-circuits BEFORE
    -- computing later-gate metrics — a gross-premium rejection genuinely never
    -- computes aggression/dominance/otm_pct, so those stay null rather than being
    -- fabricated. threshold cites the actual live gate constant at rejection time
    -- (mirrors buildZeroDteAuditRow's same discipline) so a later threshold tune
    -- can't retroactively relabel a historical row. Written by
    -- persistZeroDteRejections (src/lib/zerodte/rejections.ts), throttled to one
    -- row per ticker per DISTINCT (gate_failed, direction) state per session — see
    -- that file's module doc for why this can't reuse spx_engine_snapshots' single-
    -- cursor throttle idiom (many simultaneous candidate tickers, not one
    -- instrument).
    CREATE TABLE IF NOT EXISTS zerodte_scan_rejections (
      id             BIGSERIAL PRIMARY KEY,
      observed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date   DATE NOT NULL,
      ticker         TEXT NOT NULL,
      gate_failed    TEXT NOT NULL,
      threshold      NUMERIC,
      gross_premium  NUMERIC,
      aggression     NUMERIC,
      side_dominance NUMERIC,
      otm_pct        NUMERIC,
      direction      TEXT,
      prints         INTEGER,
      first_seen     TIMESTAMPTZ,
      last_seen      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_zerodte_scan_rejections_observed_at
      ON zerodte_scan_rejections (observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_zerodte_scan_rejections_ticker
      ON zerodte_scan_rejections (ticker, observed_at DESC);

    -- gex_regime_events (task #136): durable log of BlackOut Thermal's GEX
    -- regime/flip/wall-crossing events, detected by computeGexEvents() (src/lib/
    -- providers/polygon-options-gex.ts) on every fresh GEX matrix compute (cache
    -- miss). Before this table existed, computeGexEvents' output only ever lived
    -- on the shared, TTL-capped gex-heatmap:{ticker} matrix cache and the
    -- gex-history:{ticker} intraday positioning-history RING (capped at
    -- GEX_HISTORY_MAX ~24 samples / ~2h, GEX_HISTORY_TTL_SEC ~3h) — once the ring
    -- rotated past a sample or the matrix cache/TTL expired, the event itself was
    -- gone. /api/cron/gex-alerts/route.ts consumes the SAME events array to fire
    -- live push alerts, but only ever writes a Redis DEDUP key on fire
    -- (gex-alert-sent:{ticker}:{type}:{etDate}[:level]) — a record that a push
    -- WAS sent, never a durable record of the event's own before/after values,
    -- and only for the 3-ticker REGIME_WATCHLIST (SPY/SPX/QQQ) + the subset of
    -- event types that are broadcast-worthy. So "at time T, SPY's gamma flip
    -- crossed" or "how many times has NVDA's call wall broken today" was
    -- unanswerable after the fact for ANY ticker, and unanswerable at ALL once
    -- the ring/cache/dedup keys rotated even for the 3 watchlist names.
    -- event_type is one of computeGexEvents' 4 GexEvent.type values
    -- (flip_crossed/wall_broken/regime_flipped/net_gex_sign_flipped); level/
    -- direction/message mirror GexEvent's own fields verbatim (never re-derived);
    -- from_value/to_value are the natural before/after numeric pair for that
    -- event type (spot before/after the crossed level for flip_crossed/
    -- wall_broken; the gamma-flip level at each end for regime_flipped, since
    -- posture there is computed per-end against that end's OWN flip; net GEX
    -- dollars before/after for net_gex_sign_flipped) — see GexEvent's own
    -- from_value/to_value doc comment in polygon-options-gex.ts for exactly
    -- which pair each type carries, and null when an event type has no single
    -- natural numeric pair (never fabricated). detected_at is computeGexEvents'
    -- own "at" (the ISO timestamp of the sample where the cross was detected),
    -- kept separate from observed_at (this row's insert time) for the same
    -- staleness-vs-write-latency reason spx_engine_snapshots separates as_of
    -- from observed_at. Written by persistGexRegimeEvents (src/lib/providers/
    -- gex-regime-events.ts), throttled via its OWN per-(ticker, event
    -- type+direction) platform_meta state-transition cursor — DELIBERATELY
    -- INDEPENDENT of gex-alerts' Redis dedup key (different storage, different
    -- key namespace, different throttle granularity: this one persists EVERY
    -- distinct transition all day, not once per ET-date) so durable history and
    -- live-alert dedup can never suppress each other.
    CREATE TABLE IF NOT EXISTS gex_regime_events (
      id           BIGSERIAL PRIMARY KEY,
      observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date DATE NOT NULL,
      ticker       TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      severity     TEXT NOT NULL,
      message      TEXT NOT NULL,
      level        NUMERIC,
      direction    TEXT,
      from_value   NUMERIC,
      to_value     NUMERIC,
      detected_at  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_gex_regime_events_observed_at
      ON gex_regime_events (observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gex_regime_events_ticker
      ON gex_regime_events (ticker, observed_at DESC);

    -- flow_anomaly_near_misses (task #131): durable near-miss/rejection log for
    -- HELIX's flow-anomaly detector (src/app/api/cron/market-regime-detector/
    -- flow-anomaly-detection.ts's detectFlowAnomalies, route.ts's dedup loop) — the
    -- HELIX analogue of spx_engine_snapshots/zerodte_scan_rejections above, for a
    -- THIRD, separate engine (5-min market-wide flow-anomaly scan, not SPX Slayer's
    -- single-instrument engine or 0DTE Command's multi-ticker setup scanner).
    -- detectFlowAnomalies computes real per-ticker metrics (max single print,
    -- call/put premium totals + skew ratio) for every ticker with recent HELIX
    -- flow, but only ever surfaces an anomaly once it clears a hard threshold
    -- (LARGE_PREMIUM_PRINT >= $2M single print, DIRECTIONAL_FLOW_SKEW >= 10:1 on
    -- $500k+ total premium) — a candidate that falls short left NO trace anywhere.
    -- Note table (NOT view, NOT column) note: this is a genuinely THIRD-different
    -- discard path from the sibling tables' single "gate rejected, continue" shape
    -- — reason distinguishes the TWO structurally different ways a computed
    -- candidate never reaches flow_anomalies: 'BELOW_THRESHOLD' (the metric itself
    -- never cleared the hard threshold; severity is null because the real detector
    -- never assigns one to a candidate that doesn't fire) vs 'DEDUP_SUPPRESSED'
    -- (the candidate DID clear its threshold — it's a fully-formed anomaly with a
    -- real severity — but route.ts's own 15-minute same-type+ticker dedup window
    -- already had a match, so the INSERT into flow_anomalies never ran). Conflating
    -- these two into one reason would make "why didn't X fire" unanswerable in
    -- exactly the two most common follow-up shapes members actually ask ("was it
    -- just below the bar" vs. "did it already fire recently and get suppressed").
    -- metric_value/threshold are cited in the SAME unit the real detector compares
    -- (dollars for LARGE_PREMIUM_PRINT, a ratio for DIRECTIONAL_FLOW_SKEW — see
    -- flow-anomaly-detection.ts's FlowAnomaly.metric_value doc for why the plain
    -- premium column alone is the wrong unit for a skew row). Written by
    -- persistFlowAnomalyNearMisses (src/lib/platform/flow-anomaly-near-misses.ts),
    -- throttled via the SAME per-ticker platform_meta JSON-cursor idiom
    -- persistZeroDteRejections uses (many simultaneous candidate tickers per tick,
    -- not one instrument) — see that file's module doc for the full reasoning.
    CREATE TABLE IF NOT EXISTS flow_anomaly_near_misses (
      id            BIGSERIAL PRIMARY KEY,
      observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      anomaly_type  TEXT NOT NULL,
      ticker        TEXT,
      reason        TEXT NOT NULL,
      metric_value  NUMERIC NOT NULL,
      threshold     NUMERIC NOT NULL,
      premium       NUMERIC,
      direction     TEXT,
      severity      TEXT,
      detail        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_flow_anomaly_near_misses_observed_at
      ON flow_anomaly_near_misses (observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_flow_anomaly_near_misses_ticker
      ON flow_anomaly_near_misses (ticker, observed_at DESC);
  `);

  // God-tier tables (004_god_tier_features.sql) — inlined for ECS standalone cold starts.
  await p.query(`
    CREATE TABLE IF NOT EXISTS market_regime (
      id BIGSERIAL PRIMARY KEY,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      gex_regime TEXT NOT NULL,
      vol_regime TEXT NOT NULL,
      trend_regime TEXT NOT NULL,
      flow_regime TEXT NOT NULL,
      composite TEXT NOT NULL,
      playbook TEXT,
      net_gex NUMERIC,
      iv_percentile NUMERIC,
      above_vwap BOOLEAN,
      flow_ratio NUMERIC,
      raw JSONB
    );
    CREATE INDEX IF NOT EXISTS market_regime_captured_at_idx ON market_regime(captured_at DESC);

    CREATE TABLE IF NOT EXISTS flow_anomalies (
      id BIGSERIAL PRIMARY KEY,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      anomaly_type TEXT NOT NULL,
      ticker TEXT,
      detail TEXT NOT NULL,
      premium NUMERIC,
      direction TEXT,
      severity TEXT NOT NULL,
      raw JSONB
    );
    CREATE INDEX IF NOT EXISTS flow_anomalies_detected_at_idx ON flow_anomalies(detected_at DESC);
    CREATE INDEX IF NOT EXISTS flow_anomalies_severity_idx ON flow_anomalies(severity, detected_at DESC);

    CREATE TABLE IF NOT EXISTS coaching_alerts (
      id BIGSERIAL PRIMARY KEY,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trigger_type TEXT NOT NULL,
      alert_text TEXT NOT NULL,
      urgency TEXT NOT NULL,
      spx_price NUMERIC,
      call_wall NUMERIC,
      put_wall NUMERIC,
      vwap NUMERIC,
      for_longs BOOLEAN DEFAULT true,
      for_shorts BOOLEAN DEFAULT false,
      raw JSONB
    );
    CREATE INDEX IF NOT EXISTS coaching_alerts_generated_at_idx ON coaching_alerts(generated_at DESC);

    CREATE TABLE IF NOT EXISTS platform_briefs (
      id BIGSERIAL PRIMARY KEY,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      brief_date DATE NOT NULL,
      brief_type TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS signal_events (
      id BIGSERIAL PRIMARY KEY,
      fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      signal_source TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      grade TEXT,
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

    CREATE TABLE IF NOT EXISTS signal_outcomes (
      id BIGSERIAL PRIMARY KEY,
      signal_event_id BIGINT REFERENCES signal_events(id) ON DELETE CASCADE,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checkpoint TEXT NOT NULL,
      price_at_checkpoint NUMERIC,
      price_change NUMERIC,
      direction_correct BOOLEAN,
      pnl_pct NUMERIC,
      outcome TEXT
    );
    CREATE INDEX IF NOT EXISTS signal_outcomes_event_idx ON signal_outcomes(signal_event_id, checkpoint);
  `);
  await p.query(`
    ALTER TABLE largo_messages
    ADD COLUMN IF NOT EXISTS tool_results JSONB;
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

async function resetPoolForRetry(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
  pool = null;
  poolInit = null;
}

// Re-entrancy guard: captureError() -> persistErrorEvent() -> dbQuery(INSERT INTO
// error_events...) runs back through this exact function. If the DB is fully down (not
// just the original query failing), that INSERT fails too, which would call
// reportQueryFailure again, which would call captureError again — unbounded recursion.
// Set for the duration of any capture attempt; a dbQuery failure while it's set just logs,
// it never re-enters capture.
let capturingQueryFailure = false;

/** Fire-and-forget capture for a final (non-retryable or retries-exhausted) query failure —
 *  never awaited by the caller, so a fully-down DB can't compound latency on the failing
 *  path. Covers EVERY dbQuery call site in one place instead of auditing each one.
 *
 *  Correction 2026-07-03: this function's own original comment claimed a call-site audit
 *  found zero pre-existing captures, so this couldn't double-count — that audit undercounted
 *  dbQuery call sites (~74 across 32 files, not 19) and missed indirect/route-level wrapping
 *  entirely. Several admin routes' catch-all handlers (recordAdminRouteError,
 *  admin-route-errors.ts) DO independently capture the same failure when it propagates up
 *  uncaught. Marks the error via error-sink.ts's markDbQueryCaptured() so that second capture
 *  site can detect and skip the duplicate — see error-sink.ts and admin-route-errors.ts.
 *  Lazy import mirrors error-sink.ts's own lazy import of db.ts (reverse direction) — avoids
 *  a static circular module graph. */
function reportQueryFailure(text: string, err: unknown): void {
  if (capturingQueryFailure) {
    console.warn("[db] query failed while already reporting a failure — DB likely fully down:", err);
    return;
  }
  capturingQueryFailure = true;
  void import("@/lib/error-sink")
    .then(({ captureError, markDbQueryCaptured }) => {
      markDbQueryCaptured(err);
      const scope = text.replace(/\s+/g, " ").trim().slice(0, 80);
      return captureError(err, { source: "db_query", scope });
    })
    .catch(() => undefined)
    .finally(() => {
      capturingQueryFailure = false;
    });
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) {
  await ensureSchema();
  const maxAttempts = Math.max(1, parseInt(process.env.PG_QUERY_RETRIES ?? "3", 10));
  const baseDelayMs = Math.max(50, parseInt(process.env.PG_QUERY_RETRY_DELAY_MS ?? "250", 10));

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await (await getPool()).query<T>(text, values);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1 && isTransientPgError(err)) {
        console.warn(
          `[db] transient query error (attempt ${attempt + 1}/${maxAttempts}):`,
          err instanceof Error ? err.message : err
        );
        await resetPoolForRetry();
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)));
        continue;
      }
      reportQueryFailure(text, err);
      throw err;
    }
  }
  reportQueryFailure(text, lastError);
  throw lastError;
}

/** GDPR cleanup when Clerk sends user.deleted — removes all rows keyed by clerk_user_id. */
export async function deleteUserDataForClerkId(clerkUserId: string): Promise<{
  users: number;
  largo_sessions: number;
  user_journal: number;
  push_subscriptions: number;
}> {
  if (!clerkUserId) {
    return { users: 0, largo_sessions: 0, user_journal: 0, push_subscriptions: 0 };
  }
  await ensureSchema();
  const client = await (await getPool()).connect();
  try {
    await client.query("BEGIN");
    const largo = await client.query(
      `DELETE FROM largo_sessions WHERE user_id = $1`,
      [clerkUserId]
    );
    const journal = await client.query(
      `DELETE FROM user_journal WHERE user_id = $1`,
      [clerkUserId]
    );
    let pushDeleted = 0;
    try {
      const push = await client.query(
        `DELETE FROM push_subscriptions WHERE user_id = $1`,
        [clerkUserId]
      );
      pushDeleted = push.rowCount ?? 0;
    } catch {
      // push_subscriptions is lazily created — table may not exist yet.
    }
    const users = await client.query(
      `DELETE FROM users WHERE clerk_user_id = $1`,
      [clerkUserId]
    );
    await client.query("COMMIT");
    return {
      users: users.rowCount ?? 0,
      largo_sessions: largo.rowCount ?? 0,
      user_journal: journal.rowCount ?? 0,
      push_subscriptions: pushDeleted,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Acquire a pool client for manual transaction management (caller must release). */
export async function dbClient() {
  await ensureSchema();
  return (await getPool()).connect();
}

export async function pingDatabaseConnectivity(): Promise<{
  ok: boolean;
  error?: string;
  mode?: string;
}> {
  if (!dbConfigured()) return { ok: false, error: "DATABASE_URL not set" };
  try {
    await (await getPool()).query("SELECT 1");
    return { ok: true, mode: activeMode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, mode: activeMode };
  }
}

/** Full ping — connectivity + schema migrations (admin dashboards, validators). */
export async function pingDatabase(): Promise<{
  ok: boolean;
  error?: string;
  mode?: string;
}> {
  const conn = await pingDatabaseConnectivity();
  if (!conn.ok) return conn;
  try {
    await ensureSchema();
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
  /** UW alert time (created_at). '' (empty) when UW gave no real time — must NOT be coerced to
   *  now()/inserted_at, or FlowFeed sorts the timestampless row to the top as "LIVE". An empty
   *  string makes the client's alertedAtMs exclude it from the LIVE badge + newest-first sort,
   *  matching the SSE path + the parser's '' sentinel (gap #6). */
  alerted_at: string;
  /** Real created_at from UW; null when unknown (do NOT fall back to inserted_at). */
  event_at?: string | null;
  dte?: number;
  /** Per-contract fill price from the UW alert payload (what the print paid). */
  fill_price?: number;
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
  /**
   * Row ordering (and thus which rows survive the LIMIT cap):
   *  - "premium" (default): biggest prints first — for the net-premium leaderboard,
   *    biggest-prints brief, and strike-stack consumers that must capture the largest
   *    prints within the cap. This preserves the historical behavior of every existing
   *    caller, so the split is non-breaking.
   *  - "recent": newest first — for the REAL-TIME TAPE, which must show the newest prints,
   *    not the top-N-by-premium reshuffled by the client (HELIX tape audit P0).
   */
  order?: "premium" | "recent";
  /**
   * Scope the tape to expiries within N days (ET calendar), 0-N inclusive. The 0DTE
   * board MUST pass this: without it, "premium"-ordered rows are ranked across ALL
   * expiries, and on a heavy tape day the top-LIMIT fills with far-dated whale prints
   * — squeezing every (naturally smaller) 0-1DTE print out of the result entirely.
   * Live-reproduced 2026-07-02: a $3.1M six-print AAPL 0DTE stack produced zero
   * setups because the window's 400th-largest print was >$500k across all expiries.
   */
  max_dte?: number;
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
  if (params.max_dte != null && params.max_dte >= 0) {
    // ET calendar date to match the SELECT's dte expression; BETWEEN 0 AND N also
    // drops already-expired rows at the source (belt to the derive-side guard).
    clauses.push(
      `(expiry - (NOW() AT TIME ZONE 'America/New_York')::date) BETWEEN 0 AND $${i++}`
    );
    values.push(Math.floor(params.max_dte));
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const limit = params.limit ?? 5000;
  values.push(limit);

  // Two hardcoded ORDER BY literals (no user input interpolated) — recency for the live
  // tape, premium for everything else. "recent" sorts by the real alert time (created_at,
  // inserted_at fallback) DESC so the tape shows the NEWEST prints; rows with no timestamp
  // sort last (NULLS LAST) instead of pinning to the top.
  const orderBy =
    params.order === "recent"
      ? `ORDER BY COALESCE(created_at, inserted_at) DESC NULLS LAST`
      : `ORDER BY COALESCE(total_premium, 0) DESC NULLS LAST`;

  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT ticker,
           COALESCE(total_premium, 0) AS premium,
           option_type,
           TO_CHAR(expiry, 'YYYY-MM-DD') AS expiry,
           strike,
           CASE
             WHEN LOWER(option_type) LIKE 'c%' THEN 'bullish'
             WHEN LOWER(option_type) LIKE 'p%' THEN 'bearish'
             ELSE 'unknown'
           END AS direction,
           COALESCE(score, 0) AS score,
           CASE
             WHEN COALESCE(total_premium, 0) >= 1000000 THEN 'whale'
             WHEN expiry = (NOW() AT TIME ZONE 'America/New_York')::date THEN '0dte'
             ELSE 'stock'
           END AS route,
           created_at AS alerted_at,
           created_at AS event_at,
           -- DTE against the ET calendar date (not UTC CURRENT_DATE) so labels match the rest of
           -- the app and don't go off-by-one/negative in the 8pm–midnight ET window.
           (expiry - (NOW() AT TIME ZONE 'America/New_York')::date) AS dte,
           NULLIF(COALESCE(
             raw_payload->>'alert_rule',
             raw_payload->>'rule_name'
           ), '') AS alert_rule,
           (raw_payload->>'ask_side_pct')::numeric AS ask_pct,
           -- UW's WS flow_alerts feed sends these fields as JSON *strings* (e.g. "590.24")
           -- rather than JSON numbers on a large share of rows (live-verified: ~48% of
           -- HELIX rows), which the old jsonb_typeof = 'number' gate silently dropped to
           -- NULL. Accept a numeric-looking string too, but only cast when the text
           -- actually matches a number -- an unconditional numeric cast on a stray
           -- non-numeric string (e.g. "N/A") would throw and fail the entire query, not
           -- just null out that one row.
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'underlying_last') = 'number'
                    OR (raw_payload->>'underlying_last') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'underlying_last')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'underlying_price') = 'number'
                    OR (raw_payload->>'underlying_price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'underlying_price')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'stock_price') = 'number'
                    OR (raw_payload->>'stock_price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'stock_price')::numeric END
           ) AS underlying_price,
           -- Per-contract fill from the alert ('price'); same string-tolerant cast as above.
           CASE WHEN jsonb_typeof(raw_payload->'price') = 'number'
                  OR (raw_payload->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (raw_payload->>'price')::numeric END AS fill_price,
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'open_interest') = 'number'
                    OR (raw_payload->>'open_interest') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'open_interest')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'oi') = 'number'
                    OR (raw_payload->>'oi') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'oi')::numeric END
           ) AS open_interest,
           COALESCE(
             CASE WHEN jsonb_typeof(raw_payload->'iv') = 'number'
                    OR (raw_payload->>'iv') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'iv')::numeric END,
             CASE WHEN jsonb_typeof(raw_payload->'implied_volatility') = 'number'
                    OR (raw_payload->>'implied_volatility') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  THEN (raw_payload->>'implied_volatility')::numeric END
           ) AS implied_volatility
    FROM flow_alerts
    ${where}
    ${orderBy}
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
    // Gap #6: when created_at is null UW gave no real alert time — return '' (the parser/SSE
    // sentinel), never now()/inserted_at. FlowFeed's alertedAtMs then excludes the row from the
    // LIVE badge + newest-first sort instead of faking a fresh, top-of-tape print.
    alerted_at: row.alerted_at ? new Date(String(row.alerted_at)).toISOString() : "",
    event_at: row.event_at ? new Date(String(row.event_at)).toISOString() : null,
    dte: row.dte != null ? Number(row.dte) : undefined,
    alert_rule: row.alert_rule ? String(row.alert_rule) : undefined,
    ask_pct: row.ask_pct != null ? Number(row.ask_pct) : undefined,
    fill_price: row.fill_price != null ? Number(row.fill_price) : undefined,
    underlying_price: row.underlying_price != null ? Number(row.underlying_price) : undefined,
    open_interest: row.open_interest != null ? Number(row.open_interest) : undefined,
    implied_volatility: row.implied_volatility != null ? Number(row.implied_volatility) : undefined,
    otm_pct: (() => {
      if (row.underlying_price != null) {
        const stock = Number(row.underlying_price);
        const k     = Number(row.strike ?? 0);
        if (stock > 0 && k > 0) {
          // Gap #6: only compute OTM% for a real call/put. An UNKNOWN/typeless row would
          // otherwise silently take the put branch (stock - k) and print a bogus OTM%; leave
          // it undefined so the tape omits the chip rather than mislabeling it.
          const opt = String(row.option_type ?? "").toLowerCase();
          if (!opt.startsWith("c") && !opt.startsWith("p")) return undefined;
          const isCall = opt.startsWith("c");
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

/**
 * Normalize a pg DATE column to a clean ISO `YYYY-MM-DD` string (#77 Bug 1).
 *
 * node-postgres returns DATE columns as JS Date objects by default (no setTypeParser override here),
 * so `String(r.edition_for).slice(0,10)` yields garbage like "Mon Jun 29" — which the client then
 * fed to `new Date("Mon Jun 29T12:00:00")` → Invalid Date → the "FOR INVALID DATE" headline. Handle
 * BOTH shapes: a Date object (read its UTC Y-M-D — DATE has no timezone, midnight-UTC is the day) and
 * an already-ISO string (slice). Falls back to the raw stringified first 10 chars only if neither
 * matches, so callers always get a stable value.
 */
function isoDateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? "");
  // Already ISO (e.g. "2026-06-29" or "2026-06-29T00:00:00.000Z") — take the date part.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // A stringified Date ("Mon Jun 29 2026 …") — re-parse to recover the ISO date.
  const reparsed = new Date(s);
  if (!Number.isNaN(reparsed.getTime())) return reparsed.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

/**
 * Normalize an UNTRUSTED inbound date string to a clean ISO `YYYY-MM-DD`, or null if it is not a safe
 * date (#77 Bug 1, inbound twin). Use this on any value bound for a `$n::date` parameter: a non-ISO
 * string (e.g. the legacy year-stripped `String(Date).slice(0,10)` label "Mon Jun 29") makes Postgres
 * throw `invalid input syntax for type date`, which surfaces as a 502 + error-sink record for what is
 * really bad client input. Accept an already-ISO value as-is; recover a stringified Date that still
 * carries a 4-digit year; reject a yearless/garbage label (a reparse would silently query the wrong
 * year). The inverse of {@link isoDateString} (which normalizes outbound DATE columns to ISO).
 */
export function normalizeIsoDateInput(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Already ISO-shaped — round-trip through Date to reject structurally-ISO-but-invalid values
  // (e.g. "2026-13-45", "2026-02-30") that would still throw at `$1::date`.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }
  // A stringified Date that still carries a 4-digit year (e.g. "Mon Jun 29 2026 …") — recover it.
  if (/\b\d{4}\b/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
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

/**
 * Persists one SHADOW-MODE factor observation (src/lib/spx-signals-shadow.ts).
 * Same idiom as insertSpxSignalLog above — no ON CONFLICT dedup, since unlike
 * spx_signal_log (one row per NEW play) this is expected to write one row per
 * factor per evaluation tick, and later evidence-gathering wants every tick,
 * not just changes.
 */
export async function insertShadowFactorObservation(row: {
  session_date: string;
  factor_name: string;
  available: boolean;
  implied_weight: number;
  direction: string;
  detail: string;
  price_at_observation: number | null;
  actual_score: number | null;
  actual_grade: string | null;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO spx_confluence_shadow_observations (
      session_date, factor_name, available, implied_weight, direction, detail,
      price_at_observation, actual_score, actual_grade
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      row.session_date,
      row.factor_name,
      row.available,
      row.implied_weight,
      row.direction,
      row.detail,
      row.price_at_observation,
      row.actual_score,
      row.actual_grade,
    ]
  );
}

/**
 * Persists one retrospective engine-state snapshot (task #108,
 * src/lib/providers/spx-signal-log.ts's maybeLogSpxEngineSnapshot). Same
 * "always insert, caller already decided whether to call" idiom as
 * insertShadowFactorObservation above — the throttle (only write on a real
 * phase/action/gates.blocks state transition) lives in the caller, not here,
 * so this function itself has no ON CONFLICT / dedup logic.
 */
export async function insertSpxEngineSnapshot(row: {
  session_date: string;
  phase: string;
  action: string;
  direction: string | null;
  score: number;
  gates_passed: boolean;
  gates_blocks: string[];
  thesis: string;
  as_of: string | null;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO spx_engine_snapshots (
      session_date, phase, action, direction, score,
      gates_passed, gates_blocks, thesis, as_of
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
    `,
    [
      row.session_date,
      row.phase,
      row.action,
      row.direction,
      row.score,
      row.gates_passed,
      JSON.stringify(row.gates_blocks ?? []),
      row.thesis,
      row.as_of,
    ]
  );
}

export async function fetchRecentSpxEngineSnapshots(limit = 50): Promise<
  Array<{
    id: number;
    observed_at: string;
    session_date: string;
    phase: string;
    action: string;
    direction: string | null;
    score: number;
    gates_passed: boolean;
    gates_blocks: unknown;
    thesis: string;
    as_of: string | null;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, observed_at, session_date, phase, action, direction, score,
           gates_passed, gates_blocks, thesis, as_of
    FROM spx_engine_snapshots
    ORDER BY observed_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    observed_at: String(r.observed_at),
    session_date: String(r.session_date),
    phase: String(r.phase),
    action: String(r.action),
    direction: r.direction != null ? String(r.direction) : null,
    score: Number(r.score),
    gates_passed: Boolean(r.gates_passed),
    gates_blocks: r.gates_blocks,
    thesis: String(r.thesis),
    as_of: r.as_of != null ? String(r.as_of) : null,
  }));
}

/** Persists one throttled playbook-shadow state transition (Phase 1 evidence). */
export async function insertPlaybookShadowObservation(row: {
  session_date: string;
  primary_playbook_id: string | null;
  regime: string | null;
  gamma_regime: string | null;
  price_at_observation: number | null;
  engine_action: string;
  engine_score: number;
  verdicts: unknown;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO spx_playbook_shadow_observations (
      session_date, primary_playbook_id, regime, gamma_regime,
      price_at_observation, engine_action, engine_score, verdicts
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,
    [
      row.session_date,
      row.primary_playbook_id,
      row.regime,
      row.gamma_regime,
      row.price_at_observation,
      row.engine_action,
      row.engine_score,
      JSON.stringify(row.verdicts ?? []),
    ]
  );
}

export async function fetchPlaybookShadowObservationsForSession(
  sessionDate: string,
  limit = 200
): Promise<
  Array<{
    id: number;
    observed_at: string;
    primary_playbook_id: string | null;
    regime: string | null;
    gamma_regime: string | null;
    price_at_observation: number | null;
    engine_action: string;
    engine_score: number;
    verdicts: unknown;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, observed_at, primary_playbook_id, regime, gamma_regime,
           price_at_observation, engine_action, engine_score, verdicts
    FROM spx_playbook_shadow_observations
    WHERE session_date = $1
    ORDER BY observed_at DESC
    LIMIT $2
    `,
    [sessionDate, limit]
  );
  return res.rows;
}

/**
 * Persists one 0DTE Command near-miss/rejection row (task #147,
 * src/lib/zerodte/rejections.ts's persistZeroDteRejections). Same "always insert,
 * caller already decided whether to call" idiom as insertSpxEngineSnapshot above —
 * the throttle (only write on a real per-ticker gate_failed/direction state
 * transition) lives in the caller, not here, so this function itself has no ON
 * CONFLICT / dedup logic. Singular (one row, not a batch) because a scan cycle's
 * rejection count is bounded by the candidate universe (single digits to low
 * tens) — the caller loops this per changed ticker rather than needing a
 * multi-row statement.
 */
export async function insertZeroDteScanRejection(row: {
  session_date: string;
  ticker: string;
  gate_failed: string;
  threshold: number | null;
  gross_premium: number;
  aggression: number | null;
  side_dominance: number | null;
  otm_pct: number | null;
  direction: string | null;
  prints: number;
  first_seen: string | null;
  last_seen: string | null;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO zerodte_scan_rejections (
      session_date, ticker, gate_failed, threshold, gross_premium,
      aggression, side_dominance, otm_pct, direction, prints,
      first_seen, last_seen
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `,
    [
      row.session_date,
      row.ticker,
      row.gate_failed,
      row.threshold,
      row.gross_premium,
      row.aggression,
      row.side_dominance,
      row.otm_pct,
      row.direction,
      row.prints,
      row.first_seen,
      row.last_seen,
    ]
  );
}

export async function fetchZeroDteScanRejections(opts?: { ticker?: string; limit?: number }): Promise<
  Array<{
    id: number;
    observed_at: string;
    session_date: string;
    ticker: string;
    gate_failed: string;
    threshold: number | null;
    gross_premium: number;
    aggression: number | null;
    side_dominance: number | null;
    otm_pct: number | null;
    direction: string | null;
    prints: number | null;
    first_seen: string | null;
    last_seen: string | null;
  }>
> {
  await ensureSchema();
  const limit = opts?.limit ?? 50;
  const ticker = opts?.ticker?.toUpperCase();
  const cols = `id, observed_at, session_date, ticker, gate_failed, threshold,
           gross_premium, aggression, side_dominance, otm_pct, direction, prints,
           first_seen, last_seen`;
  const res = ticker
    ? await (await getPool()).query(
        `SELECT ${cols} FROM zerodte_scan_rejections WHERE ticker = $1 ORDER BY observed_at DESC LIMIT $2`,
        [ticker, limit]
      )
    : await (await getPool()).query(
        `SELECT ${cols} FROM zerodte_scan_rejections ORDER BY observed_at DESC LIMIT $1`,
        [limit]
      );
  return res.rows.map((r) => ({
    id: Number(r.id),
    observed_at: String(r.observed_at),
    session_date: String(r.session_date),
    ticker: String(r.ticker),
    gate_failed: String(r.gate_failed),
    threshold: r.threshold != null ? Number(r.threshold) : null,
    gross_premium: r.gross_premium != null ? Number(r.gross_premium) : 0,
    aggression: r.aggression != null ? Number(r.aggression) : null,
    side_dominance: r.side_dominance != null ? Number(r.side_dominance) : null,
    otm_pct: r.otm_pct != null ? Number(r.otm_pct) : null,
    direction: r.direction != null ? String(r.direction) : null,
    prints: r.prints != null ? Number(r.prints) : null,
    first_seen: r.first_seen != null ? String(r.first_seen) : null,
    last_seen: r.last_seen != null ? String(r.last_seen) : null,
  }));
}

/**
 * Persists one GEX regime-transition row (task #136,
 * src/lib/providers/gex-regime-events.ts's persistGexRegimeEvents). Same "always
 * insert, caller already decided whether to call" idiom as
 * insertZeroDteScanRejection/insertSpxEngineSnapshot above — the throttle (only
 * write on a real per-(ticker, event type+direction) state transition) lives in
 * the caller, not here.
 */
export async function insertGexRegimeEvent(row: {
  session_date: string;
  ticker: string;
  event_type: string;
  severity: string;
  message: string;
  level: number | null;
  direction: string | null;
  from_value: number | null;
  to_value: number | null;
  detected_at: string | null;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO gex_regime_events (
      session_date, ticker, event_type, severity, message,
      level, direction, from_value, to_value, detected_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      row.session_date,
      row.ticker,
      row.event_type,
      row.severity,
      row.message,
      row.level,
      row.direction,
      row.from_value,
      row.to_value,
      row.detected_at,
    ]
  );
}

export async function fetchGexRegimeEventRows(opts?: { ticker?: string; limit?: number }): Promise<
  Array<{
    id: number;
    observed_at: string;
    session_date: string;
    ticker: string;
    event_type: string;
    severity: string;
    message: string;
    level: number | null;
    direction: string | null;
    from_value: number | null;
    to_value: number | null;
    detected_at: string | null;
  }>
> {
  await ensureSchema();
  const limit = opts?.limit ?? 50;
  const ticker = opts?.ticker?.toUpperCase();
  const cols = `id, observed_at, session_date, ticker, event_type, severity, message,
           level, direction, from_value, to_value, detected_at`;
  const res = ticker
    ? await (await getPool()).query(
        `SELECT ${cols} FROM gex_regime_events WHERE ticker = $1 ORDER BY observed_at DESC LIMIT $2`,
        [ticker, limit]
      )
    : await (await getPool()).query(
        `SELECT ${cols} FROM gex_regime_events ORDER BY observed_at DESC LIMIT $1`,
        [limit]
      );
  return res.rows.map((r) => ({
    id: Number(r.id),
    observed_at: String(r.observed_at),
    session_date: String(r.session_date),
    ticker: String(r.ticker),
    event_type: String(r.event_type),
    severity: String(r.severity),
    message: String(r.message),
    level: r.level != null ? Number(r.level) : null,
    direction: r.direction != null ? String(r.direction) : null,
    from_value: r.from_value != null ? Number(r.from_value) : null,
    to_value: r.to_value != null ? Number(r.to_value) : null,
    detected_at: r.detected_at != null ? String(r.detected_at) : null,
  }));
}

/**
 * Persists one HELIX flow-anomaly near-miss/rejection row (task #131,
 * src/lib/platform/flow-anomaly-near-misses.ts's persistFlowAnomalyNearMisses).
 * Same "always insert, caller already decided whether/how to throttle" idiom as
 * insertZeroDteScanRejection above — this function has no ON CONFLICT/dedup logic
 * of its own. Singular (one row, not a batch) for the same reason: a single 5-min
 * detector tick's near-miss count is bounded by the candidate universe.
 */
export async function insertFlowAnomalyNearMiss(row: {
  anomaly_type: string;
  ticker: string | null;
  reason: string;
  metric_value: number;
  threshold: number;
  premium: number | null;
  direction: string | null;
  severity: string | null;
  detail: string;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `
    INSERT INTO flow_anomaly_near_misses (
      anomaly_type, ticker, reason, metric_value, threshold,
      premium, direction, severity, detail
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      row.anomaly_type,
      row.ticker,
      row.reason,
      row.metric_value,
      row.threshold,
      row.premium,
      row.direction,
      row.severity,
      row.detail,
    ]
  );
}

export async function fetchFlowAnomalyNearMisses(opts?: { ticker?: string; limit?: number }): Promise<
  Array<{
    id: number;
    observed_at: string;
    anomaly_type: string;
    ticker: string | null;
    reason: string;
    metric_value: number;
    threshold: number;
    premium: number | null;
    direction: string | null;
    severity: string | null;
    detail: string;
  }>
> {
  await ensureSchema();
  const limit = opts?.limit ?? 50;
  const ticker = opts?.ticker?.toUpperCase();
  const cols = `id, observed_at, anomaly_type, ticker, reason, metric_value,
           threshold, premium, direction, severity, detail`;
  const res = ticker
    ? await (await getPool()).query(
        `SELECT ${cols} FROM flow_anomaly_near_misses WHERE ticker = $1 ORDER BY observed_at DESC LIMIT $2`,
        [ticker, limit]
      )
    : await (await getPool()).query(
        `SELECT ${cols} FROM flow_anomaly_near_misses ORDER BY observed_at DESC LIMIT $1`,
        [limit]
      );
  return res.rows.map((r) => ({
    id: Number(r.id),
    observed_at: String(r.observed_at),
    anomaly_type: String(r.anomaly_type),
    ticker: r.ticker != null ? String(r.ticker) : null,
    reason: String(r.reason),
    metric_value: Number(r.metric_value),
    threshold: Number(r.threshold),
    premium: r.premium != null ? Number(r.premium) : null,
    direction: r.direction != null ? String(r.direction) : null,
    severity: r.severity != null ? String(r.severity) : null,
    detail: String(r.detail),
  }));
}

/**
 * Reads the flow_anomalies table (migration 004_god_tier_features.sql) — the
 * COMMITTED half of HELIX's anomaly pipeline: every LARGE_PREMIUM_PRINT /
 * DIRECTIONAL_FLOW_SKEW candidate that cleared detectFlowAnomalies' real
 * threshold AND survived route.ts's 15-min same-type+ticker dedup window (see
 * flow-anomaly-detection.ts's module doc). Plain SELECT, no new writer — the
 * market-regime-detector cron (route.ts) is already the sole writer.
 *
 * Task #134's admin-helix-health.ts pairs this with fetchFlowAnomalyNearMisses
 * (task #131, the REJECTED half) using the SAME committed/rejected-union
 * pattern admin-zerodte-health.ts already established for
 * zerodte_setup_log/zerodte_scan_rejections — this is that pattern's THIRD
 * instance, after 0DTE Command and (implicitly) SPX Slayer's engine snapshots.
 */
export type FlowAnomalyRow = {
  id: number;
  detected_at: string;
  anomaly_type: string;
  ticker: string | null;
  detail: string;
  premium: number | null;
  direction: string | null;
  severity: string | null;
};

export async function fetchFlowAnomalies(opts?: { limit?: number }): Promise<FlowAnomalyRow[]> {
  await ensureSchema();
  const limit = opts?.limit ?? 500;
  const res = await (await getPool()).query(
    `SELECT id, detected_at, anomaly_type, ticker, detail, premium, direction, severity
     FROM flow_anomalies ORDER BY detected_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    detected_at: String(r.detected_at),
    anomaly_type: String(r.anomaly_type),
    ticker: r.ticker != null ? String(r.ticker) : null,
    detail: String(r.detail),
    premium: r.premium != null ? Number(r.premium) : null,
    direction: r.direction != null ? String(r.direction) : null,
    severity: r.severity != null ? String(r.severity) : null,
  }));
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
  playbook_id?: string | null;
} | null> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, session_date, direction, entry_price, entry_score, stop, target, grade, headline,
           trim_done, mfe_pts, mae_pts, opened_at, status,
           option_strike, option_type, option_label, option_premium, playbook_id
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
    session_date: isoDateString(r.session_date),
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
    playbook_id: r.playbook_id != null ? String(r.playbook_id) : null,
  };
}

/** Today's committed play counts — hydrates session meta after deploy/restart. */
export async function fetchTodaySpxSessionCounts(
  sessionDate: string
): Promise<{ entries: number; losses: number }> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM spx_open_play WHERE session_date = $1::date) AS entries,
      (SELECT COUNT(*)::int FROM spx_play_outcomes
        WHERE session_date = $1::date AND outcome = 'loss') AS losses
    `,
    [sessionDate]
  );
  const r = res.rows[0];
  return {
    entries: Number(r?.entries ?? 0),
    losses: Number(r?.losses ?? 0),
  };
}

export async function insertOpenSpxPlay(
  row: {
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
    playbook_id?: string | null;
  },
  outcome?: {
    entry_path: string;
    score: number;
    confidence: number;
    factors: unknown;
    confirmations: unknown;
    mtf: unknown;
    claude: unknown;
    option_ticket: unknown;
    playbook_id?: string | null;
  }
): Promise<{ id: number; created: boolean }> {
  await ensureSchema();
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Close any prior open play and record a 'superseded' outcome row so it appears
    // in the track record (without this, the force-closed play would be silently dropped).
    const closed = await client.query<{ id: string }>(
      `UPDATE spx_open_play SET status = 'closed', closed_at = NOW()
       WHERE session_date = $1::date AND status = 'open'
       RETURNING id`,
      [row.session_date]
    );
    for (const prev of closed.rows) {
      await client.query(
        `UPDATE spx_play_outcomes
         SET outcome = 'superseded', exit_action = 'force_close', closed_at = NOW()
         WHERE open_play_id = $1 AND outcome = 'open'`,
        [prev.id]
      );
    }
    try {
      const res = await client.query<{ id: string }>(
        `
    INSERT INTO spx_open_play (
      session_date, direction, entry_price, entry_score, stop, target, grade, headline, opened_at, status,
      option_strike, option_type, option_label, option_premium, playbook_id
    )
    VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12,$13,$14)
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
          row.playbook_id ?? null,
        ]
      );
      const openId = Number(res.rows[0]?.id ?? 0);
      if (outcome && openId > 0) {
        const outcomeRes = await client.query<{ id: string }>(
          `
    INSERT INTO spx_play_outcomes (
      open_play_id, session_date, direction, entry_path, grade, score, confidence,
      entry_price, stop, target, headline, factors, confirmations, mtf, claude,
      option_ticket, opened_at, outcome, playbook_id
    )
    VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,'open',$18)
    ON CONFLICT (open_play_id) WHERE outcome = 'open' DO NOTHING
    RETURNING id
    `,
          [
            openId,
            row.session_date,
            row.direction,
            outcome.entry_path,
            row.grade,
            outcome.score,
            outcome.confidence,
            row.entry_price,
            row.stop,
            row.target,
            row.headline,
            JSON.stringify(outcome.factors ?? []),
            JSON.stringify(outcome.confirmations ?? null),
            JSON.stringify(outcome.mtf ?? null),
            JSON.stringify(outcome.claude ?? null),
            JSON.stringify(outcome.option_ticket ?? null),
            row.opened_at,
            outcome.playbook_id ?? row.playbook_id ?? null,
          ]
        );
        if (!outcomeRes.rows[0]?.id) {
          throw new Error(
            `spx_play_outcomes entry missing after open for open_play_id=${openId}`
          );
        }
      }
      await client.query("COMMIT");
      return { id: openId, created: true };
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

function mapPlayOutcomeRow(r: QueryResultRow): import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeRow {
  return {
    id: Number(r.id),
    open_play_id: Number(r.open_play_id),
    session_date: isoDateString(r.session_date),
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
      r.exit_action != null ? (String(r.exit_action) as import("@/features/spx/lib/spx-play-outcomes").PlayExitAction) : null,
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
): Promise<number> {
  await ensureSchema();
  const res = await (db ?? await getPool()).query(
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
  // rowCount lets the recorder detect the silent "play closed but no outcome row
  // to grade" case (the empty-ledger bug). null-coalesce for driver safety.
  return res.rowCount ?? 0;
}

/**
 * Lifecycle-health counts for the track-record data-correctness verifier.
 * - open_play_outcomes: rows in spx_play_outcomes still outcome='open' (recorded entries
 *   awaiting a close grade). >0 with 0 closed == opens record but closes don't fire.
 * - ever_opened_outcomes: total rows ever written to spx_play_outcomes (any outcome).
 *   0 here while spx_open_play has rows == the entry-INSERT is failing (empty-ledger bug).
 * - open_plays: rows in spx_open_play (the engine's own open-position table). >0 while
 *   ever_opened_outcomes==0 is the smoking gun that recordPlayEntry is throwing.
 */
export async function fetchPlayLifecycleCounts(): Promise<{
  open_play_outcomes: number;
  ever_opened_outcomes: number;
  open_plays: number;
}> {
  await ensureSchema();
  const pool = await getPool();
  const [openOutcomes, everOutcomes, openPlays] = await Promise.all([
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM spx_play_outcomes WHERE outcome = 'open'`
    ),
    pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM spx_play_outcomes`),
    pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM spx_open_play`),
  ]);
  return {
    open_play_outcomes: Number(openOutcomes.rows[0]?.n ?? 0),
    ever_opened_outcomes: Number(everOutcomes.rows[0]?.n ?? 0),
    open_plays: Number(openPlays.rows[0]?.n ?? 0),
  };
}

export type UserJournalRow = { open_play_id: number; note: string; tags: string[]; updated_at: string };

function mapUserJournalRow(r: QueryResultRow): UserJournalRow {
  return {
    open_play_id: Number(r.open_play_id),
    note: typeof r.note === "string" ? r.note : "",
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

export async function fetchUserJournalRows(userId: string): Promise<UserJournalRow[]> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `SELECT open_play_id, note, tags, updated_at FROM user_journal WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return res.rows.map(mapUserJournalRow);
}

export async function upsertUserJournalEntry(
  userId: string,
  openPlayId: number,
  note: string,
  tags: string[]
): Promise<UserJournalRow> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    INSERT INTO user_journal (user_id, open_play_id, note, tags, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW())
    ON CONFLICT (user_id, open_play_id)
    DO UPDATE SET note = EXCLUDED.note, tags = EXCLUDED.tags, updated_at = NOW()
    RETURNING open_play_id, note, tags, updated_at
    `,
    [userId, openPlayId, note, JSON.stringify(tags)]
  );
  return mapUserJournalRow(res.rows[0]!);
}

export async function deleteUserJournalEntry(userId: string, openPlayId: number): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `DELETE FROM user_journal WHERE user_id = $1 AND open_play_id = $2`,
    [userId, openPlayId]
  );
}

export async function fetchClosedPlayOutcomes(limit = 500): Promise<
  import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeRow[]
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
  import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeRow[]
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
    session_date: isoDateString(r.session_date),
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
  // Guard the `$1::date` cast against untrusted callers (#77 Bug 1, inbound twin): a non-ISO value
  // (e.g. the legacy "Mon Jun 29" label) would make Postgres throw rather than miss. Treat garbage as
  // "no such edition" (null) so callers degrade gracefully instead of 502-ing into the error sink.
  const normalized = normalizeIsoDateInput(editionFor);
  if (!normalized) return null;
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT edition_for, session_date, published_at,
           recap_headline, recap_summary, market_recap, plays, meta
    FROM nighthawk_editions
    WHERE edition_for = $1::date
    LIMIT 1
    `,
    [normalized]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    edition_for: isoDateString(r.edition_for),
    session_date: isoDateString(r.session_date),
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
    edition_for: isoDateString(r.edition_for),
    session_date: isoDateString(r.session_date),
    published_at: new Date(String(r.published_at)).toISOString(),
    recap_headline: r.recap_headline != null ? String(r.recap_headline) : null,
    recap_summary: r.recap_summary != null ? String(r.recap_summary) : null,
    market_recap: (r.market_recap as Record<string, unknown>) ?? {},
    plays: Array.isArray(r.plays) ? r.plays : [],
    meta: (r.meta as Record<string, unknown>) ?? {},
  };
}

// ── 0DTE Command scanner ledger ────────────────────────────────────────────────

export type ZeroDteSetupLogRow = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  top_strike: number | null;
  expiry: string | null;
  score: number;
  score_max: number;
  dossier_score: number | null;
  conviction: string | null;
  gross_premium: number | null;
  spike: boolean;
  underlying_at_flag: number | null;
  underlying_latest: number | null;
  flags_json: Record<string, unknown> | null;
  first_flagged_at: string;
  last_seen_at: string;
  close_price: number | null;
  move_pct: number | null;
  direction_hit: boolean | null;
  graded_at: string | null;
  /** Premium reference the plan was printed at (mark at first flag ?? flow fill). */
  entry_premium: number | null;
  /** Premium-weighted per-contract fill the flow actually paid on the top strike. */
  flow_avg_fill: number | null;
  /** The plan as printed at first flag (entry band, exits, occ) — what gets graded. */
  plan_json: Record<string, unknown> | null;
  /** Plan grade vs the contract's own minute bars: doubled | stopped | time_stop | ungradeable. */
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  /** Live lifecycle: OPEN | HOLD | TRIM | CLOSED (derived + latched by the scanner). */
  status: string | null;
  last_mark: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
};

export type ZeroDteSetupLogUpsert = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  top_strike: number | null;
  expiry: string | null;
  score: number;
  dossier_score: number | null;
  conviction: string | null;
  gross_premium: number | null;
  spike: boolean;
  underlying: number | null;
  flags_json: Record<string, unknown> | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  plan_json: Record<string, unknown> | null;
};

/** Upsert scanner finds — one row per (session, ticker). First sighting pins
 *  underlying_at_flag/first_flagged_at/direction/top_strike/expiry/entry_premium/
 *  flow_avg_fill/plan_json forever (that's the exact contract+price that gets
 *  graded and shown as the ledger's entry); later scans only refresh conviction/
 *  scoring signals (score, dossier_score, conviction, gross_premium, spike,
 *  underlying_latest, flags_json) and ratchet score_max.
 *
 *  Returns the tickers that were a FRESH INSERT this call (first flag of the
 *  session), detected via the `xmax = 0` Postgres idiom (xmax is unset on a
 *  brand-new row; ON CONFLICT DO UPDATE sets it) — so callers can write a
 *  Stage 4 audit-trail row exactly once per alert, never on a refresh tick. */
export async function upsertZeroDteSetupLog(rows: ZeroDteSetupLogUpsert[]): Promise<Set<string>> {
  if (!rows.length) return new Set();
  await ensureSchema();
  const p = await getPool();
  const freshlyFlagged = new Set<string>();
  for (const r of rows) {
    const ticker = r.ticker.toUpperCase();
    const res = await p.query<{ inserted: boolean }>(
      `
      INSERT INTO zerodte_setup_log (
        session_date, ticker, direction, top_strike, expiry, score, score_max,
        dossier_score, conviction, gross_premium, spike, underlying_at_flag,
        underlying_latest, flags_json, entry_premium, flow_avg_fill, plan_json,
        first_flagged_at, last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,NOW(),NOW())
      ON CONFLICT (session_date, ticker) DO UPDATE SET
        score = EXCLUDED.score,
        score_max = GREATEST(zerodte_setup_log.score_max, EXCLUDED.score),
        dossier_score = COALESCE(EXCLUDED.dossier_score, zerodte_setup_log.dossier_score),
        conviction = COALESCE(EXCLUDED.conviction, zerodte_setup_log.conviction),
        gross_premium = EXCLUDED.gross_premium,
        spike = zerodte_setup_log.spike OR EXCLUDED.spike,
        underlying_latest = COALESCE(EXCLUDED.underlying_latest, zerodte_setup_log.underlying_latest),
        flags_json = COALESCE(EXCLUDED.flags_json, zerodte_setup_log.flags_json),
        -- Plan fields are PINNED at first flag: the graded plan must be the plan as
        -- first printed, never re-priced by a later scan (no hindsight). direction/
        -- top_strike/expiry MUST be pinned together with entry_premium/plan_json —
        -- plan_json.occ is built from exactly these three fields in the SAME scan
        -- cycle that computes entry_premium (attachContractPlans -> buildOcc).
        direction = COALESCE(zerodte_setup_log.direction, EXCLUDED.direction),
        top_strike = COALESCE(zerodte_setup_log.top_strike, EXCLUDED.top_strike),
        expiry = COALESCE(zerodte_setup_log.expiry, EXCLUDED.expiry),
        entry_premium = COALESCE(zerodte_setup_log.entry_premium, EXCLUDED.entry_premium),
        flow_avg_fill = COALESCE(zerodte_setup_log.flow_avg_fill, EXCLUDED.flow_avg_fill),
        plan_json = COALESCE(zerodte_setup_log.plan_json, EXCLUDED.plan_json),
        last_seen_at = NOW()
      RETURNING (xmax = 0) AS inserted
      `,
      [
        r.session_date,
        ticker,
        r.direction,
        r.top_strike,
        r.expiry,
        Math.round(r.score),
        r.dossier_score != null ? Math.round(r.dossier_score) : null,
        r.conviction,
        r.gross_premium,
        r.spike,
        r.underlying,
        r.flags_json,
        r.entry_premium,
        r.flow_avg_fill,
        r.plan_json,
      ]
    );
    if (res.rows[0]?.inserted === true) freshlyFlagged.add(ticker);
  }
  return freshlyFlagged;
}

/**
 * P0 fix (found 2026-07-03 while wiring source_apis attribution): node-postgres's
 * parameter serialization (`pg/lib/utils.js`'s prepareValue) converts a top-level JS
 * ARRAY into a Postgres ARRAY-literal string (`{"...","..."}, `), not a JSON array
 * (`[...]`) — verified directly against the installed pg version. `decision_trace`
 * is ALWAYS a non-empty array at both real call sites (buildZeroDteAuditRow,
 * buildNighthawkRejectedAuditRow), so every INSERT into alert_audit_log's `jsonb`
 * decision_trace column has been sending invalid JSON syntax and throwing
 * "invalid input syntax for type json" since Stage 4's write-paths shipped —
 * silently, because callers fire-and-forget these inserts behind a
 * `.catch(err => console.warn(...))`, which never reaches error_events/Sentry.
 * Confirmed empirically: an authenticated GET to /api/admin/bie-report showed
 * `audit_trail: { recent: [], counts_by_type: {} }` — ZERO rows, despite the
 * write-paths being marked SHIPPED across three PRs. Plain objects (source_key,
 * input_snapshot, final_output) are unaffected — prepareValue's object branch
 * DOES call JSON.stringify — only a value that is a JS array AT THE TOP LEVEL
 * hits the broken branch. Explicitly JSON.stringify() any array-shaped value
 * before binding it as a query parameter for a jsonb column; do not rely on the
 * driver's default object/array handling.
 */
export function toJsonbParam(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

export type SourceApiAttribution = {
  provider: string;
  endpoint: string;
  rate_limited: boolean;
  ok: boolean;
  best_effort: true;
};

/**
 * Stage 4, attribution option 4a from docs/bie/AUDIT-TRAIL-SCHEMA.md: best-effort
 * source-API attribution via a time-window join, not exact per-alert correlation
 * (4b — threading a shared correlationId through every provider call — is a much
 * larger diff, left as a named follow-up if this proves too lossy in practice).
 *
 * Matches `api_telemetry_events` rows whose `request_url` contains the alert's
 * ticker. Approximate by construction: misses calls whose URL doesn't embed the
 * ticker (e.g. a batched market-tide pull covering many tickers at once) — every
 * returned entry carries `best_effort: true` so nothing downstream can mistake
 * this for exact attribution. Split from the DB query so the join logic itself is
 * unit-testable without a live Postgres connection.
 */
export function buildSourceApisAttribution(
  ticker: string,
  telemetryRows: Array<{ provider: string; endpoint: string; rate_limited: boolean; ok: boolean; request_url: string | null }>
): SourceApiAttribution[] | null {
  const upperTicker = ticker.toUpperCase();
  const matches = telemetryRows.filter((r) => r.request_url?.toUpperCase().includes(upperTicker));
  if (matches.length === 0) return null;
  // Dedup by provider+endpoint — retries/refresh polls in the window would otherwise
  // produce several identical attribution entries for the same real API call site.
  const seen = new Set<string>();
  const out: SourceApiAttribution[] = [];
  for (const m of matches) {
    const key = `${m.provider}:${m.endpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: m.provider, endpoint: m.endpoint, rate_limited: m.rate_limited, ok: m.ok, best_effort: true });
  }
  return out;
}

// How far back to look for provider calls that plausibly fed a just-fired alert.
// Generous but not unbounded — approximate by design (see buildSourceApisAttribution),
// so exact tuning matters less than staying well clear of the next scan cycle's calls.
const SOURCE_API_ATTRIBUTION_WINDOW_MS = 3 * 60_000;

/** Best-effort: a failed telemetry lookup must never block the audit-log write it's
 *  attributing, so this fails open to `null` (the row still gets written, just
 *  without source_apis — exactly like the "no write-path populates this yet" state
 *  it's replacing). */
async function attributeSourceApis(ticker: string): Promise<SourceApiAttribution[] | null> {
  try {
    const nowIso = new Date().toISOString();
    const res = await dbQuery<{
      provider: string;
      endpoint: string;
      rate_limited: boolean;
      ok: boolean;
      request_url: string | null;
    }>(
      `SELECT provider, endpoint, rate_limited, ok, request_url
       FROM api_telemetry_events
       WHERE at >= $1::timestamptz - ($2 || ' milliseconds')::interval
         AND at <= $1::timestamptz
       ORDER BY at DESC
       LIMIT 200`,
      [nowIso, SOURCE_API_ATTRIBUTION_WINDOW_MS]
    );
    return buildSourceApisAttribution(ticker, res.rows);
  } catch {
    return null;
  }
}

/** Stage 4 audit trail — one row per alert, written once at first flag (never on a
 *  refresh tick; see upsertZeroDteSetupLog's freshlyFlagged return). Best-effort:
 *  callers fire-and-forget this so an audit-log failure never breaks a scan. */
export async function insertAlertAuditLog(row: {
  alert_type: string;
  source_table: string;
  source_key: Record<string, unknown>;
  ticker: string;
  direction: string | null;
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string | null;
  decision_trace: unknown;
  input_snapshot: Record<string, unknown> | null;
  final_output: Record<string, unknown> | null;
}): Promise<void> {
  const sourceApis = await attributeSourceApis(row.ticker);
  // dbQuery (not raw pool.query) so transient PgBouncer blips get the same retry/backoff
  // as every other write — a one-shot INSERT failure after a successful upsert would
  // otherwise leave a permanent audit gap (refresh ticks never re-write audit rows).
  // Every jsonb column goes through toJsonbParam() — see its doc comment for the
  // array-serialization bug this fixes (decision_trace is always an array here).
  await dbQuery(
    `INSERT INTO alert_audit_log (
      alert_type, source_table, source_key, ticker, direction,
      confidence_score, confidence_label, trigger_reason, decision_trace,
      input_snapshot, source_apis, final_output
    ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)`,
    [
      row.alert_type,
      row.source_table,
      toJsonbParam(row.source_key),
      row.ticker.toUpperCase(),
      row.direction,
      row.confidence_score,
      row.confidence_label,
      row.trigger_reason,
      toJsonbParam(row.decision_trace),
      toJsonbParam(row.input_snapshot),
      toJsonbParam(sourceApis),
      toJsonbParam(row.final_output),
    ]
  );
}

/** Stage 4 audit trail for a Night Hawk REJECTED play (`alert_type = 'nighthawk_rejected'`).
 *  Unlike `insertAlertAuditLog`'s callers (0DTE, Night Hawk published), there is no
 *  upsert-able system-of-record table to pre-filter "have I seen this before" against —
 *  a rejected play is never written anywhere else. Relies instead on
 *  `idx_alert_audit_log_nighthawk_rejected_dedup` (partial unique index on
 *  `alert_type, ticker, source_key->>'edition_for'`) via `ON CONFLICT ... DO NOTHING`, so a
 *  force-rebuild that re-derives the same rejection never writes a duplicate row. */
export async function insertNighthawkRejectedAuditLog(row: {
  source_key: Record<string, unknown>;
  ticker: string;
  direction: string | null;
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string | null;
  decision_trace: unknown;
  input_snapshot: Record<string, unknown> | null;
}): Promise<void> {
  // dbQuery (not raw pool.query) so transient PgBouncer blips get the same retry/backoff
  // as insertAlertAuditLog — see PR #341 for the same fix on that sibling function.
  // Every jsonb column goes through toJsonbParam() — see its doc comment for the
  // array-serialization bug this fixes (decision_trace is always an array here).
  await dbQuery(
    `INSERT INTO alert_audit_log (
      alert_type, source_table, source_key, ticker, direction,
      confidence_score, confidence_label, trigger_reason, decision_trace,
      input_snapshot, final_output
    ) VALUES ('nighthawk_rejected','claude_edition_synthesis',$1::jsonb,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NULL)
    ON CONFLICT (alert_type, ticker, (source_key->>'edition_for'))
      WHERE alert_type = 'nighthawk_rejected'
      DO NOTHING`,
    [
      toJsonbParam(row.source_key),
      row.ticker.toUpperCase(),
      row.direction,
      row.confidence_score,
      row.confidence_label,
      row.trigger_reason,
      toJsonbParam(row.decision_trace),
      toJsonbParam(row.input_snapshot),
    ]
  );
}

export type AlertAuditTrailRow = {
  id: number;
  alert_type: string;
  ticker: string;
  direction: string | null;
  fired_at: string;
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string | null;
  outcome: string | null;
};

export type AlertAuditTrailSummary = {
  recent: AlertAuditTrailRow[];
  counts_by_type: Record<string, number>;
  // Real coverage, computed from the table — not baked into a paragraph. Both
  // write-paths now call attributeSourceApis() (4a from docs/bie/AUDIT-TRAIL-SCHEMA.md,
  // a best-effort time-window join, always flagged best_effort:true). This can be
  // < 100% for two honest reasons: the join genuinely found no matching telemetry
  // in the window, or the row predates this attribution being wired in.
  source_api_attribution_pct: number;
};

/** Pure: raw `alert_audit_log` row -> typed row. Split out so the exact
 *  DB-boundary conversion (NUMERIC-as-string, nullable columns) is
 *  unit-testable without a connection, and so fetchAlertAuditTrail and
 *  fetchResolvedAlertAuditRows share one mapping instead of two. */
export function mapAlertAuditTrailRow(r: QueryResultRow): AlertAuditTrailRow {
  return {
    id: Number(r.id),
    alert_type: String(r.alert_type),
    ticker: String(r.ticker),
    direction: r.direction != null ? String(r.direction) : null,
    fired_at: new Date(String(r.fired_at)).toISOString(),
    confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
    confidence_label: r.confidence_label != null ? String(r.confidence_label) : null,
    trigger_reason: r.trigger_reason != null ? String(r.trigger_reason) : null,
    outcome: r.outcome != null ? String(r.outcome) : null,
  };
}

/** Stage 4 query surface — the unified cross-product view over `alert_audit_log`
 *  (0DTE, Night Hawk published, Night Hawk rejected). Reads only what the three
 *  write-paths already wrote; this function itself has zero decision logic. */
export async function fetchAlertAuditTrail(limit = 20): Promise<AlertAuditTrailSummary> {
  await ensureSchema();
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  const [recentRes, countsRes, attributionRes] = await Promise.all([
    dbQuery<QueryResultRow>(
      `SELECT id, alert_type, ticker, direction, fired_at, confidence_score,
              confidence_label, trigger_reason, outcome
       FROM alert_audit_log ORDER BY fired_at DESC LIMIT $1`,
      [cappedLimit]
    ),
    dbQuery<QueryResultRow>(`SELECT alert_type, COUNT(*)::int AS n FROM alert_audit_log GROUP BY alert_type`),
    dbQuery<QueryResultRow>(
      `SELECT COUNT(*)::int AS total, COUNT(source_apis)::int AS with_apis FROM alert_audit_log`
    ),
  ]);

  const counts_by_type: Record<string, number> = {};
  for (const r of countsRes.rows) counts_by_type[String(r.alert_type)] = Number(r.n) || 0;

  const attrRow = attributionRes.rows[0];
  const total = attrRow ? Number(attrRow.total) || 0 : 0;
  const withApis = attrRow ? Number(attrRow.with_apis) || 0 : 0;

  return {
    recent: recentRes.rows.map(mapAlertAuditTrailRow),
    counts_by_type,
    source_api_attribution_pct: total > 0 ? Math.round((withApis / total) * 1000) / 10 : 0,
  };
}

// Resolved (terminal) outcomes only — "has this happened before, what
// happened" is only meaningful once an alert actually has an answer.
// Excludes 'open'/'pending' (still live, no answer yet) on purpose.
// Exported so alert-outcome-sync.ts (the propagation job that actually populates this
// column — see its doc comment for why it was a total no-op before that job existed) maps
// every origin table's own outcome vocabulary onto EXACTLY this list, never a value invented
// ad hoc at the sync call site.
export const TERMINAL_ALERT_OUTCOMES = ["target", "stop", "ambiguous", "unfilled"] as const;
export type TerminalAlertOutcome = (typeof TERMINAL_ALERT_OUTCOMES)[number];

/**
 * BIE precedent search — every RESOLVED alert from the last `days` days, for
 * embedding into the knowledge store (src/lib/bie/precedent-search.ts). Not
 * capped at 100 like fetchAlertAuditTrail's admin-display limit — this is a
 * bulk read for ingestion, not a UI page. A stable ORDER BY id keeps a
 * re-running ingest job's reads deterministic even if two rows share a
 * `fired_at` timestamp.
 */
export async function fetchResolvedAlertAuditRows(days = 60): Promise<AlertAuditTrailRow[]> {
  await ensureSchema();
  const cappedDays = Math.min(Math.max(days, 1), 365);
  const res = await dbQuery<QueryResultRow>(
    `SELECT id, alert_type, ticker, direction, fired_at, confidence_score,
            confidence_label, trigger_reason, outcome
     FROM alert_audit_log
     WHERE outcome = ANY($1::text[]) AND fired_at >= NOW() - ($2 || ' days')::interval
     ORDER BY fired_at DESC, id DESC
     LIMIT 5000`,
    [TERMINAL_ALERT_OUTCOMES, cappedDays]
  );
  return res.rows.map(mapAlertAuditTrailRow);
}

// ── Outcome propagation (BIE Stage 4 grading sync) ─────────────────────────────────
// alert_audit_log.outcome was defined at table-creation time but nothing ever UPDATEs it
// (grep the repo for "UPDATE alert_audit_log" — zero matches before this PR), so
// fetchResolvedAlertAuditRows() above has returned 0 rows for every product since Stage 4
// shipped. src/lib/bie/alert-outcome-sync.ts is the fix: a periodic job that looks up each
// audit row's already-graded origin row (via source_table/source_key) and copies its
// existing, already-computed outcome across — never a new "is this correct" computation.
// The three functions below are its only DB surface, split out here (not raw dbQuery calls
// in the sync module) to match this file's existing convention of owning all alert_audit_log
// SQL in one place (fetchAlertAuditTrail, fetchResolvedAlertAuditRows, insertAlertAuditLog).

export type UngradedAlertAuditRow = {
  id: number;
  alert_type: string;
  source_table: string;
  source_key: Record<string, unknown>;
  fired_at: string;
};

/**
 * Rows with no outcome yet, old enough that their origin row is plausibly settled. The age
 * filter is just a cheap pre-filter to avoid repeatedly re-querying rows that are obviously
 * too fresh (a 0DTE flag from 5 minutes ago can't possibly be graded yet) — the REAL
 * "is this actually resolved" check happens per-product against the origin row itself
 * (alert-outcome-sync.ts), so an over-eager age threshold here can never cause a wrong grade,
 * only a wasted lookup. `nighthawk_rejected` rows are excluded: a rejected play is never
 * opened anywhere, so it has no origin outcome to ever propagate — it would stay NULL forever
 * regardless, but excluding it here saves a guaranteed-empty lookup every run.
 */
export async function fetchUngradedAlertAuditRows(
  minAgeMinutes: number,
  limit = 500
): Promise<UngradedAlertAuditRow[]> {
  const cappedMinutes = Math.min(Math.max(minAgeMinutes, 1), 60 * 24 * 30);
  const cappedLimit = Math.min(Math.max(limit, 1), 2000);
  const res = await dbQuery<QueryResultRow>(
    `SELECT id, alert_type, source_table, source_key, fired_at
     FROM alert_audit_log
     WHERE outcome IS NULL
       AND alert_type <> 'nighthawk_rejected'
       AND fired_at <= NOW() - ($1 || ' minutes')::interval
     ORDER BY fired_at ASC
     LIMIT $2`,
    [cappedMinutes, cappedLimit]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    alert_type: String(r.alert_type),
    source_table: String(r.source_table),
    source_key: (r.source_key as Record<string, unknown>) ?? {},
    fired_at: new Date(String(r.fired_at)).toISOString(),
  }));
}

/** Direct copy, never a re-derivation: `outcome` must already be one of
 *  TERMINAL_ALERT_OUTCOMES (the caller maps the origin table's vocabulary onto it first).
 *  `WHERE outcome IS NULL` makes this idempotent/race-safe — a row graded by a concurrent
 *  run (or manually) is never clobbered. Returns whether a row actually changed so the sync
 *  loop's counters reflect DB reality, not just "we attempted an update". */
export async function gradeAlertAuditLogOutcome(
  id: number,
  outcome: TerminalAlertOutcome,
  laterCorrect: boolean | null
): Promise<boolean> {
  const res = await dbQuery(
    `UPDATE alert_audit_log
     SET outcome = $2, outcome_graded_at = NOW(), later_correct = $3
     WHERE id = $1 AND outcome IS NULL`,
    [id, outcome, laterCorrect]
  );
  return (res.rowCount ?? 0) > 0;
}

/** 0DTE origin lookup — `zerodte_setup_log`'s primary key is (session_date, ticker) (see the
 *  CREATE TABLE above). `graded_at` is the table's own "have I finished grading this row"
 *  signal (set by gradeZeroDteSetupRow, board.ts's gradeZeroDteLedger); direction_hit can
 *  still be NULL even once graded_at is set, for a genuinely ungradeable row (no flag price
 *  or no close price — computeLedgerGrade's documented behavior) rather than an unresolved
 *  one. Callers distinguish "not graded yet" (graded_at null -> keep waiting) from "graded but
 *  ungradeable" (graded_at set, direction_hit null -> never gets a real answer). */
export async function fetchZeroDteGradeForAudit(
  sessionDate: string,
  ticker: string
): Promise<{ direction_hit: boolean | null; graded_at: string | null } | null> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT direction_hit, graded_at FROM zerodte_setup_log
     WHERE session_date = $1::date AND ticker = $2`,
    [sessionDate, ticker.toUpperCase()]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    direction_hit: row.direction_hit == null ? null : row.direction_hit === true,
    graded_at: row.graded_at != null ? new Date(String(row.graded_at)).toISOString() : null,
  };
}

/** Night Hawk origin lookup — `nighthawk_play_outcomes`'s natural key is
 *  (edition_for, ticker) (UNIQUE constraint on the CREATE TABLE above). Its own `outcome`
 *  column already uses the identical vocabulary this table needs (`target|stop|open|
 *  ambiguous|pending|unfilled` — a strict superset of TERMINAL_ALERT_OUTCOMES), so the
 *  caller's mapping is a pass-through filter, not a translation. */
export async function fetchNighthawkOutcomeForAudit(
  editionFor: string,
  ticker: string
): Promise<{ outcome: string } | null> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT outcome FROM nighthawk_play_outcomes
     WHERE edition_for = $1::date AND ticker = $2`,
    [editionFor, ticker.toUpperCase()]
  );
  const row = res.rows[0];
  return row ? { outcome: String(row.outcome) } : null;
}

/**
 * SPX Slayer (Claude play-gate) origin lookup. Unlike the other two products,
 * `alert_audit_log.source_key` for `alert_type = 'spx_claude_play'` is
 * `{price, direction, at}` (spx-play-claude.ts's `logPlayVerdict`) — a snapshot of the GATE
 * VERDICT, not a foreign key into `spx_play_outcomes` (that table's real PK is
 * `open_play_id`, which the verdict never receives — a verdict is computed and logged
 * BEFORE the engine decides whether to open a play at all, so there is nothing to key on
 * yet). Most `spx_claude_play` rows are VETOs and will never match anything here — correctly
 * so, since a vetoed setup was never traded and has no trade outcome to report.
 *
 * For the rows that WERE approved and opened, `spx-play-engine.ts` opens the play from the
 * exact same in-memory `desk`/`confluence` used for the verdict (`entry_price: desk.price`,
 * same `direction`), moments after the verdict is logged — so (direction, price) match
 * exactly and `opened_at` always lands shortly after the audit row's `fired_at`. This looks
 * up the nearest such play within a generous 30-minute window and only matches CLOSED rows
 * (`outcome <> 'open'`). A price tolerance (not exact equality) absorbs any NUMERIC
 * round-trip formatting difference between the JSONB-serialized verdict price and the
 * column value. If nothing matches, the row simply stays ungraded — a missed match is safe
 * (leaves a row for next run); this function is written so it can never return the WRONG
 * play's outcome (tight price+direction+time constraints, always LIMIT 1 ordered by nearest
 * open time to the verdict).
 */
export async function fetchSpxClaudePlayOutcomeForAudit(
  direction: string,
  price: number,
  firedAt: string
): Promise<{ outcome: string } | null> {
  if (!Number.isFinite(price)) return null;
  const res = await dbQuery<QueryResultRow>(
    `SELECT outcome FROM spx_play_outcomes
     WHERE direction = $1
       AND ABS(entry_price - $2::numeric) < 0.01
       AND outcome <> 'open'
       AND opened_at >= $3::timestamptz
       AND opened_at <= $3::timestamptz + interval '30 minutes'
     ORDER BY opened_at ASC
     LIMIT 1`,
    [direction, price, firedAt]
  );
  const row = res.rows[0];
  return row ? { outcome: String(row.outcome) } : null;
}

export type DuplicateAlertGroup = {
  alert_type: string;
  source_key: Record<string, unknown>;
  count: number;
};

/** BIE Stage 2 "duplicate alerts" — ground truth is `alert_audit_log`'s OWN
 *  documented design invariant (docs/bie/AUDIT-TRAIL-SCHEMA.md): exactly one
 *  row per real alert, keyed by (alert_type, source_key). All three write-paths
 *  (0DTE via `xmax = 0`, Night Hawk published via `xmax = 0`, Night Hawk
 *  rejected via a partial unique index) were built specifically to enforce
 *  this. This checks whether that invariant actually holds in production —
 *  zero invented definition, it verifies the system's own stated design
 *  against reality instead of guessing at a new one. */
export async function fetchDuplicateAlertGroups(limit = 20): Promise<DuplicateAlertGroup[]> {
  await ensureSchema();
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  const { rows } = await dbQuery<QueryResultRow>(
    `SELECT alert_type, source_key, COUNT(*)::int AS n
     FROM alert_audit_log
     GROUP BY alert_type, source_key
     HAVING COUNT(*) > 1
     ORDER BY n DESC
     LIMIT $1`,
    [cappedLimit]
  );
  return rows.map((r) => ({
    alert_type: String(r.alert_type),
    source_key: (r.source_key as Record<string, unknown>) ?? {},
    count: Number(r.n) || 0,
  }));
}

function mapZeroDteLogRow(r: QueryResultRow): ZeroDteSetupLogRow {
  return {
    session_date: isoDateString(r.session_date),
    ticker: String(r.ticker),
    direction: r.direction === "short" ? "short" : "long",
    top_strike: r.top_strike != null ? Number(r.top_strike) : null,
    expiry: r.expiry != null ? isoDateString(r.expiry) : null,
    score: Number(r.score) || 0,
    score_max: Number(r.score_max) || 0,
    dossier_score: r.dossier_score != null ? Number(r.dossier_score) : null,
    conviction: r.conviction != null ? String(r.conviction) : null,
    gross_premium: r.gross_premium != null ? Number(r.gross_premium) : null,
    spike: r.spike === true,
    underlying_at_flag: r.underlying_at_flag != null ? Number(r.underlying_at_flag) : null,
    underlying_latest: r.underlying_latest != null ? Number(r.underlying_latest) : null,
    flags_json: (r.flags_json as Record<string, unknown>) ?? null,
    first_flagged_at: new Date(String(r.first_flagged_at)).toISOString(),
    last_seen_at: new Date(String(r.last_seen_at)).toISOString(),
    close_price: r.close_price != null ? Number(r.close_price) : null,
    move_pct: r.move_pct != null ? Number(r.move_pct) : null,
    direction_hit: r.direction_hit == null ? null : r.direction_hit === true,
    graded_at: r.graded_at != null ? new Date(String(r.graded_at)).toISOString() : null,
    entry_premium: r.entry_premium != null ? Number(r.entry_premium) : null,
    flow_avg_fill: r.flow_avg_fill != null ? Number(r.flow_avg_fill) : null,
    plan_json: (r.plan_json as Record<string, unknown>) ?? null,
    plan_outcome: r.plan_outcome != null ? String(r.plan_outcome) : null,
    plan_pnl_pct: r.plan_pnl_pct != null ? Number(r.plan_pnl_pct) : null,
    status: r.status != null ? String(r.status) : null,
    last_mark: r.last_mark != null ? Number(r.last_mark) : null,
    peak_premium: r.peak_premium != null ? Number(r.peak_premium) : null,
    trough_premium: r.trough_premium != null ? Number(r.trough_premium) : null,
  };
}

export async function fetchZeroDteSetupLog(sessionDate: string): Promise<ZeroDteSetupLogRow[]> {
  await ensureSchema();
  const normalized = normalizeIsoDateInput(sessionDate);
  if (!normalized) return [];
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT * FROM zerodte_setup_log WHERE session_date = $1::date ORDER BY score_max DESC, first_flagged_at ASC LIMIT 30`,
    [normalized]
  );
  return res.rows.map(mapZeroDteLogRow);
}

/** Ledger rows across a session-date range — the calibration harness's input. */
export async function fetchZeroDteSetupLogRange(sinceDate: string, limit = 500): Promise<ZeroDteSetupLogRow[]> {
  await ensureSchema();
  const normalized = normalizeIsoDateInput(sinceDate);
  if (!normalized) return [];
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT * FROM zerodte_setup_log WHERE session_date >= $1::date ORDER BY session_date DESC, score_max DESC LIMIT $2`,
    [normalized, limit]
  );
  return res.rows.map(mapZeroDteLogRow);
}

/** Ungraded ledger rows from sessions strictly before `beforeDate` (grading needs a
 *  finished session's close). Capped — grading is lazy/incremental. */
export async function fetchUngradedZeroDteRows(beforeDate: string, limit = 12): Promise<ZeroDteSetupLogRow[]> {
  await ensureSchema();
  const normalized = normalizeIsoDateInput(beforeDate);
  if (!normalized) return [];
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT * FROM zerodte_setup_log
     WHERE graded_at IS NULL AND session_date < $1::date
     ORDER BY session_date DESC LIMIT $2`,
    [normalized, limit]
  );
  return res.rows.map(mapZeroDteLogRow);
}

export async function gradeZeroDteSetupRow(
  sessionDate: string,
  ticker: string,
  grade: { close_price: number | null; move_pct: number | null; direction_hit: boolean | null }
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `UPDATE zerodte_setup_log
     SET close_price = $3, move_pct = $4, direction_hit = $5, graded_at = NOW()
     WHERE session_date = $1::date AND ticker = $2`,
    [sessionDate, ticker.toUpperCase(), grade.close_price, grade.move_pct, grade.direction_hit]
  );
}

/** Latch a play's live state: peak/trough only ever widen (GREATEST/LEAST), so a
 *  stop stays a stop even if the premium bounces; status is the derived lifecycle. */
export async function updateZeroDteLiveState(
  sessionDate: string,
  ticker: string,
  s: { status: string; mark: number | null }
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `UPDATE zerodte_setup_log SET
       status = $3,
       last_mark = COALESCE($4, last_mark),
       peak_premium = CASE
         WHEN $4 IS NOT NULL THEN GREATEST(COALESCE(peak_premium, $4), $4)
         ELSE peak_premium
       END,
       trough_premium = CASE
         WHEN $4 IS NOT NULL THEN LEAST(COALESCE(trough_premium, $4), $4)
         ELSE trough_premium
       END
     WHERE session_date = $1::date AND ticker = $2`,
    [sessionDate, ticker.toUpperCase(), s.status, s.mark]
  );
}

export type BieKnowledgeRow = {
  id: number;
  kind: string;
  source: string;
  chunk: string;
  embedding: number[] | null;
  created_at: string;
};

/** Insert knowledge chunks, skipping ones already stored (hash-deduped). */
export async function insertBieKnowledge(
  rows: Array<{ kind: string; source: string; chunk: string; chunk_hash: string; embedding: number[] | null }>
): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureSchema();
  const pool = await getPool();
  let inserted = 0;
  for (const r of rows) {
    const res = await pool.query(
      `INSERT INTO bie_knowledge (kind, source, chunk, chunk_hash, embedding)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (chunk_hash) DO NOTHING`,
      [r.kind, r.source, r.chunk.slice(0, 6000), r.chunk_hash, r.embedding != null ? JSON.stringify(r.embedding) : null]
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

/** Which of these chunk hashes already exist, and whether each already carries
 *  an embedding — lets ingestion embed ONLY new content (dedup) while still
 *  BACKFILLING chunks that were stored cold before the embeddings key existed. */
export async function fetchExistingBieHashes(hashes: string[]): Promise<Map<string, boolean>> {
  if (hashes.length === 0) return new Map();
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT chunk_hash, (embedding IS NOT NULL) AS embedded FROM bie_knowledge WHERE chunk_hash = ANY($1)`,
    [hashes]
  );
  return new Map(res.rows.map((r) => [String(r.chunk_hash), Boolean(r.embedded)]));
}

/** Backfill embeddings onto chunks stored cold. The `embedding IS NULL` guard
 *  makes this idempotent and race-safe — a chunk embedded elsewhere wins. */
export async function updateBieKnowledgeEmbeddings(
  rows: Array<{ chunk_hash: string; embedding: number[] }>
): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureSchema();
  const pool = await getPool();
  let updated = 0;
  for (const r of rows) {
    const res = await pool.query(
      `UPDATE bie_knowledge SET embedding = $2 WHERE chunk_hash = $1 AND embedding IS NULL`,
      [r.chunk_hash, JSON.stringify(r.embedding)]
    );
    updated += res.rowCount ?? 0;
  }
  return updated;
}

/** Recent knowledge rows (optionally by kind) — ranking happens in the caller. */
export async function fetchBieKnowledge(opts?: { kind?: string; limit?: number }): Promise<BieKnowledgeRow[]> {
  await ensureSchema();
  const limit = Math.min(opts?.limit ?? 400, 1000);
  const res = opts?.kind
    ? await (await getPool()).query<QueryResultRow>(
        `SELECT id, kind, source, chunk, embedding, created_at FROM bie_knowledge WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`,
        [opts.kind, limit]
      )
    : await (await getPool()).query<QueryResultRow>(
        `SELECT id, kind, source, chunk, embedding, created_at FROM bie_knowledge ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
  return res.rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    source: String(r.source),
    chunk: String(r.chunk),
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]).map(Number) : null,
    created_at: new Date(String(r.created_at)).toISOString(),
  }));
}

/** Corpus size + embedded coverage by kind — the admin panel's readout of how
 *  much the engine knows and how much of it is retrievable (embedded). */
export async function fetchBieKnowledgeStats(): Promise<{
  total: number;
  embedded: number;
  by_kind: Array<{ kind: string; total: number; embedded: number }>;
  newest_at: string | null;
}> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT kind, COUNT(*)::int AS total, COUNT(embedding)::int AS embedded, MAX(created_at) AS newest_at
     FROM bie_knowledge GROUP BY kind ORDER BY kind`
  );
  const byKind = res.rows.map((r) => ({
    kind: String(r.kind),
    total: Number(r.total) || 0,
    embedded: Number(r.embedded) || 0,
  }));
  const newest = res.rows
    .map((r) => (r.newest_at ? new Date(String(r.newest_at)).toISOString() : null))
    .filter((s): s is string => s != null)
    .sort()
    .at(-1);
  return {
    total: byKind.reduce((s, k) => s + k.total, 0),
    embedded: byKind.reduce((s, k) => s + k.embedded, 0),
    by_kind: byKind,
    newest_at: newest ?? null,
  };
}

/** Aggregates for the daily BIE self-eval report. */
export async function fetchBieInteractionStats(sinceHours = 24): Promise<{
  total: number;
  routed: number;
  claude: number;
  avg_claims_total: number | null;
  avg_claims_verified: number | null;
  avg_latency_router_ms: number | null;
  avg_latency_claude_ms: number | null;
}> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE answer_source = 'bie-router')::int AS routed,
       COUNT(*) FILTER (WHERE answer_source = 'claude')::int AS claude,
       AVG(claims_total) FILTER (WHERE answer_source = 'claude') AS avg_claims_total,
       AVG(claims_verified) FILTER (WHERE answer_source = 'claude') AS avg_claims_verified,
       AVG(latency_ms) FILTER (WHERE answer_source = 'bie-router') AS avg_latency_router_ms,
       AVG(latency_ms) FILTER (WHERE answer_source = 'claude') AS avg_latency_claude_ms
     FROM bie_interactions
     WHERE created_at >= NOW() - ($1 || ' hours')::interval`,
    [sinceHours]
  );
  const r = res.rows[0] ?? {};
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
  return {
    total: Number(r.total) || 0,
    routed: Number(r.routed) || 0,
    claude: Number(r.claude) || 0,
    avg_claims_total: num(r.avg_claims_total),
    avg_claims_verified: num(r.avg_claims_verified),
    avg_latency_router_ms: num(r.avg_latency_router_ms),
    avg_latency_claude_ms: num(r.avg_latency_claude_ms),
  };
}

/** BIE learning substrate — best-effort telemetry write, never blocks an answer.
 *  `tools_used`/`intent_bucket` (task #103) are additive groundwork for #112 (routing
 *  Largo turns through BIE's self-eval loop) — they capture what ACTUALLY happened on
 *  a turn (the real tool names invoked, and the router's decided bucket: an intent name
 *  for a deterministic route, or "claude_fallback" — see bieIntentBucket() in
 *  bie/router.ts) alongside the pre-existing question/intent/answer_source columns,
 *  which are untouched. */
export async function insertBieInteraction(row: {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  tools_used: string[];
  intent_bucket: string;
}): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `INSERT INTO bie_interactions
       (user_id, question, intent, answer_source, claims_total, claims_verified, latency_ms, tools_used, intent_bucket)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      row.user_id,
      row.question.slice(0, 2000),
      row.intent,
      row.answer_source,
      row.claims_total,
      row.claims_verified,
      row.latency_ms,
      toJsonbParam(row.tools_used),
      row.intent_bucket,
    ]
  );
}

/** Task #112 — the raw rows BIE's calibration harness needs to score "how good are
 *  Largo's answers specifically when SPX Slayer's own tools were involved"
 *  (src/lib/bie/calibration.ts's computeSpxToolCallCalibration). Cohort membership
 *  is a UNION of two conditions, filtered here at the SQL layer rather than
 *  fetch-then-filter-in-JS like fetchZeroDteSetupLogRange/fetchClosedPlayOutcomes:
 *  bie_interactions is one row per Largo QUESTION (much higher volume than the
 *  admission-gated setup-log / closed-play-outcome tables those functions read),
 *  so pulling the whole rolling window client-side just to throw most of it away
 *  in JS would be wasteful.
 *    1. `tools_used` overlaps `spxEngineToolNames` (jsonb `?|`) — the Claude
 *       tool-calling path dispatched one of SPX Slayer's own engine-state tools.
 *    2. `intent_bucket = 'spx_structure'` — the deterministic BIE router answered
 *       via composeBieAnswer's composeSpxStructure(), which internally calls
 *       runLargoTool("get_spx_structure", {}) — the SAME engine read condition 1
 *       is trying to detect — but logBie() always records the router path's
 *       tools_used as the single sentinel ["blackout_intelligence"], never the
 *       real tool name (see largo-terminal.ts's tryBieRoute call sites). Without
 *       this OR, the cohort could never contain a single router-matched row by
 *       construction, which would make "how often do SPX-engine questions land on
 *       the deterministic router vs. Claude fallback" — the very ratio task #112
 *       asks this harness to track — read a permanent, meaningless 0%. */
export async function fetchSpxToolCallingBieInteractions(
  sinceDate: string,
  spxEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND (tools_used ?| $2::text[] OR intent_bucket = 'spx_structure')
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, spxEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Task #133 — the HELIX analogue of fetchSpxToolCallingBieInteractions above: the
 *  raw rows BIE's calibration harness needs to score "how good are Largo's answers
 *  specifically when HELIX's own tape/anomaly-detector state was involved"
 *  (src/lib/bie/calibration.ts's computeHelixToolCallCalibration). Same SQL-layer
 *  filtering rationale (bie_interactions is one row per Largo QUESTION, much
 *  higher volume than fetch-then-filter-in-JS tables like zerodte_setup_log), but
 *  DELIBERATELY WITHOUT an `intent_bucket = '...'` OR-clause — unlike SPX Slayer's
 *  fetcher above, this is not an oversight. Investigated src/lib/bie/router.ts's
 *  classifyBieIntent() directly: it recognizes exactly four intents
 *  (zerodte_plays, ticker_play_state, spx_structure, market_context) and NONE of
 *  them route a HELIX/flow question deterministically — there is no
 *  composeBieAnswer branch that reads the flow tape or the anomaly near-miss log
 *  the way composeSpxStructure reads SPX Slayer's engine state. So there is no
 *  intent_bucket value a router-matched HELIX turn could ever carry, and adding a
 *  clause like `OR intent_bucket = 'flow_analysis'` would be fabricating a match
 *  condition for a code path that does not exist. A pure tools_used check is the
 *  complete and correct membership test for this cohort today; if a future task
 *  adds a deterministic HELIX router intent, this fetcher (and
 *  computeHelixToolCallCalibration's router_matched_n, which will legitimately
 *  read 0 until then) should gain the analogous OR-clause at that time. */
export async function fetchHelixToolCallingBieInteractions(
  sinceDate: string,
  helixEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND tools_used ?| $2::text[]
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, helixEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Task #137 — the raw rows BIE's calibration harness needs to score "how good are
 *  Largo's answers specifically when BlackOut Thermal's own GEX/positioning tools
 *  were involved" (src/lib/bie/calibration.ts's computeThermalToolCallCalibration).
 *  Same SQL-layer-filter rationale as fetchSpxToolCallingBieInteractions above
 *  (bie_interactions is one row per Largo QUESTION — much higher volume than the
 *  admission-gated setup-log/closed-play-outcome tables — so filtering here beats
 *  pulling the whole rolling window client-side just to throw most of it away).
 *
 *  DELIBERATE ASYMMETRY vs. fetchSpxToolCallingBieInteractions: this is a PLAIN
 *  `tools_used ?|` membership test, with NO `OR intent_bucket = '...'` clause.
 *  The SPX version needs that OR because BIE's deterministic router has a
 *  `spx_structure` intent that answers via the exact same engine read a
 *  Claude-tool-calling turn would make, but always logs the ["blackout_intelligence"]
 *  sentinel instead of the real tool name (see that function's doc comment). BIE's
 *  router (src/lib/bie/router.ts's classifyBieIntent) has NO intent at all for
 *  Thermal/GEX-positioning questions — only zerodte_plays/ticker_play_state/
 *  spx_structure/market_context exist — so there is no router path to reroute
 *  around and nothing to OR in. Every Thermal-engine-tool turn in bie_interactions
 *  necessarily went through Claude's tool-calling loop and recorded the real tool
 *  name, so a pure tools_used check already sees the complete cohort. */
export async function fetchThermalToolCallingBieInteractions(
  sinceDate: string,
  thermalEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND tools_used ?| $2::text[]
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, thermalEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Task #144 — the Night Hawk analogue of fetchSpxToolCallingBieInteractions
 *  above: raw bie_interactions rows for "how good are Largo's answers
 *  specifically when Night Hawk's own tools were involved" (src/lib/bie/
 *  calibration.ts's computeNighthawkToolCallCalibration).
 *
 *  Deliberately ASYMMETRIC vs. the SPX version above: membership here is
 *  tools_used-ONLY — there is no `OR intent_bucket = '...'` clause. That's not
 *  an oversight: classifyBieIntent (bie/router.ts) recognizes exactly 4
 *  deterministic intents (zerodte_plays, ticker_play_state, spx_structure,
 *  market_context) and NONE of them route Night Hawk questions — there is no
 *  router path that ever answers a Night Hawk question deterministically.
 *  NIGHTHAWK_RE (largo/intent-keywords.ts) looks similar in spirit to the
 *  SPX_STRUCTURE_RE the router uses, but it does a completely different job:
 *  it only decides which TOOL BUNDLE Largo has on hand for a question
 *  (getToolsForIntent, tool-defs.ts) — it never feeds classifyBieIntent's
 *  answer path, so it can never produce a bie_interactions row whose
 *  intent_bucket is anything Night-Hawk-flavored. Adding a fake OR-clause here
 *  would just always evaluate false — dead SQL dressed up as a UNION, exactly
 *  the kind of thing a future reader might "fix" by fabricating a match. If a
 *  future task ever adds a real deterministic Night Hawk router intent, THIS
 *  is the query (and computeNighthawkToolCallCalibration's cohort test below)
 *  that should grow the matching OR-clause. */
export async function fetchNighthawkToolCallingBieInteractions(
  sinceDate: string,
  nighthawkEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND tools_used ?| $2::text[]
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, nighthawkEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Task #149 — the analogous raw-rows fetch for BIE's calibration harness to score
 *  "how good are Largo's answers specifically when 0DTE Command's own tools were
 *  involved" (src/lib/bie/calibration.ts's computeZeroDteToolCallCalibration).
 *  Direct copy of fetchSpxToolCallingBieInteractions's shape/SQL above — same
 *  SQL-layer cohort filter for the same reason (bie_interactions is one row per
 *  Largo QUESTION, much higher volume than the admission-gated setup-log table),
 *  same UNION-of-conditions membership test:
 *    1. `tools_used` overlaps `zeroDteEngineToolNames` (jsonb `?|`) — the Claude
 *       tool-calling path dispatched get_zerodte_plays or get_zerodte_rejections.
 *    2. `intent_bucket = 'zerodte_plays'` — the deterministic BIE router answered
 *       via composeBieAnswer's 0DTE-plays composer, which internally reads the
 *       SAME zerodte_setup_log state condition 1 is trying to detect — but
 *       logBie() always records the router path's tools_used as the single
 *       sentinel ["blackout_intelligence"], never the real tool name (see
 *       largo-terminal.ts's tryBieRoute call sites, same as the SPX path above).
 *       Without this OR, the cohort could never contain a single router-matched
 *       row by construction, which would make "how often do 0DTE-board questions
 *       land on the deterministic router vs. Claude fallback" read a permanent,
 *       meaningless 0% — the exact same failure mode task #112 documented for
 *       SPX Slayer's own spx_structure intent.
 *    3. `intent_bucket = 'ticker_play_state'` — task #162 fix: this condition was
 *       MISSING until this commit, and its absence was a genuine undercounting
 *       bug, not a deliberate scope narrowing like the sibling products'
 *       tools_used-only cohorts. composeTickerPlayState (src/lib/bie/composers.ts)
 *       answers "how's the NVDA play" questions by calling the EXACT SAME
 *       zeroDtePlaysForLargo() board read as condition 2's composeZeroDtePlays,
 *       just pre-filtered to one ticker — genuinely 0DTE Command engine state,
 *       not a different product or an ambiguous cross-product tool. But
 *       router.ts's classifyBieIntent logs this turn's intent_bucket as the
 *       distinct value "ticker_play_state" (not "zerodte_plays"), and logBie()
 *       still records tools_used as the ["blackout_intelligence"] sentinel on
 *       this path too — so before this fix, neither condition 1 nor condition 2
 *       matched a ticker_play_state row. Every router-matched per-ticker
 *       0DTE-board turn was silently invisible to this cohort, undercounting
 *       n/router_matched_n by the same mechanism condition 2's comment already
 *       warns about, just one intent_bucket value further than this function's
 *       author accounted for. */
export async function fetchZeroDteToolCallingBieInteractions(
  sinceDate: string,
  zeroDteEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND (tools_used ?| $2::text[] OR intent_bucket = 'zerodte_plays' OR intent_bucket = 'ticker_play_state')
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, zeroDteEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Task #161 — the raw rows BIE's calibration harness needs to score "how good are
 *  Largo's answers specifically when market_context's own state was involved"
 *  (src/lib/bie/calibration.ts's computeMarketContextToolCallCalibration). Direct
 *  copy of fetchSpxToolCallingBieInteractions's/fetchZeroDteToolCallingBieInteractions's
 *  shape/SQL above — same SQL-layer cohort filter for the same reason
 *  (bie_interactions is one row per Largo QUESTION, much higher volume than the
 *  admission-gated setup-log/closed-play-outcome tables), same UNION-of-two-
 *  conditions membership test:
 *    1. `tools_used` overlaps `marketEngineToolNames` (jsonb `?|`) — the Claude
 *       tool-calling path dispatched get_market_context directly.
 *    2. `intent_bucket = 'market_context'` — the deterministic BIE router answered
 *       via composeBieAnswer's composeMarketContext(), which internally calls
 *       runLargoTool("get_market_context", {}) — the SAME engine read condition 1
 *       is trying to detect — but logBie() always records the router path's
 *       tools_used as the single sentinel ["blackout_intelligence"], never the
 *       real tool name (see largo-terminal.ts's tryBieRoute call sites, same as
 *       the SPX/0DTE paths above). Without this OR, the cohort could never contain
 *       a single router-matched row by construction, which would make "how often
 *       do market-context questions land on the deterministic router vs. Claude
 *       fallback" read a permanent, meaningless 0% — the exact same failure mode
 *       task #112 documented for SPX Slayer's own spx_structure intent. */
export async function fetchMarketContextToolCallingBieInteractions(
  sinceDate: string,
  marketEngineToolNames: string[],
  limit = 3000
): Promise<
  Array<{
    tools_used: string[];
    intent_bucket: string | null;
    answer_source: string;
    claims_total: number | null;
    claims_verified: number | null;
    latency_ms: number | null;
    created_at: string;
  }>
> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `SELECT tools_used, intent_bucket, answer_source, claims_total, claims_verified, latency_ms, created_at
     FROM bie_interactions
     WHERE created_at >= $1::date
       AND (tools_used ?| $2::text[] OR intent_bucket = 'market_context')
     ORDER BY created_at DESC
     LIMIT $3`,
    [sinceDate, marketEngineToolNames, limit]
  );
  return res.rows.map((r) => ({
    tools_used: Array.isArray(r.tools_used) ? (r.tools_used as string[]) : [],
    intent_bucket: r.intent_bucket != null ? String(r.intent_bucket) : null,
    answer_source: String(r.answer_source),
    claims_total: r.claims_total != null ? Number(r.claims_total) : null,
    claims_verified: r.claims_verified != null ? Number(r.claims_verified) : null,
    latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function updateZeroDtePlanOutcome(
  sessionDate: string,
  ticker: string,
  grade: { plan_outcome: string; plan_pnl_pct: number | null }
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `UPDATE zerodte_setup_log SET plan_outcome = $3, plan_pnl_pct = $4
     WHERE session_date = $1::date AND ticker = $2`,
    [sessionDate, ticker.toUpperCase(), grade.plan_outcome, grade.plan_pnl_pct]
  );
}

export async function fetchLatestPlayableNighthawkEdition(): Promise<NighthawkEditionRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT edition_for, session_date, published_at,
           recap_headline, recap_summary, market_recap, plays, meta
    FROM nighthawk_editions
    WHERE jsonb_typeof(COALESCE(plays, '[]'::jsonb)) = 'array'
      AND jsonb_array_length(COALESCE(plays, '[]'::jsonb)) > 0
    ORDER BY edition_for DESC
    LIMIT 1
    `
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    edition_for: isoDateString(r.edition_for),
    session_date: isoDateString(r.session_date),
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
      day: isoDateString(row.day),
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
      day: isoDateString(row.day),
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
  outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled";
  created_at: string;
};

function mapNighthawkPlayOutcomeRow(r: QueryResultRow): NighthawkPlayOutcomeRow {
  return {
    id: Number(r.id),
    edition_for: isoDateString(r.edition_for),
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

/** Upsert a Night Hawk edition's published plays into the outcomes ledger.
 *
 *  Returns the tickers that were a FRESH INSERT this call (first publish of that
 *  ticker for this edition), via the same `xmax = 0` idiom used by
 *  upsertZeroDteSetupLog — callers use this to write a Stage 4 audit-trail row
 *  exactly once per alert, never on a force-rebuild refresh. The DO UPDATE's
 *  `WHERE outcome = 'pending'` guard means an already-graded row (rare, but
 *  possible on a stale force-rebuild) is neither updated nor returned here — it
 *  correctly does not count as a fresh publish either. */
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
): Promise<Set<string>> {
  if (!rows.length) return new Set();
  await ensureSchema();
  const pool = await getPool();

  // Single multi-row INSERT (one round-trip) instead of an awaited per-row loop (N round-trips).
  // Each row contributes 10 bound params; outcome is the 'pending' literal as before.
  const params: Array<string | number | null> = [];
  const tuples = rows
    .map((row, i) => {
      const b = i * 10;
      params.push(
        row.edition_for,
        row.ticker,
        row.direction,
        row.conviction,
        row.entry_range_low,
        row.entry_range_high,
        row.target,
        row.stop,
        row.score,
        row.sector
      );
      return `($${b + 1}::date, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, 'pending')`;
    })
    .join(", ");

  const res = await pool.query<{ ticker: string; inserted: boolean }>(
    `
    INSERT INTO nighthawk_play_outcomes (
      edition_for, ticker, direction, conviction,
      entry_range_low, entry_range_high, target, stop, score, sector, outcome
    ) VALUES ${tuples}
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
    RETURNING ticker, (xmax = 0) AS inserted
    `,
    params
  );
  const freshlyPublished = new Set<string>();
  for (const r of res.rows) {
    if (r.inserted === true) freshlyPublished.add(r.ticker.toUpperCase());
  }
  return freshlyPublished;
}

export async function pruneNighthawkPlayOutcomesForEdition(
  editionFor: string,
  tickers: string[]
): Promise<number> {
  await ensureSchema();
  const normalized = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))
  );
  const res = await (await getPool()).query(
    `
    DELETE FROM nighthawk_play_outcomes
    WHERE edition_for = $1::date
      AND NOT (ticker = ANY($2::varchar[]))
    `,
    [editionFor, normalized]
  );
  return res.rowCount ?? 0;
}

export async function fetchPendingNighthawkOutcomes(lookbackDays = 7): Promise<NighthawkPlayOutcomeRow[]> {
  await ensureSchema();
  // Backstop: the $1::int cast below throws "invalid input syntax for type integer" for any
  // non-integer arg. Coerce to a safe positive integer so no caller (incl. LLM-driven tools)
  // can crash pg through this day-param.
  const safeLookbackDays =
    Number.isFinite(lookbackDays) && lookbackDays > 0 ? Math.trunc(lookbackDays) : 7;
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
    [safeLookbackDays]
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
    outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled";
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
    WHERE id = $1 AND outcome = 'pending'
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
  // Backstop: the $1::int cast below throws "invalid input syntax for type integer" for any
  // non-integer arg. Coerce to a safe positive integer so no caller (incl. LLM-driven tools)
  // can crash pg through this day-param.
  const safeWindowDays =
    Number.isFinite(windowDays) && windowDays > 0 ? Math.trunc(windowDays) : 30;
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
      [safeWindowDays]
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

export type NighthawkFunnelRawStats = {
  published_count: number;
  rejected_by_reason: Array<{ trigger_reason: string; n: number }>;
};

/**
 * Task #145: raw counts behind the admin Night Hawk dashboard's funnel/rejection-rate panel —
 * how many candidates were PUBLISHED vs REJECTED at synthesis over the window, the rejected
 * side broken down by `trigger_reason` (a plain TEXT column on `alert_audit_log`, one of the
 * 5 fixed strings `REJECTION_TRIGGER_REASON` in nighthawk/play-outcomes.ts writes — grouping
 * by it here means the stage breakdown needs zero `decision_trace` JSON parsing).
 *
 * Windowed the same way `fetchNighthawkOutcomeAnalytics` windows its own `edition_for` query,
 * so both sides of the funnel line up over the identical date range.
 *
 * `nighthawk_play_outcomes` (UNIQUE(edition_for, ticker) — see its CREATE TABLE above) is the
 * published-side ground truth, deliberately NOT `alert_audit_log`'s own `alert_type =
 * 'nighthawk'` count: `recordNighthawkAuditTrail` (play-outcomes.ts) only inserts a row for a
 * ticker's FIRST-ever publish (`freshlyPublished`), so it would undercount any play that
 * carries over or re-appears across editions within the window. The rejected side has no such
 * table to fall back on — `alert_audit_log` IS the only record of a rejection (see
 * `insertNighthawkRejectedAuditLog`'s doc comment) — so that side reads from it directly.
 */
export async function fetchNighthawkFunnelStats(windowDays = 30): Promise<NighthawkFunnelRawStats> {
  await ensureSchema();
  // Same backstop as fetchNighthawkOutcomeAnalytics — coerce to a safe positive integer so no
  // caller can crash the $1::int cast below with a non-integer arg.
  const safeWindowDays =
    Number.isFinite(windowDays) && windowDays > 0 ? Math.trunc(windowDays) : 30;
  const pool = await getPool();
  const [publishedRes, rejectedRes] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
       FROM nighthawk_play_outcomes
       WHERE edition_for >= (CURRENT_DATE - ($1::int || ' days')::interval)`,
      [safeWindowDays]
    ),
    pool.query<{ trigger_reason: string; n: string }>(
      `SELECT trigger_reason, COUNT(*)::int AS n
       FROM alert_audit_log
       WHERE alert_type = 'nighthawk_rejected'
         AND (source_key->>'edition_for')::date >= (CURRENT_DATE - ($1::int || ' days')::interval)
       GROUP BY trigger_reason
       ORDER BY n DESC`,
      [safeWindowDays]
    ),
  ]);
  return {
    published_count: Number(publishedRes.rows[0]?.count ?? 0),
    rejected_by_reason: rejectedRes.rows.map((r) => ({
      trigger_reason: String(r.trigger_reason),
      n: Number(r.n),
    })),
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
    edition_for: isoDateString(r.edition_for),
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

/**
 * Archive (task #129) whatever is CURRENTLY in nighthawk_dossiers_staging for this edition into
 * the durable nighthawk_scoring_history table. Callers MUST invoke this before clearNighthawkStaging
 * — it reads the same staging rows clearNighthawkStaging is about to delete, so calling it after
 * (or not at all) would archive nothing. A single INSERT...SELECT (not a fetch-then-loop-insert from
 * the app layer) so the copy is one round trip and can never race a concurrent staging write.
 * ON CONFLICT DO UPDATE (not append-only): a checkpoint-resumed build can call this more than once
 * for the same edition_for as more tickers get staged across resumes — the later, fuller archive for
 * a given ticker should win, not stack duplicate rows. Returns the archived row count for logging;
 * never throws on an empty staging table (0 rows archived is a valid, common outcome — e.g. the
 * stage_candidates-zero recap-only fallback, which clears staging before any dossier was ever staged).
 */
export async function archiveNighthawkStaging(editionFor: string): Promise<number> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    INSERT INTO nighthawk_scoring_history (edition_for, ticker, dossier_json, scored_json, staged_at)
    SELECT edition_for, ticker, dossier_json, scored_json, created_at
    FROM nighthawk_dossiers_staging
    WHERE edition_for = $1::date
    ON CONFLICT (edition_for, ticker) DO UPDATE SET
      dossier_json = EXCLUDED.dossier_json,
      scored_json = EXCLUDED.scored_json,
      staged_at = EXCLUDED.staged_at,
      archived_at = NOW()
    `,
    [editionFor]
  );
  return res.rowCount ?? 0;
}

/**
 * Read path for the durable archive above. Same shape as fetchStagedDossiers so callers (the
 * get_nighthawk_dossier Largo tool) can fall back to this transparently once staging is cleared for
 * that edition. Pass `ticker` to scope to one candidate (mirrors fetchStagedDossiers' find-by-ticker
 * usage); omit it to list everything archived for the edition.
 */
export async function fetchNighthawkScoringHistory(
  editionFor: string,
  ticker?: string
): Promise<
  Array<{
    ticker: string;
    dossier: Record<string, unknown>;
    scored: Record<string, unknown> | null;
    staged_at: string;
    archived_at: string;
  }>
> {
  await ensureSchema();
  const res = ticker
    ? await (await getPool()).query(
        `
        SELECT ticker, dossier_json, scored_json, staged_at, archived_at
        FROM nighthawk_scoring_history
        WHERE edition_for = $1::date AND ticker = $2
        `,
        [editionFor, ticker.toUpperCase()]
      )
    : await (await getPool()).query(
        `
        SELECT ticker, dossier_json, scored_json, staged_at, archived_at
        FROM nighthawk_scoring_history
        WHERE edition_for = $1::date
        ORDER BY ticker ASC
        `,
        [editionFor]
      );
  return res.rows.map((r) => ({
    ticker: String(r.ticker).toUpperCase(),
    dossier: (r.dossier_json as Record<string, unknown>) ?? {},
    scored: (r.scored_json as Record<string, unknown>) ?? null,
    staged_at: String(r.staged_at),
    archived_at: String(r.archived_at),
  }));
}

/** Fail jobs stuck in `running` (or intermediate stage) long enough to block resume/idempotency. */
export async function failStaleNighthawkJobs(
  staleAfterHours = Number(process.env.NIGHTHAWK_STALE_JOB_HOURS ?? "4")
): Promise<number> {
  await ensureSchema();
  const hours = Number.isFinite(staleAfterHours) && staleAfterHours > 0 ? staleAfterHours : 4;
  const res = await (await getPool()).query<{ edition_for: string }>(
    `
    UPDATE nighthawk_jobs j
    SET status = 'failed',
        error = COALESCE(error, 'Stale running job cleared for resume'),
        updated_at = NOW()
    WHERE j.status NOT IN ('published', 'failed')
      AND j.updated_at < NOW() - ($1::text || ' hours')::interval
      AND NOT EXISTS (
        SELECT 1
        FROM nighthawk_jobs newer
        WHERE newer.edition_for > j.edition_for
          AND newer.status = 'published'
      )
    RETURNING edition_for::text AS edition_for
    `,
    [String(hours)]
  );
  for (const row of res.rows) {
    logNighthawkJob(String(row.edition_for), "warn", null, `Stale job marked failed after ${hours}h idle`);
  }
  return res.rowCount ?? 0;
}

export async function fetchLatestNighthawkJob(): Promise<NighthawkJobRow | null> {
  await ensureSchema();
  const res = await (await getPool()).query(
    `
    SELECT id, edition_for, status, current_stage, context_json, candidates_json, scored_json,
           synthesis_json, error, started_at, updated_at, published_at
    FROM nighthawk_jobs
    ORDER BY edition_for DESC, updated_at DESC, id DESC
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

  // Retention bound (audit B.7): cron_job_runs grows one row per cron tick and
  // was unbounded. Keep 30 days of history. Sampled (~1 in 20 inserts) so the
  // hot recording path stays cheap; the prune itself is a small, generous window.
  // NOTE: timestamp column is started_at (this table has no created_at).
  if (Math.random() < 0.05) {
    try {
      await (await getPool()).query(
        `DELETE FROM cron_job_runs WHERE started_at < NOW() - INTERVAL '30 days'`
      );
    } catch {
      // Best-effort prune; never let retention failures break run recording.
    }
  }
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
