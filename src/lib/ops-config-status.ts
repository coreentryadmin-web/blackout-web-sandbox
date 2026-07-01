import { aiSpendKillSwitchUsd, aiSpendAlertThresholdUsd } from "@/lib/ai-spend-ledger";

export type OpsConfigStatus = {
  ai_spend_kill_switch_armed: boolean;
  ai_spend_kill_usd: number | null;
  ai_spend_alert_usd: number;
  discord_ops_webhook: boolean;
  discord_play_webhook: boolean;
  pg_pool_max: number;
  database_via_pooler: boolean;
  pg_pooler_hint: string;
};

function databaseViaPooler(): { viaPooler: boolean; hint: string } {
  const raw =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    process.env.DATABASE_PUBLIC_URL?.trim() ||
    "";
  if (!raw) {
    return { viaPooler: false, hint: "DATABASE_URL unset" };
  }
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const viaPooler =
      host.includes("pgbouncer") ||
      host.includes("pooler") ||
      host.includes("proxy.rlwy") ||
      host.includes("-pool.");
    return {
      viaPooler,
      hint: viaPooler
        ? `pooler host (${host})`
        : `direct Postgres host (${host}) — enable PgBouncer per docs/PGBOUNCER-SETUP.md`,
    };
  } catch {
    return { viaPooler: false, hint: "DATABASE_URL not parseable" };
  }
}

/** Non-secret ops guardrail posture for admin dashboard (audit R-2/R-6/R-18). */
export function buildOpsConfigStatus(): OpsConfigStatus {
  const kill = aiSpendKillSwitchUsd();
  const pool = databaseViaPooler();
  const pgMax = Number(process.env.PG_POOL_MAX ?? "5");
  return {
    ai_spend_kill_switch_armed: kill != null,
    ai_spend_kill_usd: kill,
    ai_spend_alert_usd: aiSpendAlertThresholdUsd(),
    discord_ops_webhook: Boolean(process.env.DISCORD_OPS_WEBHOOK_URL?.trim()),
    discord_play_webhook: Boolean(process.env.DISCORD_PLAY_WEBHOOK_URL?.trim()),
    pg_pool_max: Number.isFinite(pgMax) && pgMax > 0 ? pgMax : 5,
    database_via_pooler: pool.viaPooler,
    pg_pooler_hint: pool.hint,
  };
}
