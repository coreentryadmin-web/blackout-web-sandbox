import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { VECTOR_DTE_HORIZONS } from "@/features/vector/lib/vector-dte-horizon";
import { computeVectorFullState } from "@/lib/bie/vector-full-state";
import { writeVectorFullStateCache } from "@/lib/bie/vector-full-state-cache";

// Continuous Vector full-state ingestion — the "non-stop feed" behind Largo-BIE.
//
// Every RTH tick this snapshots the COMPLETE Vector desk state (regime / walls + integrity / flip /
// magnet / max-pain / expected-move / ladder / heatmap / flow / beads + wall-dynamics / VEX /
// dark-pool / server technicals / the derived play) for every universe ticker × each DTE horizon
// and writes it to Redis (vector:full-state:{ticker}:{horizon}). Readers (get_ecosystem_context,
// the get_vector_full_state Largo tool, composeVectorRead) then read cache-first via
// fetchVectorFullState, so BIE serves the current state for any stock/horizon instantly without a
// per-query fan-out. Mirrors the vector-universe-snapshot cron's shape (isCronAuthorized + RTH gate
// + force + logCronRun); reuses the same Redis-cached chain, so a ticker's four horizons share one
// chain fetch.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stop composing new snapshots past this so we always return + log under maxDuration. */
const TIME_BUDGET_MS = 50_000;
/** Tickers processed concurrently — bounded so we never fan a burst of provider calls at once. */
const TICKER_CONCURRENCY = 3;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-full-state-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorUniverseTickers();
  let written = 0;
  let skippedNoSpot = 0;
  let failed = 0;
  let budgetHit = false;

  for (let i = 0; i < tickers.length; i += TICKER_CONCURRENCY) {
    // Time-budget guard: partial completion is fine — the snapshots carry `asOf`, and the next run
    // (or a reader's self-warm on miss) fills whatever this run didn't reach.
    if (Date.now() - started > TIME_BUDGET_MS) {
      budgetHit = true;
      break;
    }
    const batch = tickers.slice(i, i + TICKER_CONCURRENCY);
    await Promise.all(
      batch.map(async (ticker) => {
        for (const horizon of VECTOR_DTE_HORIZONS) {
          try {
            const state = await computeVectorFullState(ticker, horizon);
            if (state) {
              await writeVectorFullStateCache(ticker, horizon, state);
              written += 1;
            } else {
              // No live spot for this ticker/horizon (cold matrix, off-universe symbol) — honest skip.
              skippedNoSpot += 1;
            }
          } catch {
            failed += 1; // one ticker/horizon failing must never abort the sweep
          }
        }
      })
    );
  }

  const payload = {
    ok: true,
    tickers: tickers.length,
    horizons: VECTOR_DTE_HORIZONS.length,
    written,
    skippedNoSpot,
    failed,
    budgetHit,
    elapsedMs: Date.now() - started,
  };
  await logCronRun("vector-full-state-snapshot", started, payload);
  return NextResponse.json(payload);
}
