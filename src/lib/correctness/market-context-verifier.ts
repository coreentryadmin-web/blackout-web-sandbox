import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";

// ---------------------------------------------------------------------------
// MARKET CONTEXT data-correctness verifier — priority surface #5.
//
// Confirms the market-context numbers the platform surfaces (SPX, VIX, sector %, breadth) against a
// SECOND source and recomputes breadth from constituents where available:
//   L4 cross-provider — desk SPX + VIX vs a SECOND Polygon index snapshot pull (I:SPX / I:VIX).
//      (The desk builds its VIX through one provider lane; a fresh index snapshot is an independent
//      read of the same index, so an agreement is a genuine cross-read confirmation.)
//   L1 shadow-recompute — market breadth (% advancing / advance-decline ratio) recomputed from the
//      Polygon grouped daily market summary (the per-constituent close vs prior close) and diffed
//      against the desk's served market_breadth. Sector % changes are bounded-checked (each sector
//      ETF % is a real daily return ⇒ |%| ≤ a sane ceiling; no NaN).
//   L3 sanity — VIX > 0, breadth ratios bounded, sector/leader % finite and within ±40%/day.
//
// RATE DISCIPLINE: the desk read is a CACHE-READER. The 2nd-source index snapshot is ONE bounded
// Polygon call (I:SPX,I:VIX batched). The breadth recompute reuses the SAME grouped-daily-summary
// endpoint the desk's breadth path uses, fetched ONCE for the prior session, behind
// CORRECTNESS_SHADOW_RAW (default ON). NO per-constituent fan-out — the grouped endpoint returns the
// whole market in one call. SPX-context only; no ticker loop.
//
// HONESTY: SPX + VIX become INDEPENDENTLY CONFIRMED when the 2nd index snapshot agrees. Breadth is a
// shadow-recompute against the platform's OWN source endpoint (confirms the aggregation, not that the
// constituent universe is the "right" one) ⇒ consistency-only unless a truly independent breadth
// provider is added. Sector % has no 2nd source today ⇒ consistency-only (bounded). All gaps recorded.
// ---------------------------------------------------------------------------

const TOL = {
  spotFractional: 0.005,
  vixFractional: 0.02, // VIX index snapshots between lanes can differ slightly more than SPX.
  breadthPctAbs: 5, // recomputed % advancing vs served (absolute pct points) — sampling/universe jitter.
  sectorPctCeiling: 40, // a single-day sector ETF move beyond ±40% is impossible ⇒ scale/units bug.
} as const;

