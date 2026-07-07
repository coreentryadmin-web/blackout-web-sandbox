// BLACKOUT Intelligence Engine — Layer 5 daily self-evaluation.
// The engine grades ITSELF every day with the same honesty it grades plays:
// router coverage, verification rate, latency by source, cost avoided, and the
// 0DTE ledger's session results — persisted into the knowledge store so future
// reasoning can cite its own track record. Numbers only; no adjectives.

import { dbConfigured, fetchBieInteractionStats, fetchZeroDteSetupLog } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";
import { storeKnowledge } from "./knowledge";

export type BieDailyReport = {
  date: string;
  interactions: {
    total: number;
    routed: number;
    claude: number;
    router_coverage_pct: number | null;
    verification_rate_pct: number | null;
    avg_latency_router_ms: number | null;
    avg_latency_claude_ms: number | null;
    /** Claude turns avoided by the router — the dependency-reduction number. */
    claude_calls_avoided: number;
  };
  zerodte: {
    plays: number;
    graded: number;
    wins: number;
    losses: number;
    win_rate_pct: number | null;
  };
};

/** Pure assembly from raw aggregates — unit-testable. */
export function assembleBieReport(
  date: string,
  stats: Awaited<ReturnType<typeof fetchBieInteractionStats>>,
  ledger: Array<{ plan_outcome: string | null; plan_pnl_pct: number | null }>
): BieDailyReport {
  const graded = ledger.filter((r) => r.plan_outcome && r.plan_outcome !== "ungradeable");
  const wins = graded.filter((r) => (r.plan_pnl_pct ?? 0) > 0).length;
  const pct = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;
  return {
    date,
    interactions: {
      total: stats.total,
      routed: stats.routed,
      claude: stats.claude,
      router_coverage_pct: pct(stats.routed, stats.total),
      verification_rate_pct:
        stats.avg_claims_total != null && stats.avg_claims_total > 0 && stats.avg_claims_verified != null
          ? Math.round((stats.avg_claims_verified / stats.avg_claims_total) * 1000) / 10
          : null,
      avg_latency_router_ms: stats.avg_latency_router_ms,
      avg_latency_claude_ms: stats.avg_latency_claude_ms,
      claude_calls_avoided: stats.routed,
    },
    zerodte: {
      plays: ledger.length,
      graded: graded.length,
      wins,
      losses: graded.length - wins,
      win_rate_pct: pct(wins, graded.length),
    },
  };
}

export function formatBieReport(r: BieDailyReport): string {
  const i = r.interactions;
  const z = r.zerodte;
  return [
    `BIE daily self-evaluation — ${r.date}`,
    ``,
    `Interactions: ${i.total} total; ${i.routed} answered by the deterministic router` +
      `${i.router_coverage_pct != null ? ` (${i.router_coverage_pct}% coverage)` : ""}; ${i.claude} by Claude.`,
    `Claude calls avoided: ${i.claude_calls_avoided}.`,
    i.verification_rate_pct != null
      ? `Claim verification: ${i.verification_rate_pct}% of numeric claims in Claude answers traced to turn data.`
      : `Claim verification: no Claude numeric claims measured.`,
    `Latency: router ${i.avg_latency_router_ms ?? "—"}ms vs Claude ${i.avg_latency_claude_ms ?? "—"}ms (avg).`,
    ``,
    `0DTE plays: ${z.plays} flagged; ${z.graded} graded — ${z.wins}W/${z.losses}L` +
      `${z.win_rate_pct != null ? ` (${z.win_rate_pct}% win rate)` : ""}.`,
  ].join("\n");
}

/** Build today's report, persist it into the knowledge store (kind: self_eval),
 *  and return it. Called daily by the db-cleanup cron; safe to call ad hoc. */
export async function runBieDailySelfEval(): Promise<BieDailyReport | null> {
  if (!dbConfigured()) return null;
  try {
    const date = todayEt();
    const [stats, ledger] = await Promise.all([
      fetchBieInteractionStats(24),
      fetchZeroDteSetupLog(date).catch(() => []),
    ]);
    const report = assembleBieReport(date, stats, ledger);
    await storeKnowledge("self_eval", `bie:self-eval:${date}`, formatBieReport(report)).catch(() => 0);
    return report;
  } catch {
    return null;
  }
}
