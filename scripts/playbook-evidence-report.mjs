#!/usr/bin/env node
/**
 * Playbook evidence report — OOS-only expectancy + session-aware promotion gates.
 * Requires DATABASE_URL. Never uses pre-OOS_START training rows for promotion stats.
 */
import { execSync } from "node:child_process";
import { evaluatePlaybookPromotion, isCounterfactualComparableEval } from "../src/features/spx/lib/playbook-promotion-eval.ts";
import { marketConditionBucket } from "../src/features/spx/lib/playbook-market-condition-bucket.ts";

const OOS_START = process.env.PLAYBOOK_OOS_START_DATE ?? "2026-07-10";
const TRAIN_CUTOFF = process.env.PLAYBOOK_TRAIN_CUTOFF_DATE ?? "2026-07-07";

function loadDbUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  try {
    const raw = execSync(
      `aws secretsmanager get-secret-value --secret-id "${process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env"}" --query SecretString --output text`,
      { encoding: "utf8" }
    );
    const secret = JSON.parse(raw);
    if (secret.DATABASE_URL) return secret.DATABASE_URL;
  } catch {
    /* local / no aws */
  }
  return null;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function snapshotFromTriggerEvent(row) {
  const snap = row.trigger_feature_snapshot;
  if (!snap || typeof snap !== "object") return null;
  return snap;
}

function buildPromotionSample(rows, playbookId) {
  const pb = rows.filter((r) => r.playbook_id === playbookId);
  const triggered = pb.filter((r) => r.triggered_at).length;
  const simulated = pb.filter(
    (r) => r.opened_at && (r.has_execution_sim || r.option_contract_candidate)
  ).length;
  const cfComparable = pb.filter((r) => isCounterfactualComparableEval(r.counterfactual_eval)).length;

  const trades = pb
    .filter((r) => r.pnl_pts != null && r.outcome && r.outcome !== "open")
    .map((r) => {
      const snap = snapshotFromTriggerEvent(r);
      const sim = r.execution_sim && typeof r.execution_sim === "object" ? r.execution_sim : null;
      const roundTrip =
        sim?.round_trip_cost_pts != null ? Number(sim.round_trip_cost_pts) : null;
      return {
        session_date: r.session_date,
        return_pts: Number(r.pnl_pts),
        round_trip_cost_pts: roundTrip,
        market_condition_bucket: snap
          ? marketConditionBucket({
              vix: snap.vix,
              gamma_regime: snap.gamma_regime,
              regime: snap.regime,
            })
          : null,
        has_execution_sim: Boolean(sim),
        counterfactual_comparable: isCounterfactualComparableEval(r.counterfactual_eval),
      };
    });

  return {
    playbook_id: playbookId,
    triggers: triggered,
    simulated_trades: simulated,
    trades,
    counterfactual_comparable_count: cfComparable,
  };
}

function summarize(rows, playbookId) {
  const pb = rows.filter((r) => r.playbook_id === playbookId);
  const armed = pb.filter((r) => r.armed_at).length;
  const triggered = pb.filter((r) => r.triggered_at).length;
  const blocked = pb.filter((r) => r.reason_blocked || r.blocked_events > 0).length;
  const opened = pb.filter((r) => r.opened_at).length;
  const closed = pb.filter((r) => r.outcome && r.outcome !== "open" && r.pnl_pts != null);
  const pnls = closed.map((r) => Number(r.pnl_pts));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const cfComparable = pb.filter((r) => isCounterfactualComparableEval(r.counterfactual_eval));
  const cfMfe = cfComparable
    .map((r) => Number(r.counterfactual_mfe_pts ?? 0))
    .filter((n) => n > 0);
  const cfMae = cfComparable
    .map((r) => Number(r.counterfactual_mae_pts ?? 0))
    .filter((n) => n > 0);

  const uniqueSessions = new Set(pb.map((r) => r.session_date)).size;
  const promotion = evaluatePlaybookPromotion(buildPromotionSample(rows, playbookId));

  return {
    playbook_id: playbookId,
    armed,
    triggered,
    blocked,
    executable_proxy: triggered - blocked,
    opened,
    closed: closed.length,
    unique_sessions: uniqueSessions,
    win_rate: pnls.length ? wins.length / pnls.length : null,
    mean_return_pts: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null,
    median_return_pts: median(pnls),
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy_pts: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null,
    median_mae_pts: median(closed.map((r) => Number(r.mae_pts ?? 0))),
    median_mfe_pts: median(closed.map((r) => Number(r.mfe_pts ?? 0))),
    median_counterfactual_mfe: median(cfMfe),
    median_counterfactual_mae: median(cfMae),
    counterfactual_comparable_instances: cfComparable.length,
    promotion_tier: promotion.tier,
    promotion_stats: promotion.stats,
    promotion_gates_failed: promotion.gates.filter((g) => !g.pass).map((g) => g.gate),
  };
}

