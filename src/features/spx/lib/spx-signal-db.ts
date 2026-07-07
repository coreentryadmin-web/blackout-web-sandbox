/**
 * DB helpers for spx_signal_observations — every-minute RTH signal snapshots.
 * One row per cron tick: all factor weights, raw market values, and (after ~30 min)
 * the outcome price so we can measure which signals actually predict direction.
 */
import { dbQuery, ensureSchema } from "@/lib/db";

/** @deprecated The DDL this used to run here (its own CREATE TABLE/INDEX/ALTER
 *  block, guarded only by an in-process boolean) is now part of db.ts's main
 *  migration path under pg_advisory_lock(42) — see the comment there. That
 *  in-process guard did nothing across REPLICA_COUNT concurrent replicas
 *  booting from the same deploy, and caused a live Postgres deadlock
 *  (docs/audit/FINDINGS.md, 2026-07-03) when two fresh replicas ran the same
 *  multi-statement DDL at once. Kept as a thin ensureSchema() call so the 3
 *  existing call sites don't need to change; every dbQuery() call already
 *  runs ensureSchema() internally, so this is now redundant but harmless. */
export async function initSpxSignalTables(): Promise<void> {
  await ensureSchema();
}

export type SpxSignalObservationInsert = {
  price: number;
  vwap: number | null;
  price_vs_vwap: number | null;
  score: number;
  grade: string;
  direction: "long" | "short" | null;
  engine_action: string;
  session_window: string;
  vix: number | null;
  market_open: boolean;
  factors_json: Array<{ label: string; weight: number; detail: string }>;
  raw_json: Record<string, unknown>;
  gates_blocked_json: Array<{ gate: string; detail: string }>;
};

export async function insertObservation(obs: SpxSignalObservationInsert): Promise<string> {
  const res = await dbQuery<{ id: string }>(
    `INSERT INTO spx_signal_observations
      (price, vwap, price_vs_vwap, score, grade, direction,
       engine_action, session_window, vix, market_open,
       factors_json, raw_json, gates_blocked_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      obs.price, obs.vwap, obs.price_vs_vwap,
      obs.score, obs.grade, obs.direction,
      obs.engine_action, obs.session_window,
      obs.vix, obs.market_open,
      JSON.stringify(obs.factors_json),
      JSON.stringify(obs.raw_json),
      JSON.stringify(obs.gates_blocked_json),
    ]
  );
  return res.rows[0].id;
}

export type PendingOutcomeRow = {
  id: string;
  price: number;
};

/** Observations from 28–35 min ago with no outcome yet — fill with current price. */
export async function getPendingOutcomes(nowMs: number): Promise<PendingOutcomeRow[]> {
  const cutoff = new Date(nowMs - 28 * 60 * 1000).toISOString();
  const floor  = new Date(nowMs - 35 * 60 * 1000).toISOString();
  const res = await dbQuery<PendingOutcomeRow>(
    `SELECT id, price::float AS price
     FROM spx_signal_observations
     WHERE outcome_at IS NULL
       AND observed_at < $1
       AND observed_at > $2
     LIMIT 10`,
    [cutoff, floor]
  );
  return res.rows;
}

/** Fill the outcome: computes move and direction_correct in SQL. */
export async function updateOutcome(id: string, outcomePrice: number): Promise<void> {
  await dbQuery(
    `UPDATE spx_signal_observations
     SET outcome_at    = NOW(),
         outcome_price = $2,
         outcome_move  = $2 - price,
         direction_correct = CASE
           WHEN direction = 'long'  AND ($2 - price) > 0 THEN true
           WHEN direction = 'long'  AND ($2 - price) < 0 THEN false
           WHEN direction = 'short' AND ($2 - price) < 0 THEN true
           WHEN direction = 'short' AND ($2 - price) > 0 THEN false
           ELSE NULL
         END
     WHERE id = $1 AND outcome_at IS NULL`,
    [id, outcomePrice]
  );
}

export type SignalWeightReport = {
  signal_label: string;
  fire_count: number;
  avg_weight: number;
  accuracy_pct: number | null;
  baseline_accuracy_pct: number | null;
  edge_pct: number | null;
  bull_accuracy_pct: number | null;
  bear_accuracy_pct: number | null;
};

export async function insertWeightReport(
  lookbackDays: number,
  totalObs: number,
  baselinePct: number | null,
  report: SignalWeightReport[]
): Promise<void> {
  await dbQuery(
    `INSERT INTO spx_signal_weight_reports (lookback_days, total_obs, baseline_pct, report_json)
     VALUES ($1, $2, $3, $4)`,
    [lookbackDays, totalObs, baselinePct, JSON.stringify(report)]
  );
}

export async function getLatestWeightReport(): Promise<{
  computed_at: string;
  lookback_days: number;
  total_obs: number;
  baseline_pct: number | null;
  report: SignalWeightReport[];
} | null> {
  const res = await dbQuery<{
    computed_at: string;
    lookback_days: string;
    total_obs: string;
    baseline_pct: string | null;
    report_json: unknown;
  }>(
    `SELECT computed_at, lookback_days, total_obs, baseline_pct, report_json
     FROM spx_signal_weight_reports
     ORDER BY computed_at DESC
     LIMIT 1`
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    computed_at: row.computed_at,
    lookback_days: parseInt(row.lookback_days),
    total_obs: parseInt(row.total_obs),
    baseline_pct: row.baseline_pct != null ? parseFloat(row.baseline_pct) : null,
    report: typeof row.report_json === "string"
      ? JSON.parse(row.report_json)
      : (row.report_json as SignalWeightReport[]),
  };
}
