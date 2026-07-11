import {
  buildPlaybookPromotionReport,
  type PlaybookPromotionEvidenceRow,
} from "@/features/spx/lib/playbook-promotion-sample";
import {
  PLAYBOOK_OOS_START_DATE,
  PLAYBOOK_TRAIN_CUTOFF_DATE,
} from "@/features/spx/lib/playbook-evidence-config";
import {
  dbConfigured,
  dbQuery,
  fetchPlaybookPromotionEvidenceRows,
} from "@/lib/db";

export async function fetchPlaybookPromotionReport(opts?: { since_date?: string }) {
  if (!dbConfigured()) {
    return { available: false, reason: "database not configured" } as const;
  }

  const since = opts?.since_date ?? PLAYBOOK_OOS_START_DATE;
  const rows = (await fetchPlaybookPromotionEvidenceRows({
    since_date: since,
    oos_only: true,
  })) as PlaybookPromotionEvidenceRow[];

  const trainCount = await dbQuery<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM spx_play_outcomes WHERE session_date <= $1::date AND playbook_id IS NOT NULL`,
    [PLAYBOOK_TRAIN_CUTOFF_DATE]
  );
  const trainExcluded = Number(trainCount.rows[0]?.n ?? 0);

  const allPnls = rows
    .filter((r) => r.pnl_pts != null && r.outcome !== "open")
    .map((r) => Number(r.pnl_pts));

  return {
    available: true,
    as_of: new Date().toISOString(),
    oos_since: since,
    train_cutoff: PLAYBOOK_TRAIN_CUTOFF_DATE,
    train_labeled_outcomes_excluded: trainExcluded,
    oos_instance_rows: rows.length,
    playbooks: buildPlaybookPromotionReport(rows),
    rollup: {
      playbook_id: "ALL_OOS",
      closed: allPnls.length,
      unique_sessions: new Set(rows.map((r) => r.session_date)).size,
      mean_return_pts: allPnls.length ? allPnls.reduce((a, b) => a + b, 0) / allPnls.length : null,
      win_rate: allPnls.length ? allPnls.filter((p) => p > 0).length / allPnls.length : null,
    },
  };
}
