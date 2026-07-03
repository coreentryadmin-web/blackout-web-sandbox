// Cron: pre-warm the Night's Watch shared options snapshot + chain caches.
// Schedule: ~every 60s during market hours (registered in cron-registry.ts as
// "nights-watch-warm"; Railway wires the actual fire via railway.nights-watch-warm.toml).
//
// THE POINT: Night's Watch GET reads per-OCC unified snapshots first (fetchOptionsUnifiedSnapshot
// batched ≤250/call), then falls back to getNwChain(ticker, expiry) only when a leg is not
// snapshot-covered. This cron warms snapshots for every distinct held OCC, then warms chain bands
// ONLY for chains that still have unfound / missing / no-quote legs — avoiding redundant double
// Polygon fan-out when the unified snapshot already priced every contract.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { listDistinctOpenPositionChains, listDistinctOpenPositionContracts } from "@/lib/db";
import { autoCloseUnlistedOpenPositions } from "@/lib/nights-watch/unlisted-reconcile";
import { getNwChain } from "@/lib/nights-watch/chain-cache";
import { getNwTickerGex } from "@/lib/nights-watch/position-context";
import { buildOcc } from "@/lib/ws/options-socket";
import {
  fetchOptionsUnifiedSnapshot,
  setOptionSnapshots,
  type SnapshotFetchDiagnostics,
} from "@/lib/providers/options-snapshot";
import { isSpxTicker } from "@/lib/spx-desk-live";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";
import { tickerShard } from "@/lib/et-market-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Hard ceiling on chains warmed per run — protects the upstream + this function's budget. */
const MAX_CHAINS = Math.max(1, Number(process.env.NIGHTS_WATCH_WARM_MAX ?? "300"));

/**
 * Regular-trading-hours gate (DST-aware ET via etMinutes), weekdays only. Mirrors the
 * uw-cache-refresh intent of warming only while the chains actually move. `?force=1`
 * overrides for manual warms / off-hours testing.
 */
function inMarketHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = etMinutes(now);
  return mins >= etClock(9, 30) && mins <= etClock(16, 0);
}

