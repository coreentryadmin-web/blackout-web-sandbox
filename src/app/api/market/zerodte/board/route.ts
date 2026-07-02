// 0DTE Command board — the member-facing read of the ALWAYS-ON scanner (see
// src/lib/zerodte/scan.ts). A standalone product: the page shows ONLY the hunt —
// fresh single-name 0DTE finds and the graded session ledger. No SPX engine
// mirrors, no news/earnings panels, no other desk products (those live on their
// own pages). Night Hawk's tickers are still EXCLUDED from the lane server-side —
// a name members already have is a repeat, not a find — and earnings/news appear
// only as per-find evidence badges, never as standalone lanes.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { readGridEarnings } from "@/lib/providers/grid";
import { matchEarnings, matchHotNews, sessionHeat } from "@/lib/zerodte/board";
import { gradeZeroDteLedger, readZeroDteLedger, scanZeroDteBoard } from "@/lib/zerodte/scan";
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

/** One shared board build per BOARD_TTL_MS window across ALL pollers (single-flight
 *  in-process + Redis so replicas share too). The payload is user-independent —
 *  without this, every member's 15s poll would re-run the whole assembly (tape
 *  query, ledger query, enrichment orchestration) independently. Auth stays
 *  per-request. */
const BOARD_TTL_MS = 5_000;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    const payload = await withServerCache("zerodte:board:v1", BOARD_TTL_MS, buildBoardPayload);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/zerodte/board]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}

async function buildBoardPayload() {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);

  // News + earnings are fetched ONLY to badge individual finds (fresh headline on
  // the name, reports-tonight risk) — they are never rendered as their own lanes.
  // Both reads are shared caches (market-news key / grid's Redis snapshot): zero
  // extra upstream cost. The ledger is the scanner's session record.
  const [news, earningsSnap, ledger] = await Promise.all([
    serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15)).catch(() => []),
    readGridEarnings().catch(() => null),
    readZeroDteLedger(),
  ]);

  const nextDay = nextTradingDayEt(today);
  const earningsFlags = matchEarnings(earningsSnap?.items ?? [], { today, nextDay });
  const newsFlags = matchHotNews(news, Date.now());

  // The hunt itself — same pipeline the cron scanner runs every ~2 min. Between
  // cron ticks a member poll refreshes the live view; dossier enrichment is shared
  // through the same per-ticker cache either way.
  const { setups, nighthawk_covered } = await scanZeroDteBoard({
    earnings: earningsFlags,
    news: newsFlags,
  });

  // Opportunistic, throttled: grade any finished-session ledger rows.
  void gradeZeroDteLedger().catch(() => {});

  return roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    session: {
      date: today,
      trading_day: tradingDay,
      heat,
    },
    setups,
    // The always-on scanner's session record: every name flagged today, when it was
    // first flagged, at what price, and (after the close) how it graded.
    ledger: ledger.map((r) => ({
      ticker: r.ticker,
      direction: r.direction,
      score_max: r.score_max,
      spike: r.spike,
      first_flagged_at: r.first_flagged_at,
      underlying_at_flag: r.underlying_at_flag,
      top_strike: r.top_strike,
      conviction: r.conviction,
      entry_premium: r.entry_premium,
      flow_avg_fill: r.flow_avg_fill,
      move_pct: r.move_pct,
      direction_hit: r.direction_hit,
      plan_outcome: r.plan_outcome,
      plan_pnl_pct: r.plan_pnl_pct,
      graded: r.graded_at != null,
    })),
    // Names withheld because they're already published elsewhere on the desk —
    // surfaced so the UI can say WHY a hot ticker isn't listed.
    covered_elsewhere: nighthawk_covered,
  });
}
