// Cron: pre-warm the Night's Watch shared options-chain cache.
// Schedule: ~every 60s during market hours (registered in cron-registry.ts as
// "nights-watch-warm"; Railway wires the actual fire via railway.nights-watch-warm.toml).
//
// THE POINT: Night's Watch GET reads a chain via getNwChain(ticker, expiry), which dedups
// per (ticker, expiry) through withServerCache. This cron walks the DISTINCT (ticker,
// expiry) of every user's OPEN positions and warms each one ONCE, so user-facing GETs
// become pure cache hits and never trigger a per-user upstream Polygon chain fetch.
// All upstream calls here flow through the permissive Polygon rate-limiter, so a warm
// burst can't trip the 429 breaker on the live desk/GEX path.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { listDistinctOpenPositionChains, listDistinctOpenPositionContracts } from "@/lib/db";
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

  const capped = chains.slice(0, MAX_CHAINS);

  // Strike hints per (ticker, expiry) so getNwChain widens the band to include deep OTM/ITM legs.
  const strikesByChain = new Map<string, number[]>();
  try {
    for (const c of await listDistinctOpenPositionContracts()) {
      const key = `${c.ticker.trim().toUpperCase()}|${c.expiry.slice(0, 10)}`;
      const arr = strikesByChain.get(key) ?? [];
      arr.push(c.strike);
      strikesByChain.set(key, arr);
    }
  } catch {
    /* best-effort — default band still warms ATM */
  }

  // getNwChain dedups per (ticker, expiry) via withServerCache, so warming each once is
  // enough. Settle-all so one failing underlying can't abort the rest. A null result
  // (unconfigured / no spot) is still a successful warm — the empty result is cached and
  // shields that underlying from per-user re-hammering for the TTL window.
  const results = await Promise.allSettled(
    capped.map(({ ticker, expiry }) => {
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

  // Also batch-warm the DISTINCT held CONTRACTS via the Massive unified snapshot: build each
  // contract's OCC, fetch in ≤250 chunks through the rate-limited Polygon funnel, and write
  // each into the per-OCC cache so the user-facing GET reads a warm cache hit (the per-OCC
  // valuation source ABOVE the chain). Upstream cost is O(distinct contracts / 250), not
  // O(positions). FULLY best-effort + isolated in its own try/catch: a snapshot failure NEVER
  // affects the chain-warm result or status above — the chain stays the valuation fallback.
  let snapWarmed = 0;
  let snapContracts = 0;
  // Per-OCC outcome diagnostics so a partial warm ("snapshot_warmed 1/4") reveals WHICH
  // contracts didn't price and why (unlisted/unfound vs no-quote vs missing-row), instead of a
  // silent count. Surfaced in both the cron-run log and a host-level warn line.
  let snapUnfound = 0;
  let snapNoQuote = 0;
  let snapMissing = 0;
  try {
    const contracts = await listDistinctOpenPositionContracts();
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
      // Log WHICH contracts didn't come back priced + the provider reason, so a "1/4" warm is
      // self-explaining. Unfound is almost always an UNLISTED contract (provider reason carried).
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
    }
  } catch (error) {
    // Never fails the chain warm — log host-level and move on (chain fallback unaffected).
    console.warn(
      `[cron/nights-watch-warm] snapshot warm failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // ok:false (=> failed status + critical alert) only when the WHOLE batch fails; a
  // partial failure logs ok with the count so one flaky underlying doesn't page ops.
  const allFailed = capped.length > 0 && failed === capped.length;
  await logCronRun("nights-watch-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    total: capped.length,
    distinct_chains: chains.length,
    gex_warmed: gexWarmed,
    gex_total: gexTickers.length,
    snapshot_warmed: snapWarmed,
    snapshot_contracts: snapContracts,
    snapshot_unfound: snapUnfound,
    snapshot_no_quote: snapNoQuote,
    snapshot_missing: snapMissing,
    capped: chains.length > capped.length,
    ...(failed > 0 ? { error: `${failed}/${capped.length} chain warm(s) failed` } : {}),
  });

  return NextResponse.json({
    ok: true,
    warmed,
    total: capped.length,
    distinct_chains: chains.length,
    gex_warmed: gexWarmed,
    gex_total: gexTickers.length,
    snapshot_warmed: snapWarmed,
    snapshot_contracts: snapContracts,
    snapshot_unfound: snapUnfound,
    snapshot_no_quote: snapNoQuote,
    snapshot_missing: snapMissing,
  });
}
