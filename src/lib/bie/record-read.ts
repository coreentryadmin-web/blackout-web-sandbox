import { buildPublicTrackRecord, type PublicTrackRecord } from "@/lib/track-record-public";
import type { BieComposed } from "@/lib/bie/composers-shared";

type ProductComparison = {
  days: number;
  spx_win_rate: number;
  spx_signal_count: number;
  nighthawk_win_rate: number;
  nighthawk_signal_count: number;
  nighthawk_pending_count: number;
  win_rate_delta: number;
  note?: string;
};

/** Deterministic track-record read for Largo BIE — public SPX aggregates + cross-product window stats. */
export async function composeRecordRead(): Promise<BieComposed> {
  const { runLargoTool } = await import("@/lib/largo/run-tool");
  const [record, comparison] = await Promise.all([
    buildPublicTrackRecord(),
    runLargoTool("get_spx_vs_nighthawk_comparison", { days: 30 }).catch(() => null) as Promise<
      ProductComparison | null
    >,
  ]);
  return {
    answer: formatRecordAnswer(record, comparison),
    context: { record, comparison },
  };
}

function pctRate(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

export function formatRecordAnswer(
  r: PublicTrackRecord,
  comparison: ProductComparison | null = null
): string {
  const lines = ["**Platform track record**", ""];

  lines.push("**SPX Slayer (published aggregate)**");
  if (!r.available || r.total_closed <= 0) {
    lines.push(
      "No closed plays in the published record yet — the desk is still building history."
    );
  } else {
    lines.push(
      `Closed plays: **${r.total_closed.toLocaleString()}** over ~**${r.days_of_data}** session day(s)`,
      `Win rate: **${r.win_rate_pct}%** (${r.wins}W / ${r.losses}L / ${r.breakeven}BE)`,
      "",
      "By path:",
      `- Cold buy: ${r.paths.cold_buy.count} plays · ${r.paths.cold_buy.win_rate_pct}% win · avg MFE ${r.paths.cold_buy.avg_mfe_pts} pts`,
      `- Watch → promote: ${r.paths.watch_promote.count} plays · ${r.paths.watch_promote.win_rate_pct}% win · avg MFE ${r.paths.watch_promote.avg_mfe_pts} pts`,
      `Adaptive gating: **${r.adaptive_active ? "active" : "standby"}**`,
      r.summary ? `Summary: ${r.summary}` : ""
    );
  }

  if (comparison && comparison.spx_signal_count + comparison.nighthawk_signal_count > 0) {
    lines.push(
      "",
      `**SPX Slayer vs Night Hawk (${comparison.days}-day rolling window)**`,
      `- SPX Slayer: ${pctRate(comparison.spx_win_rate)} win rate · ${comparison.spx_signal_count} closed signal(s)`,
      `- Night Hawk: ${pctRate(comparison.nighthawk_win_rate)} win rate · ${comparison.nighthawk_signal_count} graded pick(s)${comparison.nighthawk_pending_count > 0 ? ` · ${comparison.nighthawk_pending_count} still pending` : ""}`,
      `- Win-rate delta (SPX − NH): **${comparison.win_rate_delta >= 0 ? "+" : ""}${Math.round(comparison.win_rate_delta * 100)} pts**`,
      comparison.note ? `_${comparison.note}_` : ""
    );
  } else {
    lines.push(
      "",
      "**Night Hawk / cross-product comparison:** not enough graded history in the last 30 days to quote side-by-side stats."
    );
  }

  lines.push(
    "",
    "_BIE read from the same aggregations as `/track-record` — aggregate stats only, no per-trade rows or live trade advice._"
  );

  return lines.filter(Boolean).join("\n");
}
