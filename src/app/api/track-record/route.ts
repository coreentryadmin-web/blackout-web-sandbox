import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    // Live stats from signal_outcomes
    const spxStats = await dbQuery(
      `SELECT
         COUNT(*) FILTER (WHERE direction_correct IS NOT NULL) as total,
         COUNT(*) FILTER (WHERE direction_correct = true) as wins,
         COUNT(*) FILTER (WHERE direction_correct = false) as losses
       FROM signal_outcomes so
       JOIN signal_events se ON se.id = so.signal_event_id
       WHERE se.signal_source = 'SPX_SLAYER' AND so.checkpoint = 'T+30'`,
      []
    );
    const nhStats = await dbQuery(
      `SELECT
         COUNT(*) FILTER (WHERE pnl_pct IS NOT NULL) as total,
         COUNT(*) FILTER (WHERE pnl_pct > 0) as wins,
         COUNT(*) FILTER (WHERE pnl_pct <= 0) as losses,
         AVG(pnl_pct) FILTER (WHERE pnl_pct > 0) as avg_winner,
         AVG(pnl_pct) FILTER (WHERE pnl_pct <= 0) as avg_loser,
         SUM(pnl_pct) FILTER (WHERE pnl_pct > 0) as gross_wins,
         ABS(SUM(pnl_pct) FILTER (WHERE pnl_pct <= 0)) as gross_losses
       FROM signal_outcomes so
       JOIN signal_events se ON se.id = so.signal_event_id
       WHERE se.signal_source = 'NIGHT_HAWK' AND so.checkpoint = 'EOD'`,
      []
    );
    // Snapshot as fallback
    const snapshot = await dbQuery(
      "SELECT metadata FROM platform_briefs WHERE brief_type = 'track_record' ORDER BY brief_date DESC LIMIT 1",
      []
    );

    const spx = spxStats.rows[0];
    const nh = nhStats.rows[0];
    const spxWinRate =
      spx.total > 0 ? Math.round((spx.wins / spx.total) * 1000) / 10 : null;
    const nhWinRate =
      nh.total > 0 ? Math.round((nh.wins / nh.total) * 1000) / 10 : null;
    const profitFactor =
      nh.gross_losses > 0
        ? Math.round((nh.gross_wins / nh.gross_losses) * 100) / 100
        : null;

    const liveStats = {
      spxSlayer: {
        total: Number(spx.total),
        wins: Number(spx.wins),
        losses: Number(spx.losses),
        winRatePct: spxWinRate,
      },
      nightHawk: {
        total: Number(nh.total),
        wins: Number(nh.wins),
        losses: Number(nh.losses),
        winRatePct: nhWinRate,
        avgWinnerPct: nh.avg_winner
          ? Math.round(Number(nh.avg_winner) * 10) / 10
          : null,
        avgLoserPct: nh.avg_loser
          ? Math.round(Number(nh.avg_loser) * 10) / 10
          : null,
        profitFactor,
      },
      methodology:
        "All signals recorded at generation time. T+30 checkpoint for SPX Slayer, EOD for Night Hawk. Includes all signals — no cherry-picking.",
      liveData: true,
    };

    // If no live data yet, return last snapshot
    if (
      spx.total === 0 &&
      nh.total === 0 &&
      snapshot.rows.length > 0
    ) {
      return NextResponse.json(
        { ...snapshot.rows[0].metadata, liveData: false },
        { headers: NO_STORE }
      );
    }

    return NextResponse.json(liveStats, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false }, { headers: NO_STORE });
  }
}