type Ctx = { now: number; today: string };

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `MARKET:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/**
 * Verify the market-context numbers. SPX-context only; returns a TickerScore under "MARKET". Never throws.
 */
export async function verifyMarketContext(marketOpen: boolean): Promise<TickerScore> {
  const ticker = "MARKET";
  const ctx: Ctx = {
    now: Date.now(),
    today: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  };
  const checks: CheckResult[] = [];

  const bundle = await loadMergedSpxDesk().catch(() => null);
  const d = bundle?.merged;
  if (!d || !d.available) {
    const skip: CheckResult = {
      id: "MARKET:context:freshness:cold",
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: "Desk/market-context unavailable (cold) — nothing to verify this run.",
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  // ── L4 CROSS-PROVIDER: SPX + VIX vs a 2nd index snapshot ──────────────────
  {
    let idx: Record<string, { price: number } | null> = {};
    try {
      const { fetchIndexSnapshots } = await import("@/lib/providers/polygon");
      idx = await fetchIndexSnapshots(["I:SPX", "I:VIX"]);
    } catch {
      idx = {};
    }
    const spx2 = idx["I:SPX"]?.price ?? null;
    const vix2 = idx["I:VIX"]?.price ?? null;

    // SPX.
    if (Number(d.price) > 0 && spx2 != null && spx2 > 0) {
      const fd = fractionalDiff(Number(d.price), spx2);
      const ok = fd <= TOL.spotFractional;
      checks.push(
        mk(
          "cross-provider",
          "spx",
          ok ? "pass" : "flag",
          ok
            ? `Context SPX ${fmt(Number(d.price))} INDEPENDENTLY CONFIRMED by a 2nd index snapshot ${fmt(spx2)} (Δ ${(fd * 100).toFixed(3)}%).`
            : `Context SPX ${fmt(Number(d.price))} DISAGREES with the 2nd index snapshot ${fmt(spx2)} — Δ ${(fd * 100).toFixed(2)}%.`,
          { id: "spx-vs-2nd", expected: spx2, actual: Number(d.price), tolerance: TOL.spotFractional, independentlyConfirmed: ok }
        )
      );
    } else {
      checks.push(
        mk("cross-provider", "spx", "consistency-only", "2nd SPX index snapshot unavailable this run — context SPX consistency-only.", {
          id: "spx-vs-2nd",
        })
      );
    }

    // VIX.
    if (d.vix != null && d.vix > 0 && vix2 != null && vix2 > 0) {
      const fd = fractionalDiff(d.vix, vix2);
      const ok = fd <= TOL.vixFractional;
      checks.push(
        mk(
          "cross-provider",
          "vix",
          ok ? "pass" : "flag",
          ok
            ? `Context VIX ${fmt(d.vix)} INDEPENDENTLY CONFIRMED by a 2nd index snapshot ${fmt(vix2)} (Δ ${(fd * 100).toFixed(2)}%).`
            : `Context VIX ${fmt(d.vix)} DISAGREES with the 2nd index snapshot ${fmt(vix2)} — Δ ${(fd * 100).toFixed(2)}%.`,
          { id: "vix-vs-2nd", expected: vix2, actual: d.vix, tolerance: TOL.vixFractional, independentlyConfirmed: ok }
        )
      );
    } else {
      checks.push(
        mk("cross-provider", "vix", "consistency-only", "Context VIX or its 2nd snapshot unavailable this run — VIX consistency-only.", {
          id: "vix-vs-2nd",
        })
      );
    }
  }

  // ── L3 SANITY: sector % + leader % finite and within ±40%/day ─────────────
  {
    const allMoves: Array<{ label: string; pct: number }> = [
      ...(Array.isArray(d.sector_heat) ? d.sector_heat.map((s) => ({ label: s.ticker, pct: Number(s.change_pct) })) : []),
      ...(Array.isArray(d.leader_stocks) ? d.leader_stocks.map((s) => ({ label: s.ticker, pct: Number(s.change_pct) })) : []),
    ];
    if (allMoves.length === 0) {
      checks.push(
        mk("sanity-bound", "sector", "skipped", "No sector_heat / leader_stocks on the desk this run — sector % sanity skipped.", {
          id: "sector-pct-bounded",
        })
      );
    } else {
      const bad = allMoves.filter((m) => !Number.isFinite(m.pct) || Math.abs(m.pct) > TOL.sectorPctCeiling);
      checks.push(
        mk(
          "sanity-bound",
          "sector",
          bad.length === 0 ? "consistency-only" : "flag",
          bad.length === 0
            ? `All ${allMoves.length} sector/leader daily % moves are finite and within ±${TOL.sectorPctCeiling}%.`
            : `${bad.length} sector/leader % out of bounds (e.g. ${bad.slice(0, 4).map((b) => `${b.label} ${fmt(b.pct)}%`).join(", ")}) — a % scale/units bug.`,
          { id: "sector-pct-bounded", expected: `±${TOL.sectorPctCeiling}%`, actual: bad.length }
        )
      );
    }
  }

  // ── L3 SANITY + L1 RECOMPUTE: market breadth ──────────────────────────────
  {
    const mb = d.market_breadth;
    if (!mb) {
      checks.push(
        mk("sanity-bound", "breadth", "skipped", "No market_breadth on the desk this run — breadth checks skipped.", {
          id: "breadth-bounded",
        })
      );
    } else {
      // Sanity: pct_advancing ∈ [0,100], advance_decline_ratio ≥ 0.
      const pctAdv = mb.pct_advancing;
      const adr = mb.advance_decline_ratio;
      const sane =
        (pctAdv == null || (pctAdv >= 0 && pctAdv <= 100)) && (adr == null || adr >= 0) && mb.sample_size >= 0;
      checks.push(
        mk(
          "sanity-bound",
          "breadth",
          sane ? "consistency-only" : "flag",
          sane
            ? `Breadth bounded: %advancing ${fmt(pctAdv)} ∈ [0,100], A/D ratio ${fmt(adr)} ≥ 0, sample ${mb.sample_size}.`
            : `Breadth out of bounds: %advancing ${fmt(pctAdv)}, A/D ${fmt(adr)}, sample ${mb.sample_size} — aggregation/scale bug.`,
          { id: "breadth-bounded", actual: pctAdv ?? null }
        )
      );

      // L1 recompute from the grouped daily summary — MIRRORING the desk's breadth path EXACTLY.
      // The desk (spx-desk.ts: computeMarketBreadthFromSummary(dailyMarket(TODAY), fetchPriorDayCloses(TODAY)))
      // measures advance/decline as close-vs-PRIOR-CLOSE on the CURRENT session. A faithful shadow
      // recompute must use the SAME (session, reference) basis or it isn't comparing like-for-like:
      //   • prior version pulled the PRIOR session's grouped summary (wrong session), AND
      //   • called computeMarketBreadthFromSummary(results) with NO prior-close map, so it fell back to
      //     close-vs-OPEN (wrong reference). Either alone shifts %advancing; together they near-INVERT it
      //     (the 36.9-vs-62.9 false flag). Fixed: TODAY's summary + the prior-close map → identical basis.
      if (process.env.CORRECTNESS_SHADOW_RAW !== "0" && mb.sample_size > 0) {
        try {
          const { fetchDailyMarketSummary, fetchPriorDayCloses, computeMarketBreadthFromSummary } = await import(
            "@/lib/providers/polygon"
          );
          const date = ctx.today; // CURRENT session — same as the desk's fetchDailyMarketSummary(today)
          const [summary, priorCloses] = await Promise.all([
            fetchDailyMarketSummary(date),
            fetchPriorDayCloses(date).catch(() => ({} as Record<string, number>)),
          ]);
          const results = summary?.results ?? [];
          if (results.length > 50) {
            // Pass the prior-close map so advance/decline is close-vs-PRIOR-CLOSE (the desk's basis),
            // NOT the close-vs-open fallback. With it, this is a true like-for-like shadow recompute.
            const recomputed = computeMarketBreadthFromSummary(results, priorCloses);
            const myPct = recomputed.pct_advancing;
            const basis = Object.keys(priorCloses).length > 0 ? "close-vs-prior-close" : "close-vs-open (no prior-close map)";
            if (myPct != null && pctAdv != null) {
              const diff = Math.abs(myPct - pctAdv);
              const ok = diff <= TOL.breadthPctAbs;
              checks.push(
                mk(
                  "shadow-recompute",
                  "breadth",
                  ok ? "consistency-only" : "flag",
                  ok
                    ? `Recomputed %advancing ${fmt(myPct)} reconciles with served ${fmt(pctAdv)} (Δ ${diff.toFixed(1)}pp over ${results.length} constituents, ${basis}, same session basis as the desk).`
                    : `Recomputed %advancing ${fmt(myPct)} DIVERGES from served ${fmt(pctAdv)} — Δ ${diff.toFixed(1)}pp > ${TOL.breadthPctAbs}pp (breadth aggregation drift; recompute basis ${basis}).`,
                  { id: "breadth-recompute", expected: Number(myPct.toFixed(1)), actual: pctAdv, tolerance: TOL.breadthPctAbs }
                )
              );
            }
          } else {
            checks.push(
              mk("shadow-recompute", "breadth", "skipped", `Grouped daily summary for ${date} returned ${results.length} rows — too few to recompute breadth (market closed / not settled).`, {
                id: "breadth-recompute",
              })
            );
          }
        } catch {
          checks.push(
            mk("shadow-recompute", "breadth", "skipped", "Grouped daily summary fetch failed — breadth recompute skipped (not a flag).", {
              id: "breadth-recompute",
            })
          );
        }
      }
    }
  }

  void marketOpen;
  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
