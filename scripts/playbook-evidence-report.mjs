#!/usr/bin/env node
/**
 * Playbook evidence report — OOS-only expectancy + session-aware promotion gates.
 * Requires DATABASE_URL. Never uses pre-OOS_START training rows for promotion stats.
 *
 * Exit codes:
 *   0 — success, or NO_DATA (accumulation phase)
 *   1 — hard failure (DB/credentials) or fail-level evidence alerts (e.g. data_quality gate)
 */
import { execSync } from "node:child_process";
import {
  PLAYBOOK_OOS_START_DATE,
  PLAYBOOK_TRAIN_CUTOFF_DATE,
} from "../src/features/spx/lib/playbook-evidence-config.ts";
import {
  assessPlaybookEvidenceAlerts,
  buildPlaybookPromotionReport,
} from "../src/features/spx/lib/playbook-promotion-sample.ts";

function requireDbInCi(): boolean {
  return (
    process.env.PLAYBOOK_EVIDENCE_REQUIRE_DB === "1" ||
    Boolean(process.env.STAGING_SECRET_NAME?.trim()) ||
    Boolean(process.env.CI)
  );
}

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

async function notifyDiscordAlerts(alerts) {
  const webhook = process.env.DISCORD_OPS_WEBHOOK_URL?.trim();
  if (!webhook || !alerts.length) return;

  const fails = alerts.filter((a) => a.level === "fail");
  const warns = alerts.filter((a) => a.level === "warn");
  const lines = [
    "**Playbook promotion evidence**",
    fails.length ? `**FAIL (${fails.length})**` : null,
    ...fails.map((a) => `• \`${a.playbook_id}\` — ${a.message}`),
    warns.length ? `**WARN (${warns.length})**` : null,
    ...warns.map((a) => `• \`${a.playbook_id}\` — ${a.message}`),
  ].filter(Boolean);

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n").slice(0, 1900) }),
    });
  } catch (e) {
    console.error("DISCORD_NOTIFY_FAILED:", e.message || e);
  }
}

async function main() {
  const dbUrl = loadDbUrl();
  if (!dbUrl) {
    if (requireDbInCi()) {
      console.error("FAIL: DATABASE_URL not configured (CI/staging evidence requires DB)");
      process.exit(1);
    }
    console.error("SKIP: DATABASE_URL not configured");
    process.exit(0);
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  let res;
  let trainCount;
  try {
    res = await pool.query(
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
      [PLAYBOOK_OOS_START_DATE]
    );

    trainCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM spx_play_outcomes WHERE session_date <= $1::date AND playbook_id IS NOT NULL`,
      [PLAYBOOK_TRAIN_CUTOFF_DATE]
    );
  } finally {
    await pool.end();
  }

  const rows = res.rows.map((r) => ({
    instance_id: String(r.instance_id),
    session_date: String(r.session_date),
    playbook_id: String(r.playbook_id),
    armed_at: r.armed_at != null ? String(r.armed_at) : null,
    triggered_at: r.triggered_at != null ? String(r.triggered_at) : null,
    opened_at: r.opened_at != null ? String(r.opened_at) : null,
    reason_blocked: r.reason_blocked != null ? String(r.reason_blocked) : null,
    counterfactual_mfe_pts: r.counterfactual_mfe_pts != null ? Number(r.counterfactual_mfe_pts) : null,
    counterfactual_mae_pts: r.counterfactual_mae_pts != null ? Number(r.counterfactual_mae_pts) : null,
    counterfactual_eval: r.counterfactual_eval ?? null,
    option_contract_candidate: r.option_contract_candidate ?? null,
    pnl_pts: r.pnl_pts != null ? Number(r.pnl_pts) : null,
    mfe_pts: r.mfe_pts != null ? Number(r.mfe_pts) : null,
    mae_pts: r.mae_pts != null ? Number(r.mae_pts) : null,
    outcome: r.outcome != null ? String(r.outcome) : null,
    execution_sim:
      r.option_ticket && typeof r.option_ticket === "object"
        ? r.option_ticket.execution_sim ?? null
        : null,
    has_execution_sim: Boolean(
      r.option_ticket &&
        typeof r.option_ticket === "object" &&
        r.option_ticket.execution_sim
    ),
    blocked_events: Number(r.blocked_events ?? 0),
    trigger_feature_snapshot:
      r.trigger_feature_snapshot && typeof r.trigger_feature_snapshot === "object"
        ? r.trigger_feature_snapshot
        : null,
  }));

  console.log(`PLAYBOOK_EVIDENCE_REPORT oos_since=${PLAYBOOK_OOS_START_DATE} train_cutoff=${PLAYBOOK_TRAIN_CUTOFF_DATE}`);
  console.log(`train_labeled_outcomes_excluded=${trainCount.rows[0]?.n ?? 0} (not used below)`);
  console.log(`oos_instance_rows=${rows.length}`);
  console.log(
    "policy: promotion uses sessions + market_conditions; counterfactual stats only comparable rows"
  );

  if (!rows.length) {
    console.log("EVIDENCE_STATUS=no_data accumulate prospective shadow instances on staging first");
    process.exit(0);
  }

  const summaries = buildPlaybookPromotionReport(rows);
  for (const s of summaries) {
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

  const alerts = assessPlaybookEvidenceAlerts(summaries);
  for (const a of alerts) {
    console.log(`EVIDENCE_${a.level.toUpperCase()}: ${a.playbook_id} — ${a.message}`);
  }
  await notifyDiscordAlerts(alerts);

  const failures = alerts.filter((a) => a.level === "fail");
  if (failures.length) {
    console.error(`EVIDENCE_STATUS=fail alerts=${failures.length}`);
    process.exit(1);
  }
  console.log("EVIDENCE_STATUS=ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