async function main() {
  const dbUrl = loadDbUrl();
  if (!dbUrl) {
    console.error("SKIP: DATABASE_URL not configured");
    process.exit(0);
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  const res = await pool.query(
    `
    SELECT
      i.instance_id,
      i.session_date::text,
      i.playbook_id,
      i.armed_at,
      i.triggered_at,
      i.opened_at,
      i.reason_blocked,
      i.counterfactual_mfe_pts,
      i.counterfactual_mae_pts,
      i.counterfactual_eval,
      i.option_contract_candidate,
      o.pnl_pts,
      o.mfe_pts,
      o.mae_pts,
      o.outcome,
      o.option_ticket,
      (SELECT COUNT(*)::int FROM spx_playbook_instance_events e
        WHERE e.instance_id = i.instance_id AND e.event_type = 'blocked') AS blocked_events,
      (SELECT e.feature_snapshot FROM spx_playbook_instance_events e
        WHERE e.instance_id = i.instance_id AND e.event_type = 'triggered'
        ORDER BY e.observed_at ASC LIMIT 1) AS trigger_feature_snapshot
    FROM spx_playbook_instances i
    LEFT JOIN spx_play_outcomes o
      ON o.outcome <> 'open'
     AND (
       o.playbook_instance_id = i.instance_id
       OR (
         o.playbook_instance_id IS NULL
         AND o.playbook_id = i.playbook_id
         AND o.session_date = i.session_date
         AND o.direction IS NOT DISTINCT FROM i.direction
       )
     )
    WHERE i.session_date >= $1::date
    ORDER BY i.session_date, i.playbook_id
    `,
    [OOS_START]
  );

  const trainCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM spx_play_outcomes WHERE session_date <= $1::date AND playbook_id IS NOT NULL`,
    [TRAIN_CUTOFF]
  );

  await pool.end();

  const rows = res.rows.map((r) => ({
    ...r,
    execution_sim:
      r.option_ticket && typeof r.option_ticket === "object"
        ? r.option_ticket.execution_sim ?? null
        : null,
    has_execution_sim: Boolean(
      r.option_ticket &&
        typeof r.option_ticket === "object" &&
        r.option_ticket.execution_sim
    ),
  }));

  const playbooks = [...new Set(rows.map((r) => r.playbook_id))].sort();

  console.log(`PLAYBOOK_EVIDENCE_REPORT oos_since=${OOS_START} train_cutoff=${TRAIN_CUTOFF}`);
  console.log(`train_labeled_outcomes_excluded=${trainCount.rows[0]?.n ?? 0} (not used below)`);
  console.log(`oos_instance_rows=${rows.length}`);
  console.log(
    "policy: promotion uses sessions + market_conditions; counterfactual stats only comparable rows"
  );

  if (!rows.length) {
    console.log("NO_DATA: accumulate prospective shadow instances on staging first");
    process.exit(0);
  }

  for (const pb of playbooks) {
    const s = summarize(rows, pb);
    console.log(JSON.stringify(s));
  }

  const allPnls = rows
    .filter((r) => r.pnl_pts != null && r.outcome !== "open")
    .map((r) => Number(r.pnl_pts));
  console.log(
    JSON.stringify({
      playbook_id: "ALL_OOS",
      closed: allPnls.length,
      unique_sessions: new Set(rows.map((r) => r.session_date)).size,
      mean_return_pts: allPnls.length ? allPnls.reduce((a, b) => a + b, 0) / allPnls.length : null,
      win_rate: allPnls.length ? allPnls.filter((p) => p > 0).length / allPnls.length : null,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
