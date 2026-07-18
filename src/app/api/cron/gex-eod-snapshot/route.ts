// Cron: capture the END-OF-DAY GEX close snapshot for the heatmap watchlist, so the BlackOut
// Heat Maps can anchor day-over-day ("vs prior close" — flip / wall / net-GEX drift pros rely on).
//
// THE POINT: appendGexEodSnapshot(ticker) is a CACHE-READER — it reads the SHARED cached GEX
// matrix via fetchGexHeatmap(ticker) (no new upstream beyond what the matrix already does) and
// persists the compact close levels to the rolling `gex-eod:{ticker}` Redis list (one entry per
// trading day, idempotent). fetchGexHeatmap then surfaces a `history_context` block on the payload
// computed by diffing the live matrix vs the most recent prior-day snapshot.
//
// SCHEDULE (infra-owned — DO NOT edit cron config from here): this should fire ~4:10pm ET on
// trading days, AFTER the close so the matrices reflect the settled book. Per the project's cron
// convention the schedule REGISTRATION needs an ECS task definition + a
// `scripts/hit-cron.mjs` entry hitting `/api/cron/gex-eod-snapshot` with `Authorization: Bearer
// ${CRON_SECRET}` (the same Bearer pattern this route authenticates with). Registering that
// schedule is infra-owned and intentionally NOT done in this PR. The route also works on-demand —
// admin "Run now" / a manual Bearer call — so it is useful before the schedule lands.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { appendGexEodSnapshot } from "@/lib/providers/polygon-options-gex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Heatmap preset watchlist — mirrors the GexHeatmap.tsx PRESET_TICKERS (that list is component-
 * local and not exported, so it is duplicated here intentionally). Index roots (SPX) resolve to
 * their I:* options root inside fetchGexHeatmap now that the index-snapshot P0 is fixed.
 */
const EOD_WATCHLIST = [
  "SPY", "SPX", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "GOOGL",
] as const;

/** Snapshot the watchlist in small batches so a cold matrix can't burst the chain limiter. */
const EOD_BATCH_SIZE = 3;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshotted: string[] = [];
  const skipped: string[] = [];

  // Sequential small batches: the matrices are mostly cache-warm from the trading day, and a cold
  // one is a single SHARED compute — batching keeps us from firing several cold computes at once.
  // Best-effort PER TICKER: one failure (settled rejection or null result) never aborts the rest.
  for (let i = 0; i < EOD_WATCHLIST.length; i += EOD_BATCH_SIZE) {
    const batch = EOD_WATCHLIST.slice(i, i + EOD_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((ticker) => appendGexEodSnapshot(ticker))
    );
    results.forEach((r, idx) => {
      const ticker = batch[idx];
      // A null result (no spot / empty chain / Redis miss) is a skip, not a failure — the snapshot
      // is only persisted when there is a real close to anchor.
      if (r.status === "fulfilled" && r.value) snapshotted.push(ticker);
      else skipped.push(ticker);
    });
  }

  // ok stays true even on partial skips (a thin/closed ticker shouldn't page ops); only a TOTAL
  // failure across the whole watchlist marks the run failed.
  const allSkipped = snapshotted.length === 0 && EOD_WATCHLIST.length > 0;
  await logCronRun("gex-eod-snapshot", started, {
    ok: !allSkipped,
    // NOTE: keyed `*_count` to avoid colliding with CronRunPayload's typed `skipped?: boolean`.
    snapshotted_count: snapshotted.length,
    skipped_count: skipped.length,
    total: EOD_WATCHLIST.length,
    ...(allSkipped ? { error: "No EOD snapshots captured for any watchlist ticker" } : {}),
  });

  return NextResponse.json({ ok: true, snapshotted, skipped });
}
