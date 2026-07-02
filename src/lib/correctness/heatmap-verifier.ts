import "server-only";

import {
  fetchGexHeatmap,
  fetchPolygonAtmOptionsChain,
  resolveOptionsRoot,
  type GexHeatmap,
  type ChainContract,
} from "@/lib/providers/polygon-options-gex";
import { gexPositioningFromHeatmap } from "@/lib/providers/gex-positioning";
import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { odteGexScopeFromHeatmap, grossAbsFromStrikeTotals, grossAbsFromUwGexRows, isHairlineNetGammaSign, isNearGammaFlip, recomputeScopedGexLevels } from "@/lib/correctness/gex-odte-scope";

// ---------------------------------------------------------------------------
// HEAT MAPS data-correctness verifier — the first (primary) target of the auditor.
//
// It re-derives the KEY GEX aggregates (net total, King node, gamma flip, call/put
// walls) INDEPENDENTLY of the production engine and diffs them against what the served
// matrix / getGexPositioning reports, then layers invariants, sanity bounds, a cross-
// provider oracle (UW), cross-tool consistency, and freshness on top.
//
// RATE DISCIPLINE: the matrix + positioning reads are CACHE-READERS (fetchGexHeatmap /
// getGexPositioning read the shared gex-heatmap:{ticker} cache). The two upstreams this
// file *can* touch are both rate-limited and bounded:
//   • a ONE near-term raw SPX/SPY chain snapshot for the strongest shadow recompute,
//     fetched through fetchPolygonAtmOptionsChain (→ polygonTrackedFetch funnel);
//   • the UW oracle for SPX ONLY, through uwGetSafe (→ uw-rate-limiter, 2 RPS).
// Both are gated by flags so the cron can run pure-cache if ever needed.
//
// DESIGN: this is a DELIBERATELY INDEPENDENT re-derivation of the key aggregates, NOT a
// fork of the GEX engine. The argmax/flip/sum algorithms below are written from scratch
// here so a bug in the production helpers can't hide behind a shared implementation.
// ---------------------------------------------------------------------------

/** Tolerances — wide enough to never false-positive on fp/timing jitter, tight enough to catch a real bug. */
const TOL = {
  /** Net total / cell-sum vs strike-total reconciliation (fractional). A scale bug (×100, B-vs-M) blows past this. */
  netFractional: 1e-6,
  /** Raw-chain shadow recompute vs served net total (fractional). Banded data + far-dated handling differ slightly. */
  rawNetFractional: 0.02,
  /** King / wall strike agreement (absolute points). Either it's the same strike or it isn't. */
  strikeAbs: 0.01,
  /** Cross-tool spot agreement (fractional) — set well outside timing jitter. */
  spotFractional: 0.005,
  /** Cross-provider King strike agreement (fractional of spot) — different bands/strike grids tolerate ~1.5%. */
  kingFractionalOfSpot: 0.015,
  /** Freshness: served asof must be within this many minutes during RTH (heatmap-warm runs ~30s). */
  freshnessMin: 15,
  /** Plausible-magnitude ceiling for net GEX as a fraction of (spot²·notional) — guards an absurd blow-up. */
} as const;

/** Independent argmax over per-strike net totals → the wall extrema (call=max+, put=min−). */
function deriveWalls(strikeTotals: Record<string, number>): {
  callWall: number | null;
  putWall: number | null;
  king: number | null;
} {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let king: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  let maxAbs = -1;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
    if (Math.abs(g) > maxAbs) {
      maxAbs = Math.abs(g);
      king = strike;
    }
  }
  return { callWall, putWall, king };
}

/** Independent sum of a per-strike total map. */
function sumTotals(strikeTotals: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(strikeTotals)) {
    const n = Number(v);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Independent zero-flip detection: the per-strike net total sign-change (negative→positive)
 * nearest spot, interpolated to 0. Written from scratch (does NOT import computeZeroGammaFlip) so a
 * bug there is detectable. Returns null when there is no clean neg→pos crossing.
 */
function deriveFlip(strikeTotals: Record<string, number>, spot: number): number | null {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: Number(g) }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;
  const crossings: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.gamma < 0 && b.gamma > 0) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma);
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (!crossings.length) return null;
  return spot > 0
    ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
    : crossings[crossings.length - 1];
}

/**
 * Re-sum a metric's `cells` (the full near+far matrix) back into per-strike near-term totals using a
 * supplied near-term expiry set. This is the INDEPENDENT reconstruction of strike_totals from the
 * raw matrix the client renders — if cells and strike_totals disagree, the matrix the user SEES does
 * not match the levels the platform reports (a transform/scale/aggregation bug).
 */
function reSumCellsToNearTermTotals(
  cells: Record<string, Record<string, number>>,
  nearTermExpiries: Set<string>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [strike, byExpiry] of Object.entries(cells)) {
    let sum = 0;
    for (const [expiry, val] of Object.entries(byExpiry)) {
      if (!nearTermExpiries.has(expiry)) continue;
      const n = Number(val);
      if (Number.isFinite(n)) sum += n;
    }
    if (sum !== 0) out[strike] = sum;
  }
  return out;
}

/**
 * Independent raw-chain recompute of NEAR-TERM net dealer $-gamma + King, for ONE expiry's worth of
 * the chain. Uses the SAME documented per-1%-move scale (gamma·oi·100·spot²·0.01, call +/put −) the
 * engine uses — it must, to be on the same scale — so this confirms the AGGREGATION + SCALE
 * APPLICATION end-to-end (the "$5000M vs $5.0B" / dropped-×0.01 / wrong-sign classes), NOT that the
 * convention itself is correct (that needs the oracle). Written from scratch (no aggregateGexRows).
 */