/** Spread chain/GEX warms across N minute-rotating shards (audit R-20). */
const WARM_SHARDS = Math.max(1, Number(process.env.NIGHTS_WATCH_WARM_SHARDS ?? "6"));

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !inMarketHours()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside market hours (9:30 AM–4:00 PM ET weekdays) — use ?force=1 to override",
    };
    await logCronRun("nights-watch-warm", started, payload);
    return NextResponse.json(payload);
  }

  let chains: Array<{ ticker: string; expiry: string }> = [];
  try {
    chains = await listDistinctOpenPositionChains();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nights-watch-warm] chain lookup failed", error);
    await logCronRun("nights-watch-warm", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Chain lookup failed", detail }, { status: 500 });
  }

  const shard = Math.floor(Date.now() / 60_000) % WARM_SHARDS;
  const sharded = chains.filter((c) => tickerShard(c.ticker, WARM_SHARDS) === shard);

  const capped = sharded.slice(0, MAX_CHAINS);

  // Strike hints per (ticker, expiry) so getNwChain widens the band to include deep OTM/ITM legs.
  // Built from ALL open legs — not shard-filtered — so a chain fallback on this shard still
  // widens to every held strike on that (underlying, expiry).
  const strikesByChain = new Map<string, number[]>();
  let contracts: Awaited<ReturnType<typeof listDistinctOpenPositionContracts>> = [];
  try {
    contracts = await listDistinctOpenPositionContracts();
    for (const c of contracts) {
      const key = `${c.ticker.trim().toUpperCase()}|${c.expiry.slice(0, 10)}`;
      const arr = strikesByChain.get(key) ?? [];
      arr.push(c.strike);
      strikesByChain.set(key, arr);
    }
  } catch {
    /* best-effort — default band still warms ATM */
  }

  // PRIMARY: batch-warm DISTINCT held CONTRACTS via Massive unified snapshot (≤250/call).
  // NEVER shard-filter this pass — with ≤250 distinct OCCs it is one cheap batched call, and
  // sharding here left 5/6 of held legs cold on every tick (data-correctness false-FLAGged
  // real contracts as "unlisted"). Sharding below applies only to chain/GEX fallback.
  let snapWarmed = 0;
  let snapContracts = 0;
  let snapUnfound = 0;
  let snapNoQuote = 0;
  let snapMissing = 0;
  let snapshotWarmOk = false;
  const occsNeedingChain = new Set<string>();
  const chainKeysNeedingWarm = new Set<string>();
  try {
    const occs = Array.from(
      new Set(
        contracts
          .map((c) => buildOcc(c.ticker, c.expiry, c.option_type, c.strike))
          .filter((o): o is string => Boolean(o))
      )
    );
    snapContracts = occs.length;
    if (occs.length > 0) {
      const diag: SnapshotFetchDiagnostics = {
        requested: 0,
        found: 0,
        unfound: [],
        missing: [],
        noQuote: [],
      };
      const snaps = await fetchOptionsUnifiedSnapshot(occs, diag);
      await setOptionSnapshots(Array.from(snaps.values()));
      snapWarmed = snaps.size;
      snapUnfound = diag.unfound.length;
      snapNoQuote = diag.noQuote.length;
      snapMissing = diag.missing.length;
      snapshotWarmOk = true;
      for (const u of diag.unfound) occsNeedingChain.add(u.occ);
      for (const occ of diag.missing) occsNeedingChain.add(occ);
      for (const occ of diag.noQuote) occsNeedingChain.add(occ);
      for (const c of contracts) {
        const occ = buildOcc(c.ticker, c.expiry, c.option_type, c.strike);
        if (occ && occsNeedingChain.has(occ)) {
          chainKeysNeedingWarm.add(`${c.ticker.trim().toUpperCase()}|${c.expiry.slice(0, 10)}`);
        }
      }
      if (diag.unfound.length || diag.missing.length || diag.noQuote.length) {
        const unfoundStr = diag.unfound
          .slice(0, 20)
          .map((u) => `${u.occ}(${u.reason})`)
          .join(", ");
        console.warn(
          `[cron/nights-watch-warm] snapshot warmed ${snapWarmed}/${snapContracts} — ` +
            `unfound=${diag.unfound.length} no_quote=${diag.noQuote.length} missing=${diag.missing.length}` +
            (unfoundStr ? ` | unfound: ${unfoundStr}` : "") +
            (diag.noQuote.length ? ` | no_quote: ${diag.noQuote.slice(0, 20).join(", ")}` : "") +
            (diag.missing.length ? ` | missing: ${diag.missing.slice(0, 20).join(", ")}` : "")
        );
      }
      if (diag.unfound.length > 0) {
        const closedUnlisted = await autoCloseUnlistedOpenPositions(diag.unfound);
        if (closedUnlisted > 0) {
          console.log(`[cron/nights-watch-warm] auto-closed ${closedUnlisted} unlisted open position(s)`);
        }
      }
    } else {
      snapshotWarmOk = true;
    }
  } catch (error) {
    console.warn(
      `[cron/nights-watch-warm] snapshot warm failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // FALLBACK: warm chain bands only for legs the snapshot did not cover — or all chains when
  // the snapshot pass failed entirely (preserves prior safety).
  const chainsToWarm =
    snapshotWarmOk && chainKeysNeedingWarm.size > 0
      ? capped.filter((c) =>
          chainKeysNeedingWarm.has(`${c.ticker.trim().toUpperCase()}|${c.expiry.slice(0, 10)}`)
        )
      : snapshotWarmOk
        ? []
        : capped;

  const results = await Promise.allSettled(
    chainsToWarm.map(({ ticker, expiry }) => {
      const key = `${ticker.trim().toUpperCase()}|${expiry.slice(0, 10)}`;
      return getNwChain(ticker, expiry, strikesByChain.get(key) ?? []);
    })
  );

  let warmed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") warmed += 1;
  }
  const failed = results.length - warmed;
  if (failed > 0) {
    console.warn(`[cron/nights-watch-warm] ${failed} chain warm(s) failed`);
  }

  // Also warm per-ticker GEX for the DISTINCT NON-SPX underlyings, so the verdict engine's
  // wall context (getNwTickerGex → fetchGexHeatmap, cached per ticker) is a pure cache hit on
  // the user-facing GET instead of paying upstream latency on first read. SPX/SPXW GEX comes
  // from the shared desk cron (source:"spx-desk"), not getNwTickerGex — skip it here. Each
  // ticker is deduped via withServerCache; best-effort, and a GEX failure never affects the
  // chain-warm result above.
  const gexTickers = Array.from(
    new Set(capped.map((c) => c.ticker.trim().toUpperCase()))
  ).filter((tkr) => !isSpxTicker(tkr));
  const gexResults = await Promise.allSettled(gexTickers.map((tkr) => getNwTickerGex(tkr)));
  let gexWarmed = 0;
  for (const r of gexResults) {
    if (r.status === "fulfilled") gexWarmed += 1;
  }
  const gexFailed = gexResults.length - gexWarmed;
  if (gexFailed > 0) {
    console.warn(`[cron/nights-watch-warm] ${gexFailed} GEX warm(s) failed`);
  }

  // ok:false (=> failed status + critical alert) only when the WHOLE batch fails; a
  // partial failure logs ok with the count so one flaky underlying doesn't page ops.
  const allFailed = chainsToWarm.length > 0 && failed === chainsToWarm.length;
  await logCronRun("nights-watch-warm", started, {
    ok: !allFailed,
    warm_shard: shard,
    warm_shards: WARM_SHARDS,
    warmed,
    failed,
    total: chainsToWarm.length,
    chain_fallback_total: capped.length,
    distinct_chains: chains.length,
    distinct_chains_shard: sharded.length,
    gex_warmed: gexWarmed,
    gex_total: gexTickers.length,
    snapshot_warmed: snapWarmed,
    snapshot_contracts: snapContracts,
    snapshot_unfound: snapUnfound,
    snapshot_no_quote: snapNoQuote,
    snapshot_missing: snapMissing,
    chains_skipped_snapshot_hit: Math.max(0, capped.length - chainsToWarm.length),
    capped: chains.length > capped.length,
    ...(failed > 0 ? { error: `${failed}/${chainsToWarm.length} chain warm(s) failed` } : {}),
  });

  return NextResponse.json({
    ok: true,
    warm_shard: shard,
    warm_shards: WARM_SHARDS,
    warmed,
    total: chainsToWarm.length,
    chain_fallback_total: capped.length,
    distinct_chains: chains.length,
    gex_warmed: gexWarmed,
    gex_total: gexTickers.length,
    snapshot_warmed: snapWarmed,
    snapshot_contracts: snapContracts,
    snapshot_unfound: snapUnfound,
    snapshot_no_quote: snapNoQuote,
    snapshot_missing: snapMissing,
    chains_skipped_snapshot_hit: Math.max(0, capped.length - chainsToWarm.length),
  });
}
