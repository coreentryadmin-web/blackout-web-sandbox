import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let poolInit: Promise<Pool> | null = null;
let activeMode: "private" | "public" | "unknown" = "unknown";

export function dbConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() || process.env.DATABASE_PUBLIC_URL?.trim()
  );
}

export function databaseConnectionMode(): "private" | "public" | "unknown" {
  return activeMode;
}

function poolSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "0") return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) {
    return false;
  }
  return { rejectUnauthorized: false };
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

      return new Pool({
        connectionString: candidate.url,
        max: 8,
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

async function runMigrations(): Promise<void> {
  const p = await getPool();
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
    CREATE TABLE IF NOT EXISTS platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
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
    ALTER TABLE spx_open_play
    ADD COLUMN IF NOT EXISTS option_strike NUMERIC,
    ADD COLUMN IF NOT EXISTS option_type TEXT,
    ADD COLUMN IF NOT EXISTS option_label TEXT,
    ADD COLUMN IF NOT EXISTS option_premium TEXT;
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
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_closed
    ON spx_play_outcomes(closed_at DESC) WHERE outcome <> 'open';
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_spx_play_outcomes_entry_path
    ON spx_play_outcomes(entry_path, outcome);
  `);
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

export async function getMeta(key: string): Promise<string | null> {
  await ensureSchema();
  const res = await (await getPool()).query<{ value: string }>(
    "SELECT value FROM platform_meta WHERE key = $1",
    [key]
  );
  return res.rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
    `INSERT INTO platform_meta (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
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
};

export async function fetchRecentFlows(params: {
  limit: number;
  ticker?: string;
  min_premium?: number;
}): Promise<FlowRow[]> {
  await ensureSchema();
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  let i = 1;

  if (params.ticker) {
    clauses.push(`ticker = $${i++}`);
    values.push(params.ticker.toUpperCase());
  }
  if (params.min_premium && params.min_premium > 0) {
    clauses.push(`COALESCE(total_premium, 0) >= $${i++}`);
    values.push(params.min_premium);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(params.limit);

  const res = await (await getPool()).query<QueryResultRow>(
    `
    SELECT ticker,
           COALESCE(total_premium, 0) AS premium,
           option_type,
           expiry,
           strike,
           CASE WHEN LOWER(option_type) LIKE 'c%' THEN 'bullish' ELSE 'bearish' END AS direction,
           COALESCE(score, 0) AS score,
           CASE
             WHEN COALESCE(total_premium, 0) >= 1000000 THEN 'whale'
             WHEN expiry = CURRENT_DATE THEN '0dte'
             ELSE 'stock'
           END AS route,
           COALESCE(created_at, inserted_at) AS alerted_at
    FROM flow_alerts
    ${where}
    ORDER BY COALESCE(created_at, inserted_at) DESC NULLS LAST
    LIMIT $${i}
    `,
    values
  );

  return res.rows.map((row) => ({
    ticker: String(row.ticker ?? ""),
    premium: Number(row.premium ?? 0),
    option_type: String(row.option_type ?? "").toUpperCase(),
    expiry: row.expiry ? String(row.expiry).slice(0, 10) : "",
    strike: Number(row.strike ?? 0),
    direction: String(row.direction ?? "bullish"),
    score: Number(row.score ?? 0),
    route: String(row.route ?? "stock"),
    alerted_at: row.alerted_at ? new Date(String(row.alerted_at)).toISOString() : new Date().toISOString(),
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
    SELECT id, session_date, direction, entry_price, stop, target, grade, headline,
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
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  opened_at: string;
  option_strike?: number | null;
  option_type?: string | null;
  option_label?: string | null;
  option_premium?: string | null;
}): Promise<number> {
  await ensureSchema();
  await (await getPool()).query(
    `UPDATE spx_open_play SET status = 'closed', closed_at = NOW() WHERE session_date = $1::date AND status = 'open'`,
    [row.session_date]
  );
  const res = await (await getPool()).query<{ id: string }>(
    `
    INSERT INTO spx_open_play (
      session_date, direction, entry_price, stop, target, grade, headline, opened_at, status,
      option_strike, option_type, option_label, option_premium
    )
    VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12)
    RETURNING id
    `,
    [
      row.session_date,
      row.direction,
      row.entry_price,
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
  return Number(res.rows[0]?.id ?? 0);
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

export async function closeOpenSpxPlayRow(id: number): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
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
  }
): Promise<void> {
  await ensureSchema();
  await (await getPool()).query(
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