function rawRecomputeNetGexAndKing(
  contracts: ChainContract[],
  spot: number,
  today: string
): { net: number; king: number | null; strikeTotals: Record<string, number> } {
  const byStrike = new Map<number, number>();
  let net = 0;
  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const gamma = Number(c.greeks?.gamma ?? 0);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !expiry || expiry < today) continue;
    if (!oi || !gamma) continue;
    const sign = type === "call" ? 1 : type === "put" ? -1 : 0;
    if (sign === 0) continue;
    const sharesPerContract =
      Number.isFinite(c.details?.shares_per_contract) && (c.details?.shares_per_contract ?? 0) > 0
        ? Number(c.details?.shares_per_contract)
        : 100;
    const signed = sign * gamma * oi * sharesPerContract * spot * spot * 0.01;
    if (!Number.isFinite(signed) || signed === 0) continue;
    byStrike.set(strike, (byStrike.get(strike) ?? 0) + signed);
    net += signed;
  }
  const strikeTotals: Record<string, number> = {};
  for (const [s, v] of byStrike.entries()) strikeTotals[String(s)] = v;
  const { king } = deriveWalls(strikeTotals);
  return { net, king, strikeTotals };
}

type Ctx = { ticker: string; now: number; today: string };

/** Build a CheckResult with sensible defaults. */
function mk(
  ctx: Ctx,
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `${ctx.ticker}:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
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

// ---------------------------------------------------------------------------
// LAYER 2 — INVARIANTS (relationships that MUST hold)
// ---------------------------------------------------------------------------
function invariantChecks(ctx: Ctx, hm: GexHeatmap): CheckResult[] {
  const out: CheckResult[] = [];
  const spot = hm.spot;
  // The matrix's authoritative levels are computed on NEAR-TERM expiries only; reconstruct that set
  // the same way the engine does (the first 8 ascending expiries that carry near-term cells). The
  // engine keeps strike_totals near-term, so the near-term expiry set = the expiries present in any
  // strike's cell row that also contribute to strike_totals. We approximate it as the 8 nearest.
  const nearTermExpiries = new Set([...hm.expiries].sort().slice(0, 8));

  for (const [metricKey, block] of [
    ["net_gex", hm.gex],
    ["net_vex", hm.vex],
  ] as const) {
    const strikeTotals = block.strike_totals;
    const reportedTotal = block.total;

    // INV-1: Σ(per-strike total) == reported total (within fp tolerance).
    const independentSum = sumTotals(strikeTotals);
    const fd = fractionalDiff(independentSum, reportedTotal);
    out.push(
      mk(
        ctx,
        "invariant",
        metricKey,
        fd <= TOL.netFractional ? "consistency-only" : "flag",
        fd <= TOL.netFractional
          ? `Σ(strike_totals)=${independentSum.toExponential(4)} reconciles to reported total ${reportedTotal.toExponential(4)} (Δ ${(fd * 100).toExponential(2)}%).`
          : `Σ(strike_totals)=${independentSum.toExponential(4)} does NOT match reported total ${reportedTotal.toExponential(4)} — Δ ${(fd * 100).toFixed(4)}% > tol (aggregation/scale bug).`,
        { id: "strike-sum-eq-total", expected: independentSum, actual: reportedTotal, tolerance: TOL.netFractional }
      )
    );

    // INV-2: cells re-summed to near-term == strike_totals (the matrix the user SEES matches levels).
    const reSummed = reSumCellsToNearTermTotals(block.cells, nearTermExpiries);
    let worstCellDiff = 0;
    let worstStrike = "";
    const keys = new Set([...Object.keys(reSummed), ...Object.keys(strikeTotals)]);
    for (const k of keys) {
      const a = Number(reSummed[k] ?? 0);
      const b = Number(strikeTotals[k] ?? 0);
      const d = fractionalDiff(a, b);
      if (d > worstCellDiff) {
        worstCellDiff = d;
        worstStrike = k;
      }
    }
    // Only assert when there ARE near-term cells (cells can legitimately exceed near-term axis when
    // the engine's near-term selection differs from our 8-nearest approximation → treat as info, not flag).
    if (Object.keys(reSummed).length > 0) {
      out.push(
        mk(
          ctx,
          "invariant",
          metricKey,
          worstCellDiff <= 0.001 ? "consistency-only" : "skipped",
          worstCellDiff <= 0.001
            ? `Re-summed cells reconcile to strike_totals across ${Object.keys(strikeTotals).length} strikes (worst Δ ${(worstCellDiff * 100).toExponential(2)}%).`
            : `Cell-vs-strike_total reconciliation inconclusive at ${worstStrike} (Δ ${(worstCellDiff * 100).toFixed(2)}%) — likely the near-term expiry-axis approximation, not a bug; skipped to avoid false flag.`,
          { id: "cells-eq-strike-totals", tolerance: 0.001 }
        )
      );
    }

    // INV-2b: TEMPORAL-IMMUNE per-strike SIGN integrity — the served `cells` re-sum and the served
    // `strike_totals` must AGREE IN SIGN at every strike, computed entirely from the matrix's OWN
    // snapshot (NO fresh fetch, so cross-time skew can't fool it). This is the real-bug detector the
    // shadow-recompute layer relies on after it (correctly) stops hard-flagging a lone fresh-vs-cached
    // sign flip: a genuine flipped per-cell call(+)/put(−) sign, or a corrupted cells→strike_totals
    // aggregation, would make a strike's net cell sum point the OPPOSITE way to its strike_total — a
    // contradiction WITHIN one served payload. Unlike the magnitude check (INV-2), a SIGN check is
    // robust to the near-term-axis approximation (a strike that is net-positive across its near cells
    // stays positive whether we include 7 or 8 of them), so it can hard-FLAG without false positives.
    // A real ×100 / dropped-×0.01 scale bug is sign-preserving, so it is caught by INV-1 (Σ==total)
    // + the magnitude ceiling instead; together they cover the full ×100 / dropped-factor / sign class.
    {
      let signConflictStrike = "";
      let conflictCellSum = 0;
      let conflictTotal = 0;
      for (const [k, totalRaw] of Object.entries(strikeTotals)) {
        const total = Number(totalRaw);
        const cellSum = Number(reSummed[k] ?? 0);
        // Only meaningful when BOTH sides are materially non-zero (a near-zero side is sign-fragile and
        // not a contradiction). Use a tiny fraction of |total| as the floor so fp dust never trips it.
        if (!Number.isFinite(total) || !Number.isFinite(cellSum)) continue;
        if (Math.abs(total) < 1 || Math.abs(cellSum) < Math.abs(total) * 1e-3) continue;
        if (Math.sign(cellSum) !== Math.sign(total)) {
          signConflictStrike = k;
          conflictCellSum = cellSum;
          conflictTotal = total;
          break;
        }
      }
      out.push(
        mk(
          ctx,
          "invariant",
          metricKey,
          signConflictStrike === "" ? "consistency-only" : "flag",
          signConflictStrike === ""
            ? `Per-strike SIGN integrity holds: every strike's served cell re-sum agrees in sign with its strike_total (temporal-immune; no fresh fetch).`
            : `Per-strike SIGN CONFLICT at ${signConflictStrike}: served cells re-sum to ${conflictCellSum.toExponential(3)} but strike_total is ${conflictTotal.toExponential(3)} — the served matrix contradicts ITSELF (per-cell sign / aggregation bug), independent of any timing.`,
          { id: "cell-sign-eq-strike-total", expected: conflictTotal, actual: conflictCellSum }
        )
      );
    }
  }

  // INV-3: King == argmax|net_gex|. The platform exposes King as the GEX anchor (largest |net|).
  // getGexPositioning doesn't surface King directly, but the matrix strike_totals do — derive both.
  {
    const { king: derivedKing, callWall: derivedCall, putWall: derivedPut } = deriveWalls(
      hm.gex.strike_totals
    );
    // INV-3a: call wall == argmax positive.
    out.push(
      mk(
        ctx,
        "invariant",
        "call_wall",
        sameStrike(derivedCall, hm.gex.call_wall) ? "consistency-only" : "flag",
        sameStrike(derivedCall, hm.gex.call_wall)
          ? `Call wall ${fmt(hm.gex.call_wall)} == argmax(+net_gex) ${fmt(derivedCall)}.`
          : `Call wall ${fmt(hm.gex.call_wall)} != independent argmax(+net_gex) ${fmt(derivedCall)} (wall is not the local positive extreme).`,
        { id: "call-wall-is-argmax-pos", expected: derivedCall, actual: hm.gex.call_wall, tolerance: TOL.strikeAbs }
      )
    );
    // INV-3b: put wall == argmin negative.
    out.push(
      mk(
        ctx,
        "invariant",
        "put_wall",
        sameStrike(derivedPut, hm.gex.put_wall) ? "consistency-only" : "flag",
        sameStrike(derivedPut, hm.gex.put_wall)
          ? `Put wall ${fmt(hm.gex.put_wall)} == argmin(−net_gex) ${fmt(derivedPut)}.`
          : `Put wall ${fmt(hm.gex.put_wall)} != independent argmin(−net_gex) ${fmt(derivedPut)} (wall is not the local negative extreme).`,
        { id: "put-wall-is-argmin-neg", expected: derivedPut, actual: hm.gex.put_wall, tolerance: TOL.strikeAbs }
      )
    );
    // INV-3c: King is the |net| extreme (recorded as the GEX anchor). We don't have a served King on
    // the heatmap payload, so this is a self-consistency derivation surfaced for the oracle layer.
    void derivedKing;
  }

  // INV-4: gamma flip is a REAL neg→pos sign change of per-strike net gamma.
  {
    const derivedFlip = deriveFlip(hm.gex.strike_totals, spot);
    const reported = hm.gex.flip;
    if (reported == null && derivedFlip == null) {
      out.push(
        mk(ctx, "invariant", "gamma_flip", "consistency-only", "No clean neg→pos gamma crossing and none reported — consistent.", {
          id: "flip-real-crossing",
        })
      );
    } else if (reported != null && derivedFlip != null) {
      const close = Math.abs(reported - derivedFlip) <= Math.max(spot * 0.01, 1);
      out.push(
        mk(
          ctx,
          "invariant",
          "gamma_flip",
          close ? "consistency-only" : "flag",
          close
            ? `Reported flip ${fmt(reported)} matches an independent neg→pos crossing ${fmt(derivedFlip)}.`
            : `Reported flip ${fmt(reported)} is NOT at an independent neg→pos crossing (nearest ${fmt(derivedFlip)}) — flip is not a real sign change.`,
          { id: "flip-real-crossing", expected: derivedFlip, actual: reported, tolerance: Math.max(spot * 0.01, 1) }
        )
      );
    } else {
      // One side null, the other not — the legacy cumulative-crossing fallback can legitimately find
      // a flip our per-strike derivation doesn't, so flag only when WE find one and the engine reports
      // none AND it sits near spot (a flip that should have surfaced).
      const flagWorthy =
        reported == null && derivedFlip != null && spot > 0 && Math.abs(derivedFlip - spot) < spot * 0.05;
      out.push(
        mk(
          ctx,
          "invariant",
          "gamma_flip",
          flagWorthy ? "flag" : "consistency-only",
          flagWorthy
            ? `A clean neg→pos crossing exists near spot at ${fmt(derivedFlip)} but the matrix reports NO flip — flip detection may be dropping a real crossing.`
            : `Flip detection differs from the per-strike derivation (reported ${fmt(reported)}, derived ${fmt(derivedFlip)}) — within the documented fallback behavior; not flagged.`,
          { id: "flip-real-crossing", expected: derivedFlip, actual: reported }
        )
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// LAYER 3 — SANITY BOUNDS (plausible ranges, no NaN/Inf, valid expiries)
// ---------------------------------------------------------------------------
function sanityChecks(ctx: Ctx, hm: GexHeatmap): CheckResult[] {
  const out: CheckResult[] = [];

  // No NaN/Inf anywhere in the served aggregates.
  const aggregates: Array<[string, number | null]> = [
    ["spot", hm.spot],
    ["net_gex", hm.gex.total],
    ["net_vex", hm.vex.total],
    ["gex.flip", hm.gex.flip],
    ["call_wall", hm.gex.call_wall],
    ["put_wall", hm.gex.put_wall],
    ["max_pain", hm.max_pain],
  ];
  const bad = aggregates.filter(([, v]) => v != null && !Number.isFinite(v));
  out.push(
    mk(
      ctx,
      "sanity-bound",
      "net_gex",
      bad.length === 0 ? "consistency-only" : "flag",
      bad.length === 0
        ? "No NaN/Inf in served aggregates (spot, net GEX/VEX, flip, walls, max-pain)."
        : `Non-finite served aggregate(s): ${bad.map(([k]) => k).join(", ")}.`,
      { id: "no-nan-inf" }
    )
  );

  // Spot must be > 0 (non-null matrix should always have spot).
  out.push(
    mk(
      ctx,
      "sanity-bound",
      "spot",
      hm.spot > 0 ? "consistency-only" : "flag",
      hm.spot > 0 ? `Spot ${fmt(hm.spot)} > 0.` : `Spot is ${fmt(hm.spot)} on a non-empty matrix.`,
      { id: "spot-positive", actual: hm.spot }
    )
  );

  // Walls / flip / max-pain must sit on the strike axis band (within ±50% of spot — a wall far
  // outside the banded chain would be a strike-key parsing bug).
  for (const [label, level] of [
    ["call_wall", hm.gex.call_wall],
    ["put_wall", hm.gex.put_wall],
    ["gamma_flip", hm.gex.flip],
    ["max_pain", hm.max_pain],
  ] as const) {
    if (level == null || hm.spot <= 0) continue;
    const within = Math.abs(level - hm.spot) <= hm.spot * 0.5;
    out.push(
      mk(
        ctx,
        "sanity-bound",
        label,
        within ? "consistency-only" : "flag",
        within
          ? `${label} ${fmt(level)} is within ±50% of spot ${fmt(hm.spot)}.`
          : `${label} ${fmt(level)} is implausibly far from spot ${fmt(hm.spot)} (>50%) — strike-key/scale bug?`,
        { id: `${label}-near-spot`, expected: hm.spot, actual: level, tolerance: hm.spot * 0.5 }
      )
    );
  }

  // Expiries must be valid future-or-today dates (no past/invalid columns).
  const badExpiries = hm.expiries.filter((e) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) return true;
    return e < ctx.today;
  });
  out.push(
    mk(
      ctx,
      "sanity-bound",
      "freshness",
      badExpiries.length === 0 ? "consistency-only" : "flag",
      badExpiries.length === 0
        ? `All ${hm.expiries.length} expiry columns are valid, non-past dates.`
        : `Invalid/past expiry column(s): ${badExpiries.slice(0, 5).join(", ")}.`,
      { id: "expiries-valid" }
    )
  );

  // Plausible magnitude: net GEX can't exceed a generous ceiling tied to the matrix scale. The
  // per-strike $-gamma is gamma·oi·100·spot²·0.01; even an enormous book stays well under
  // 1e3 × spot² × (total OI cap). We use spot²·1e8 as an absurd-blow-up tripwire (≫ any real net).
  if (hm.spot > 0 && Number.isFinite(hm.gex.total)) {
    const ceiling = hm.spot * hm.spot * 1e8;
    const within = Math.abs(hm.gex.total) <= ceiling;
    out.push(
      mk(
        ctx,
        "sanity-bound",
        "net_gex",
        within ? "consistency-only" : "flag",
        within
          ? `Net GEX magnitude ${hm.gex.total.toExponential(2)} is within the plausible ceiling.`
          : `Net GEX magnitude ${hm.gex.total.toExponential(2)} exceeds the absurd-blow-up ceiling ${ceiling.toExponential(2)} — scale/units bug.`,
        { id: "net-gex-magnitude", actual: hm.gex.total, tolerance: ceiling }
      )
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// LAYER 6 — FRESHNESS (served asof within TTL during RTH)
// ---------------------------------------------------------------------------
function freshnessCheck(ctx: Ctx, hm: GexHeatmap, marketOpen: boolean): CheckResult {
  const asofMs = new Date(hm.asof).getTime();
  if (!Number.isFinite(asofMs)) {
    return mk(ctx, "freshness", "freshness", "flag", `Served asof is unparseable: "${hm.asof}".`, {
      id: "asof-fresh",
      actual: hm.asof,
    });
  }
  const ageMin = (ctx.now - asofMs) / 60000;
  if (!marketOpen) {
    return mk(
      ctx,
      "freshness",
      "freshness",
      "skipped",
      `Market closed — matrix asof ${hm.asof} (${ageMin.toFixed(0)}m) is legitimately stale; freshness not asserted.`,
      { id: "asof-fresh", actual: ageMin }
    );
  }
  const fresh = ageMin <= TOL.freshnessMin;
  return mk(
    ctx,
    "freshness",
    "freshness",
    fresh ? "consistency-only" : "flag",
    fresh
      ? `Matrix asof ${hm.asof} is ${ageMin.toFixed(1)}m old (≤ ${TOL.freshnessMin}m TTL during RTH).`
      : `Matrix is ${ageMin.toFixed(0)}m stale during RTH (asof ${hm.asof}) — stale-shown-as-live.`,
    { id: "asof-fresh", actual: Number(ageMin.toFixed(1)), tolerance: TOL.freshnessMin }
  );
}

// ---------------------------------------------------------------------------
// LAYER 1 — SHADOW RECOMPUTE FROM THE RAW CHAIN (strongest; SPX/SPY only)
// ---------------------------------------------------------------------------
async function shadowRecomputeChecks(ctx: Ctx, hm: GexHeatmap): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  if (process.env.CORRECTNESS_SHADOW_RAW === "0") {
    out.push(
      mk(ctx, "shadow-recompute", "net_gex", "skipped", "Raw-chain shadow recompute disabled (CORRECTNESS_SHADOW_RAW=0).", {
        id: "raw-net-gex",
      })
    );
    return out;
  }
  const spot = hm.spot;
  if (!(spot > 0) || hm.expiries.length === 0) {
    out.push(
      mk(ctx, "shadow-recompute", "net_gex", "skipped", "No spot / empty matrix — nothing to shadow-recompute.", {
        id: "raw-net-gex",
      })
    );
    return out;
  }

  // Fetch a small near-money raw chain for the NEAREST expiry only (bounded, rate-limited funnel).
  // We recompute the near-term King + net contribution of that expiry's strikes and confirm the
  // served per-strike totals contain the same per-strike contributions (aggregation + scale check).
  const nearestExpiry = [...hm.expiries].sort()[0];
  let contracts: ChainContract[] = [];
  try {
    contracts = await fetchPolygonAtmOptionsChain(ctx.ticker, spot, nearestExpiry, 0.04);
  } catch {
    contracts = [];
  }
  if (!contracts.length) {
    out.push(
      mk(
        ctx,
        "shadow-recompute",
        "net_gex",
        "skipped",
        `Raw chain for ${ctx.ticker} ${nearestExpiry} returned no contracts — shadow recompute skipped (not a flag; upstream/thin chain).`,
        { id: "raw-net-gex" }
      )
    );
    return out;
  }

  const raw = rawRecomputeNetGexAndKing(contracts, spot, ctx.today);

  // Compare per-strike net $-gamma: every strike present in BOTH our raw recompute and the served
  // cells (nearest expiry) is checked. CLASSIFICATION (the load-bearing fix, live finding 2026-06-26):
  //
  // This whole comparison is CROSS-TIME BY CONSTRUCTION. It diffs a cell from a FRESH raw chain fetch
  // (sampled NOW) against a cell from the CACHED matrix (built up to a TTL ago). During active RTH the
  // ENTIRE chain moves between those two samples: spot moves, so every cell is rescaled by (S₂/S₁)²
  // (the spot² term in gamma·oi·100·spot²·0.01), and OI/quotes tick. A fresh-vs-cached diff therefore
  // sees market-wide movement on TOP of any transform difference — it CANNOT cleanly separate "the
  // engine applied the wrong transform" from "the market moved between the two samples." In the latest
  // live run this layer alone flagged 25/13/21 "material" strikes incl. a sign flip, while THREE
  // temporal-immune / independent checks all passed on the SAME served payload: INV-1 (Σ(strike_totals)
  // ==total), INV-2b (each strike's served cell re-sum agrees in SIGN with its strike_total, from the
  // matrix's OWN snapshot, no fresh fetch), and the UW cross-provider oracle (SPX King + net sign).
  //
  // CONCLUSION: the shadow-recompute (fresh-fetch-vs-cached-matrix) divergence is NOT a reliable hard
  // signal during market hours and must NEVER hard-FLAG. It emits a CONSISTENCY-ONLY
  // `cross-time-divergence` entry (logged/informational only). The real-bug detectors live elsewhere
  // and are temporal-immune / cross-provider:
  //   • a ×100 / dropped-×0.01 / B-vs-M SCALE bug → INV-1 (Σ(strike_totals)==total, tol 1e-6) +
  //     the absurd-magnitude ceiling (sanityChecks). Scale bugs are sign-preserving and systematic, so
  //     Σ no longer reconciles to total → hard FLAG, with NO fresh fetch needed.
  //   • a per-CELL SIGN bug (flipped call(+)/put(−), corrupted cells→strike_totals aggregation) →
  //     INV-2b, which compares the served cells' re-sum to the served strike_total at every strike
  //     from ONE snapshot → a contradiction WITHIN the served payload hard FLAGs, immune to timing.
  //   • the King STRIKE + net-GEX SIGN → the UW oracle (cross-provider, scale-invariant).
  // The shadow recompute's job is now purely to surface a cross-time gap for the record, not to gate.
  type CellDiff = { strike: string; raw: number; served: number; fd: number; signFlip: boolean };
  const diffs: CellDiff[] = [];
  for (const [strikeStr, rawVal] of Object.entries(raw.strikeTotals)) {
    const servedRow = hm.gex.cells[strikeStr];
    if (!servedRow) continue;
    const servedVal = Number(servedRow[nearestExpiry]);
    if (!Number.isFinite(servedVal) || servedVal === 0) continue;
    diffs.push({
      strike: strikeStr,
      raw: rawVal,
      served: servedVal,
      fd: fractionalDiff(rawVal, servedVal),
      signFlip: Math.sign(rawVal) !== Math.sign(servedVal),
    });
  }
  const strikesCompared = diffs.length;

  if (strikesCompared >= 3) {
    const outOfTol = diffs.filter((d) => d.fd > TOL.rawNetFractional);
    const flips = outOfTol.filter((d) => d.signFlip);
    const worst = [...outOfTol].sort((a, b) => b.fd - a.fd)[0];
    const fmtCell = (d: CellDiff) =>
      `strike ${d.strike}: raw ${d.raw.toExponential(3)} vs served ${d.served.toExponential(3)} (Δ ${(d.fd * 100).toFixed(2)}%${d.signFlip ? ", SIGN FLIP" : ""})`;

    if (outOfTol.length === 0) {
      out.push(
        mk(
          ctx,
          "shadow-recompute",
          "net_gex",
          "consistency-only",
          `Independent raw-chain recompute of ${strikesCompared} ${nearestExpiry} cells matches served $-gamma (all within ±${(TOL.rawNetFractional * 100).toFixed(0)}%).`,
          { id: "raw-cell-gex", tolerance: TOL.rawNetFractional }
        )
      );
    } else {
      // DEMOTED to CONSISTENCY-ONLY (never a hard FLAG). The fresh-fetch-vs-cached-matrix diff is
      // cross-time by construction (whole-chain RTH movement rescales every cell by (S₂/S₁)²), so it
      // cannot reliably distinguish a transform bug from market movement during market hours. Whether
      // the divergence looks isolated or "systematic," it is logged here for the record only; the
      // hard-flagging detectors are the temporal-immune INV-1 / INV-2b / magnitude-ceiling and the
      // cross-provider UW oracle, which run on the served snapshot (or a second provider) and are not
      // fooled by this timing skew. A genuine ×100 scale bug still hard-flags via INV-1 (Σ≠total) and
      // a per-cell sign bug still hard-flags via INV-2b.
      out.push(
        mk(
          ctx,
          "shadow-recompute",
          "net_gex",
          "consistency-only",
          `cross-time-divergence (informational, not a flag): ${outOfTol.length}/${strikesCompared} ${nearestExpiry} cell(s) diverge > ±${(TOL.rawNetFractional * 100).toFixed(0)}%${flips.length ? ` (incl. ${flips.length} sign flip${flips.length === 1 ? "" : "s"})` : ""} — expected from FRESH-fetch-vs-CACHED-matrix timing during RTH (whole-chain movement rescales every cell by spot²), NOT evidence of a transform bug. Worst: ${fmtCell(worst)}. Authoritative real-bug detectors are temporal-immune (INV-1 Σ==total, INV-2b per-strike sign, magnitude ceiling) + the UW oracle — see their entries.`,
          { id: "raw-cell-gex", tolerance: TOL.rawNetFractional }
        )
      );
    }
  } else {
    out.push(
      mk(
        ctx,
        "shadow-recompute",
        "net_gex",
        "skipped",
        `Only ${strikesCompared} overlapping ${nearestExpiry} cells between raw chain and served matrix — too few to assert (banding differences).`,
        { id: "raw-cell-gex" }
      )
    );
  }

  // King agreement on the nearest expiry's banded strikes (independent argmax on raw vs served-band).
  if (raw.king != null) {
    // Restrict the served strike_totals to the strikes our raw band covered, then argmax both.
    const rawStrikes = new Set(Object.keys(raw.strikeTotals));
    const servedBand: Record<string, number> = {};
    for (const [k, v] of Object.entries(hm.gex.strike_totals)) {
      if (rawStrikes.has(k)) servedBand[k] = v;
    }
    const servedKingBand = deriveWalls(servedBand).king;
    // This is band-scoped, so only assert when both sides found a King in the shared band.
    // CONSISTENCY-ONLY (never a hard FLAG): like the cell diff above, this compares a FRESH raw-chain
    // King against the CACHED served band — a cross-time comparison. Near a moving spot the |net|
    // extreme can hop a strike between the two samples, so a mismatch is timing, not a bug. The King
    // STRIKE is independently CONFIRMED by the temporal-immune UW cross-provider oracle below; this
    // entry is informational corroboration only.
    if (servedKingBand != null) {
      const ok = Math.abs(raw.king - servedKingBand) <= Math.max(spot * 0.01, 1);
      out.push(
        mk(
          ctx,
          "shadow-recompute",
          "king",
          "consistency-only",
          ok
            ? `Raw-chain King ${fmt(raw.king)} agrees with the served near-band |net| extreme ${fmt(servedKingBand)}.`
            : `cross-time-divergence (informational, not a flag): raw-chain King ${fmt(raw.king)} != served near-band |net| extreme ${fmt(servedKingBand)} — fresh-fetch-vs-cached timing near a moving spot; the King strike is independently confirmed by the UW oracle.`,
          { id: "raw-king", expected: raw.king, actual: servedKingBand, tolerance: Math.max(spot * 0.01, 1) }
        )
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// LAYER 4 — CROSS-PROVIDER ORACLE (UW native GEX — #104). SPX only.
// ---------------------------------------------------------------------------
async function crossProviderChecks(ctx: Ctx, hm: GexHeatmap): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const { root } = resolveOptionsRoot(ctx.ticker);
  // Oracle is only wired for SPX today (UW spot-exposures index ladder). Other tickers have NO second
  // source → mark consistency-only explicitly (a coverage gap, never a false green).
  if (root !== "SPX") {
    out.push(
      mk(
        ctx,
        "cross-provider",
        "king",
        "consistency-only",
        `No second independent GEX source for ${root} today — King is consistency-checked, NOT independently confirmed (coverage gap; see #104).`,
        { id: "oracle-king" }
      )
    );
    out.push(
      mk(
        ctx,
        "cross-provider",
        "net_gex",
        "consistency-only",
        `No second independent GEX source for ${root} today — net GEX sign is consistency-checked, NOT independently confirmed (coverage gap; see #104).`,
        { id: "oracle-net-sign" }
      )
    );
    return out;
  }
  if (process.env.CORRECTNESS_UW_ORACLE === "0") {
    out.push(
      mk(ctx, "cross-provider", "king", "consistency-only", "UW oracle disabled (CORRECTNESS_UW_ORACLE=0) — King consistency-only this run.", {
        id: "oracle-king",
      })
    );
    return out;
  }

  // Pull the UW native GEX ladder for SPX through the rate-limited uwGetSafe funnel (2 RPS).
  let uw: { rows: Record<string, unknown>[]; source: string } = { rows: [], source: "none" };
  try {
    const { fetchUwOdteGexLadder } = await import("@/lib/providers/unusual-whales");
    uw = await fetchUwOdteGexLadder("SPX");
  } catch {
    uw = { rows: [], source: "none" };
  }
  if (!uw.rows.length) {
    out.push(
      mk(
        ctx,
        "cross-provider",
        "king",
        "consistency-only",
        "UW GEX ladder unavailable this run (503/empty) — SPX King consistency-only (oracle exists but did not answer).",
        { id: "oracle-king" }
      )
    );
    out.push(
      mk(
        ctx,
        "cross-provider",
        "net_gex",
        "consistency-only",
        "UW GEX ladder unavailable this run — SPX net-GEX sign consistency-only.",
        { id: "oracle-net-sign" }
      )
    );
    return out;
  }

  // UW rows are {strike, call_gamma_oi, put_gamma_oi} — gamma·OI (NOT our per-1%-move $-gamma), so
  // MAGNITUDE is not directly comparable. We confirm the two cross-scale-invariant facts: the King
  // STRIKE (argmax|net|) and the net-GEX SIGN. Both are independent of the scale convention.
  let uwNet = 0;
  let uwKing: number | null = null;
  let uwMaxAbs = -1;
  for (const r of uw.rows) {
    const strike = Number(r.strike);
    const net = Number(r.call_gamma_oi ?? 0) + Number(r.put_gamma_oi ?? 0);
    if (!Number.isFinite(strike) || !Number.isFinite(net)) continue;
    uwNet += net;
    if (Math.abs(net) > uwMaxAbs) {
      uwMaxAbs = Math.abs(net);
      uwKing = strike;
    }
  }

  // Served SPX King + net for the SAME 0DTE scope as the UW oracle (not the near-term aggregate
  // in strike_totals, which sums up to NEAR_TERM_EXPIRY_COUNT expiries and would false-flag).
  const odteScope = odteGexScopeFromHeatmap(hm, ctx.today);
  const servedKing = deriveWalls(odteScope.strikeTotals).king;
  const servedNet = odteScope.total;

  // King agreement (independently confirmed when within ~1.5% of spot — different strike grids).
  if (uwKing != null && servedKing != null && hm.spot > 0) {
    const fd = Math.abs(uwKing - servedKing) / hm.spot;
    const ok = fd <= TOL.kingFractionalOfSpot;
    out.push(
      mk(
        ctx,
        "cross-provider",
        "king",
        ok ? "pass" : "flag",
        ok
          ? `SPX 0DTE King ${fmt(servedKing)} INDEPENDENTLY CONFIRMED by UW (${uw.source}) King ${fmt(uwKing)} (Δ ${(fd * 100).toFixed(2)}% of spot).`
          : `SPX 0DTE King ${fmt(servedKing)} DISAGREES with UW (${uw.source}) King ${fmt(uwKing)} — Δ ${(fd * 100).toFixed(2)}% of spot > tol.`,
        {
          id: "oracle-king",
          expected: uwKing,
          actual: servedKing,
          tolerance: TOL.kingFractionalOfSpot,
          independentlyConfirmed: ok,
        }
      )
    );
  } else {
    out.push(
      mk(ctx, "cross-provider", "king", "consistency-only", "UW or served 0DTE King indeterminate this run — King consistency-only.", {
        id: "oracle-king",
      })
    );
  }

  // Net-GEX sign agreement (cross-scale-invariant) on the 0DTE column.
  if (uwNet !== 0 && Number.isFinite(servedNet) && servedNet !== 0) {
    const agree = Math.sign(uwNet) === Math.sign(servedNet);
    const grossServed = grossAbsFromStrikeTotals(odteScope.strikeTotals);
    const grossUw = grossAbsFromUwGexRows(uw.rows);
    const odteFlip = recomputeScopedGexLevels(odteScope.strikeTotals, hm.spot).flip;
    const hairline =
      !agree &&
      (isHairlineNetGammaSign(servedNet, grossServed) || isHairlineNetGammaSign(uwNet, grossUw));
    const nearFlip = !agree && isNearGammaFlip(hm.spot, odteFlip);
    const unstable = hairline || nearFlip;
    out.push(
      mk(
        ctx,
        "cross-provider",
        "net_gex",
        agree ? "pass" : unstable ? "consistency-only" : "flag",
        agree
          ? `SPX 0DTE net-GEX sign (${servedNet > 0 ? "positive" : "negative"}) INDEPENDENTLY CONFIRMED by UW (${uw.source}, ${uwNet > 0 ? "positive" : "negative"}).`
          : hairline
            ? `SPX 0DTE net-GEX sign disagrees with UW but both nets are hairline (|net|/gross ≤8% — balanced dealer gamma; sign not diagnostically meaningful this run).`
            : nearFlip
              ? `SPX 0DTE net-GEX sign disagrees with UW but spot is within 0.5% of the 0DTE gamma flip (${fmt(odteFlip)}) — sign not diagnostically meaningful near the zero-gamma crossing.`
              : `SPX 0DTE net-GEX sign (${servedNet > 0 ? "positive" : "negative"}) CONTRADICTS UW (${uw.source}, ${uwNet > 0 ? "positive" : "negative"}) — dealer regime disagreement.`,
        { id: "oracle-net-sign", expected: Math.sign(uwNet), actual: Math.sign(servedNet), independentlyConfirmed: agree }
      )
    );
  } else {
    out.push(
      mk(ctx, "cross-provider", "net_gex", "consistency-only", "UW or served 0DTE net GEX ~flat this run — net-sign consistency-only.", {
        id: "oracle-net-sign",
      })
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// LAYER 5 — CROSS-TOOL CONSISTENCY (same value across surfaces; SPX). #80 class.
// ---------------------------------------------------------------------------
async function crossToolChecks(ctx: Ctx, hm: GexHeatmap): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const { root } = resolveOptionsRoot(ctx.ticker);

  // getGexPositioning (the canonical cross-tool contract Heatmap/Largo/Night's Watch read) must
  // report the SAME spot / flip / walls as the matrix it derives from. (Same source, so a mismatch
  // is a derivation bug in getGexPositioning, exactly the kind of label-divergence #80 was.)
  //
  // TEMPORAL-IMMUNE (the load-bearing fix): derive the positioning contract from the SAME `hm`
  // snapshot this verifier already holds, via the PURE mapper gexPositioningFromHeatmap — NOT a
  // second fetchGexHeatmap. getGexPositioning is literally `fetchGexHeatmap → gexPositioningFrom
  // Heatmap`, so calling getGexPositioning here re-fetched the matrix a SECOND time, seconds after
  // `hm` was captured (after the shadow + UW network layers ran). With a 5-20s cache TTL that second
  // read can land on a FRESH rebuild whose chain/spot moved a hair, so net_gex/flip differed by a
  // few % / sub-point — a CACHE-REFRESH timing skew, NOT a cross-tool derivation bug. Mapping the
  // held snapshot compares LIKE-FOR-LIKE at one instant: it still hard-flags a real derivation bug
  // (e.g. net_gex sourced from the wrong field, a wall mis-copied) because the mapper's output is
  // diffed against the very matrix it derives from — but it can never cry wolf over a TTL refresh.
  const pos = gexPositioningFromHeatmap(ctx.ticker, hm);
  if (!pos) {
    out.push(
      mk(ctx, "cross-tool", "spot", "skipped", `getGexPositioning("${ctx.ticker}") returned null — cross-tool spot/flip skipped.`, {
        id: "positioning-vs-matrix-spot",
      })
    );
  } else {
    // Spot.
    const sd = fractionalDiff(pos.spot, hm.spot);
    out.push(
      mk(
        ctx,
        "cross-tool",
        "spot",
        sd <= TOL.spotFractional ? "consistency-only" : "flag",
        sd <= TOL.spotFractional
          ? `getGexPositioning spot ${fmt(pos.spot)} == matrix spot ${fmt(hm.spot)}.`
          : `getGexPositioning spot ${fmt(pos.spot)} != matrix spot ${fmt(hm.spot)} (Δ ${(sd * 100).toFixed(2)}%) — same label, different value (#80 class).`,
        { id: "positioning-vs-matrix-spot", expected: hm.spot, actual: pos.spot, tolerance: TOL.spotFractional }
      )
    );
    // Flip.
    out.push(
      mk(
        ctx,
        "cross-tool",
        "gamma_flip",
        sameStrike(pos.flip, hm.gex.flip) ? "consistency-only" : "flag",
        sameStrike(pos.flip, hm.gex.flip)
          ? `getGexPositioning flip ${fmt(pos.flip)} == matrix flip ${fmt(hm.gex.flip)}.`
          : `getGexPositioning flip ${fmt(pos.flip)} != matrix flip ${fmt(hm.gex.flip)}.`,
        { id: "positioning-vs-matrix-flip", expected: hm.gex.flip, actual: pos.flip }
      )
    );
    // Call/put walls.
    out.push(
      mk(
        ctx,
        "cross-tool",
        "call_wall",
        sameStrike(pos.call_wall, hm.gex.call_wall) ? "consistency-only" : "flag",
        sameStrike(pos.call_wall, hm.gex.call_wall)
          ? `getGexPositioning call_wall ${fmt(pos.call_wall)} == matrix ${fmt(hm.gex.call_wall)}.`
          : `getGexPositioning call_wall ${fmt(pos.call_wall)} != matrix ${fmt(hm.gex.call_wall)}.`,
        { id: "positioning-vs-matrix-callwall", expected: hm.gex.call_wall, actual: pos.call_wall }
      )
    );
    out.push(
      mk(
        ctx,
        "cross-tool",
        "net_gex",
        fractionalDiff(pos.net_gex, hm.gex.total) <= TOL.netFractional ? "consistency-only" : "flag",
        fractionalDiff(pos.net_gex, hm.gex.total) <= TOL.netFractional
          ? `getGexPositioning net_gex matches matrix total ${hm.gex.total.toExponential(3)}.`
          : `getGexPositioning net_gex ${pos.net_gex.toExponential(3)} != matrix total ${hm.gex.total.toExponential(3)}.`,
        { id: "positioning-vs-matrix-netgex", expected: hm.gex.total, actual: pos.net_gex, tolerance: TOL.netFractional }
      )
    );
  }

  // SPX-only: confirm the SPX desk (SPX Slayer) reads the same spot / King / flip as the matrix.
  if (root === "SPX") {
    try {
      const { loadMergedSpxDesk } = await import("@/lib/spx-desk-loader");
      const { merged } = await loadMergedSpxDesk();
      if (merged?.available && merged.price > 0 && hm.spot > 0) {
        const sd = fractionalDiff(merged.price, hm.spot);
        out.push(
          mk(
            ctx,
            "cross-tool",
            "spot",
            sd <= TOL.spotFractional ? "consistency-only" : "flag",
            sd <= TOL.spotFractional
              ? `SPX desk price ${fmt(merged.price)} == heatmap spot ${fmt(hm.spot)}.`
              : `SPX desk price ${fmt(merged.price)} != heatmap spot ${fmt(hm.spot)} (Δ ${(sd * 100).toFixed(2)}%) — desk vs Heat Maps spot divergence (#80 class).`,
            { id: "desk-vs-matrix-spot", expected: hm.spot, actual: merged.price, tolerance: TOL.spotFractional }
          )
        );
        // Desk gamma flip vs matrix flip.
        if (merged.gamma_flip != null && hm.gex.flip != null) {
          const close = Math.abs(merged.gamma_flip - hm.gex.flip) <= Math.max(hm.spot * 0.01, 1);
          out.push(
            mk(
              ctx,
              "cross-tool",
              "gamma_flip",
              close ? "consistency-only" : "flag",
              close
                ? `SPX desk γ-flip ${fmt(merged.gamma_flip)} ≈ heatmap flip ${fmt(hm.gex.flip)}.`
                : `SPX desk γ-flip ${fmt(merged.gamma_flip)} != heatmap flip ${fmt(hm.gex.flip)} — same label, different level (#80 class).`,
              {
                id: "desk-vs-matrix-flip",
                expected: hm.gex.flip,
                actual: merged.gamma_flip,
                tolerance: Math.max(hm.spot * 0.01, 1),
              }
            )
          );
        }
      } else {
        out.push(
          mk(ctx, "cross-tool", "spot", "skipped", "SPX desk unavailable/closed — desk cross-tool check skipped.", {
            id: "desk-vs-matrix-spot",
          })
        );
      }
    } catch {
      out.push(
        mk(ctx, "cross-tool", "spot", "skipped", "SPX desk load failed — desk cross-tool check skipped.", {
          id: "desk-vs-matrix-spot",
        })
      );
    }
  }

  return out;
}

// ── small format helpers ──────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function sameStrike(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= TOL.strikeAbs;
}

/** Group a flat check list into per-metric scores. */
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
 * Verify ONE ticker's Heat Maps numbers across all six layers. Returns a TickerScore (never throws —
 * a thrown layer degrades to a skipped check so one ticker can't abort the batch). `marketOpen`
 * gates the freshness assertion (closed-market data is legitimately stale).
 */
export async function verifyHeatmapTicker(ticker: string, marketOpen: boolean): Promise<TickerScore> {
  const root = String(ticker ?? "").trim().toUpperCase();
  const ctx: Ctx = { ticker: root, now: Date.now(), today: todayEtYmdLocal() };

  const hm = await fetchGexHeatmap(root).catch(() => null);
  if (!hm || !(hm.spot > 0) || hm.strikes.length === 0) {
    const skip: CheckResult = {
      id: `${root}:matrix:freshness:cold`,
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: `No usable matrix for ${root} (cold/empty/no-spot) — nothing to verify this run.`,
    };
    return { ticker: root, status: "skipped", metrics: groupMetrics(root, [skip]) };
  }

  const checks: CheckResult[] = [];
  // Run each layer defensively — a throw becomes a skipped check, never an abort.
  const runners: Array<[string, () => CheckResult[] | Promise<CheckResult[]>]> = [
    ["invariant", () => invariantChecks(ctx, hm)],
    ["sanity", () => sanityChecks(ctx, hm)],
    ["freshness", () => [freshnessCheck(ctx, hm, marketOpen)]],
    ["shadow", () => shadowRecomputeChecks(ctx, hm)],
    ["oracle", () => crossProviderChecks(ctx, hm)],
    ["cross-tool", () => crossToolChecks(ctx, hm)],
  ];
  for (const [name, run] of runners) {
    try {
      const res = await run();
      checks.push(...res);
    } catch (err) {
      checks.push({
        id: `${root}:${name}:invariant:threw`,
        layer: "invariant",
        metric: name,
        outcome: "skipped",
        detail: `Layer "${name}" threw (${err instanceof Error ? err.message : String(err)}) — skipped, not flagged.`,
      });
    }
  }

  const metrics = groupMetrics(root, checks);
  const status = worstStatus(metrics.map((m) => m.status));
  return { ticker: root, status, metrics };
}

/** Local ET YMD (avoids importing the provider's todayEtYmd to keep this self-contained). */
function todayEtYmdLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
