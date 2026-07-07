// 0DTE Command — market-wide earnings-match cache (cache-reader rule).
//
// Relocated from the deleted classic-Grid "Earnings Radar" panel (src/lib/providers/grid.ts,
// removed 2026-07-07 when classic Grid was deleted entirely). The panel/UI is gone, but this
// snapshot is a REAL, active dependency: zerodte-service.ts's buildZeroDteBoardPayload() calls
// readGridEarnings() to flag setups on tickers reporting today/tomorrow (via board.ts's
// matchEarnings()). So the fetch+cache pair moves here instead of dying with the rest of Grid.
//
// Cache-reader rule preserved as-is: one cluster-wide writer (now the `zerodte-warm` cron, see
// src/app/api/cron/zerodte-warm/route.ts) pulls UW's premarket/afterhours earnings feeds ONCE
// per warm window and writes this snapshot to Redis; readGridEarnings() below only ever reads
// that snapshot (falling back to a direct fetch on a cold cache, same as before the move).
//
// Naming: the Redis key literal ("grid:earnings") and the warmGridEarnings/readGridEarnings
// function names are kept verbatim on purpose — renaming the key would cold-miss the live
// production cache on deploy for zero benefit (it's an internal implementation detail with no
// external consumer), and keeping the function names matches the two call sites unchanged
// (zerodte-service.ts, cron/zerodte-warm/route.ts) so this move is a pure import-path change.
// Only the exported TYPE names drop the "Grid" prefix (GridEarnings* -> ZeroDteEarnings*) since
// they no longer describe a Grid panel.

import {
  getUwCacheRedis,
  uwCacheGet,
  uwCacheSet,
} from "@/lib/providers/uw-shared-cache";
import {
  fetchUwEarningsPremarket,
  fetchUwEarningsAfterhours,
} from "@/lib/providers/unusual-whales";

/** Exported so cron-writer-target-fresh.ts can freshness-probe the raw Redis key without
 *  triggering a live upstream fetch (readGridEarnings() falls back to fetching on a cache miss). */
export const ZERODTE_EARNINGS_KEY = "grid:earnings";
const ZERODTE_EARNINGS_TTL = 300; // 5 min — earnings reporters update a few times per day

export type ZeroDteEarningsItem = {
  ticker: string;
  name: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
  /** Report (earnings) date, ISO yyyy-mm-dd. */
  report_date: string | null;
  /** Options-implied expected move around the print, as a percent (e.g. 11.5). */
  expected_move_pct: number | null;
  when: "premarket" | "afterhours";
};

export type ZeroDteEarningsSnapshot = {
  as_of: string;
  items: ZeroDteEarningsItem[];
};

function shapeEarningsRows(
  rows: Record<string, unknown>[],
  when: "premarket" | "afterhours"
): ZeroDteEarningsItem[] {
  return rows.map((r) => {
    // UW /api/earnings/{premarket,afterhours} field names: street_mean_est, actual_eps,
    // full_name, report_date, expected_move_perc (fraction). Older fallbacks kept for safety.
    const epsEst = r.street_mean_est ?? r.eps_estimate ?? r.estimate ?? r.estimated_eps ?? null;
    const epsAct = r.actual_eps ?? r.eps_actual ?? r.actual ?? r.reported_eps ?? null;
    const est = epsEst != null ? Number(epsEst) : null;
    const act = epsAct != null ? Number(epsAct) : null;
    const surprise =
      est != null && act != null && est !== 0
        ? Number((((act - est) / Math.abs(est)) * 100).toFixed(1))
        : null;
    const emRaw = r.expected_move_perc ?? r.expected_move_pct ?? null;
    // UW returns expected_move_perc as a fraction (e.g. "0.1148"); render as a percent.
    const emPct = emRaw != null && Number.isFinite(Number(emRaw)) ? Number(emRaw) * 100 : null;
    return {
      ticker: String(r.ticker ?? r.symbol ?? "").toUpperCase(),
      name: String(r.full_name ?? r.name ?? r.company ?? ""),
      eps_estimate: est != null && Number.isFinite(est) ? est : null,
      eps_actual: act != null && Number.isFinite(act) ? act : null,
      surprise_pct: surprise != null && Number.isFinite(surprise) ? surprise : null,
      report_date: String(r.report_date ?? r.earnings_date ?? r.date ?? "").slice(0, 10) || null,
      expected_move_pct: emPct != null ? Number(emPct.toFixed(1)) : null,
      when,
    };
  }).filter((x) => x.ticker);
}

async function fetchEarnings(): Promise<ZeroDteEarningsSnapshot> {
  const [pm, ah] = await Promise.all([
    fetchUwEarningsPremarket(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "premarket")
    ).catch(() => [] as ZeroDteEarningsItem[]),
    fetchUwEarningsAfterhours(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "afterhours")
    ).catch(() => [] as ZeroDteEarningsItem[]),
  ]);
  return { as_of: new Date().toISOString(), items: [...pm, ...ah] };
}

export async function warmGridEarnings(): Promise<ZeroDteEarningsSnapshot | null> {
  const snapshot = await fetchEarnings();
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, ZERODTE_EARNINGS_KEY, ZERODTE_EARNINGS_TTL, snapshot);
  return snapshot.items.length ? snapshot : null;
}

export async function readGridEarnings(): Promise<ZeroDteEarningsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    ZERODTE_EARNINGS_KEY,
    ZERODTE_EARNINGS_TTL,
    () => fetchEarnings(),
  );
  return snapshot as ZeroDteEarningsSnapshot;
}
