import type { PlaybookDataQualityFlags } from "@/features/spx/lib/playbook-data-quality";
import { playbookDataQualityBlockReason } from "@/features/spx/lib/playbook-data-requirements";
import { marketConditionBucket } from "@/features/spx/lib/playbook-market-condition-bucket";
import {
  evaluatePlaybookPromotion,
  isCounterfactualComparableEval,
  type PlaybookPromotionEval,
} from "@/features/spx/lib/playbook-promotion-eval";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

export type PlaybookPromotionEvidenceRow = {
  instance_id: string;
  session_date: string;
  playbook_id: string;
  armed_at: string | null;
  triggered_at: string | null;
  opened_at: string | null;
  reason_blocked: string | null;
  counterfactual_mfe_pts: number | null;
  counterfactual_mae_pts: number | null;
  counterfactual_eval: unknown;
  option_contract_candidate: unknown;
  pnl_pts: number | null;
  mfe_pts: number | null;
  mae_pts: number | null;
  outcome: string | null;
  execution_sim: { round_trip_cost_pts?: number | null } | null;
  has_execution_sim: boolean;
  blocked_events: number;
  trigger_feature_snapshot: Record<string, unknown> | null;
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function snapshotFromTriggerEvent(row: PlaybookPromotionEvidenceRow) {
  const snap = row.trigger_feature_snapshot;
  if (!snap || typeof snap !== "object") return null;
  return snap;
}

function dataQualityFlagsFromSnapshot(
  snap: Record<string, unknown>
): PlaybookDataQualityFlags {
  return {
    halt_channel_stale: snap.halt_channel_stale === true,
    desk_stale: snap.desk_stale === true,
    gex_missing: snap.gex_missing === true,
  };
}

function deskSliceFromSnapshot(
  snap: Record<string, unknown>
): Pick<SpxDeskPayload, "vix" | "vwap_volume_weighted"> {
  const vix = snap.vix;
  return {
    vix: typeof vix === "number" && Number.isFinite(vix) ? vix : null,
    vwap_volume_weighted: snap.vwap_volume_weighted === true,
  };
}

/** Exported for unit tests — trigger-time snapshot data quality per playbook. */
export function sessionSnapshotDataQualityOk(
  snap: Record<string, unknown> | null,
  playbookId: string
): boolean | null {
  if (!snap) return null;
  const pbId = playbookId as PlaybookId;
  const opts =
    snap.option_quotes_available === false
      ? { option_quotes_available: false as const }
      : undefined;
  const blockReason = playbookDataQualityBlockReason(
    pbId,
    dataQualityFlagsFromSnapshot(snap),
    deskSliceFromSnapshot(snap),
    opts
  );
  return blockReason == null;
}

/** Fraction of triggered sessions with satisfactory trigger-time data quality. */
export function dataQualitySessionFraction(
  pbRows: readonly PlaybookPromotionEvidenceRow[],
  playbookId: string
): number | null {
  const bySession = new Map<string, boolean>();
  for (const r of pbRows) {
    if (!r.triggered_at) continue;
    const snap = snapshotFromTriggerEvent(r);
    const ok = sessionSnapshotDataQualityOk(snap, playbookId);
    if (ok === null) continue;
    const prev = bySession.get(r.session_date);
    bySession.set(r.session_date, prev == null ? ok : prev && ok);
  }
  if (!bySession.size) return null;
  const okCount = [...bySession.values()].filter(Boolean).length;
  return okCount / bySession.size;
}

export type PlaybookEvidenceAlertLevel = "fail" | "warn";

export type PlaybookEvidenceAlert = {
  level: PlaybookEvidenceAlertLevel;
  playbook_id: string;
  message: string;
};

const DEFAULT_EVIDENCE_ALLOWLIST = ["PB-01", "PB-02", "PB-03"] as const;

/**
 * Surface promotion evidence issues for GHA / ops — fail on wired gate breaks,
 * warn on insufficient tier while sample is still accumulating.
 */
export function assessPlaybookEvidenceAlerts(
  summaries: readonly PlaybookEvidenceSummary[],
  opts?: { allowlisted?: readonly string[] }
): PlaybookEvidenceAlert[] {
  const allowlisted = new Set(opts?.allowlisted ?? DEFAULT_EVIDENCE_ALLOWLIST);
  const alerts: PlaybookEvidenceAlert[] = [];

  for (const s of summaries) {
    if (!allowlisted.has(s.playbook_id)) continue;

    if (s.promotion_gates_failed.includes("data_quality_session_coverage")) {
      alerts.push({
        level: "fail",
        playbook_id: s.playbook_id,
        message: `data_quality_session_coverage gate failed (tier=${s.promotion_tier})`,
      });
    }

    if (s.promotion_tier === "insufficient" && s.triggered > 0) {
      const failed = s.promotion_gates_failed.filter((g) => g !== "data_quality_session_coverage");
      if (failed.length) {
        alerts.push({
          level: "warn",
          playbook_id: s.playbook_id,
          message: `insufficient tier (${failed.join(", ")}) with ${s.triggered} triggers`,
        });
      }
    }
  }

  return alerts;
}

export function buildPromotionSample(
  rows: readonly PlaybookPromotionEvidenceRow[],
  playbookId: string
) {
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
      const roundTrip =
        r.execution_sim?.round_trip_cost_pts != null
          ? Number(r.execution_sim.round_trip_cost_pts)
          : null;
      return {
        session_date: r.session_date,
        return_pts: Number(r.pnl_pts),
        round_trip_cost_pts: roundTrip,
        market_condition_bucket: snap
          ? marketConditionBucket({
              vix: snap.vix as number | null | undefined,
              gamma_regime: snap.gamma_regime as string | null | undefined,
              regime: snap.regime as string | null | undefined,
            })
          : null,
        has_execution_sim: Boolean(r.has_execution_sim),
        counterfactual_comparable: isCounterfactualComparableEval(r.counterfactual_eval),
      };
    });

  return {
    playbook_id: playbookId as PlaybookId,
    triggers: triggered,
    simulated_trades: simulated,
    trades,
    counterfactual_comparable_count: cfComparable,
    data_quality_session_fraction: dataQualitySessionFraction(pb, playbookId),
  };
}

export type PlaybookEvidenceSummary = {
  playbook_id: string;
  armed: number;
  triggered: number;
  blocked: number;
  executable_proxy: number;
  opened: number;
  closed: number;
  unique_sessions: number;
  win_rate: number | null;
  mean_return_pts: number | null;
  median_return_pts: number | null;
  profit_factor: number | null;
  expectancy_pts: number | null;
  median_mae_pts: number | null;
  median_mfe_pts: number | null;
  median_counterfactual_mfe: number | null;
  median_counterfactual_mae: number | null;
  counterfactual_comparable_instances: number;
  promotion_tier: PlaybookPromotionEval["tier"];
  promotion_stats: PlaybookPromotionEval["stats"];
  promotion_gates_failed: string[];
};

export function summarizePlaybookEvidence(
  rows: readonly PlaybookPromotionEvidenceRow[],
  playbookId: string
): PlaybookEvidenceSummary {
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

export function buildPlaybookPromotionReport(rows: readonly PlaybookPromotionEvidenceRow[]) {
  const playbooks = [...new Set(rows.map((r) => r.playbook_id))].sort();
  return playbooks.map((pb) => summarizePlaybookEvidence(rows, pb));
}
