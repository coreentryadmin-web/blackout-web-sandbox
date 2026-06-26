import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";

// ---------------------------------------------------------------------------
// SPX DESK (SPX Slayer) data-correctness verifier — priority surface #1.
//
// Re-derives the desk's headline numbers INDEPENDENTLY and confirms them, layering:
//   L1 shadow-recompute — moving averages (EMA20/50/200, SMA50/200) recomputed from
//                         Polygon daily bars; intraday HOD/LOD recomputed from minute bars.
//   L2 invariant        — spot ∈ [day low, day high]; EMA200 ≤ EMA50 ≤ EMA20 ordering is
//                         NOT assumed (regime-dependent), so only the box invariant is asserted.
//   L3 sanity           — no NaN/Inf, IV rank ∈ [0,100], VIX > 0, levels near spot.
//   L4 cross-provider   — desk SPX price vs the REAL index (Polygon I:SPX), and vs UW 0DTE
//                         flow's implied spot when present. GEX King + net-sign reuse the SAME
//                         UW native-GEX oracle the heatmap verifier uses (independently confirmed).
//   L6 freshness        — price_age_ms within TTL during RTH (never stale-shown-as-live).
//
// RATE DISCIPLINE: the desk read is a CACHE-READER (loadMergedSpxDesk → withServerCache lanes,
// no extra upstream). The independent oracles are SPX-only, bounded, and rate-limited:
//   • Polygon I:SPX snapshot + a small daily-bar window (≤ ~210 bars, ONE call each) via the
//     polygonGet funnel — used to confirm spot + recompute MAs.
//   • UW native GEX ladder for SPX ONLY, through the 2-RPS uw-rate-limiter (same oracle as #104).
// Both are flag-gated so the cron can run pure cache-reader if ever needed. NO per-ticker fan-out:
// the desk surface is SPX-only.
//
// DESIGN: every recompute (EMA/SMA, argmax, sums) is written FROM SCRATCH here — it does NOT
// import the desk's own MA helpers — so a bug in the production path can't hide behind a shared impl.
// READ-ONLY: this never mutates the desk; it only re-derives and diffs.
// ---------------------------------------------------------------------------

const TOL = {
  /** Desk SPX price vs the real index (fractional) — well outside live-tick jitter. */
  spotFractional: 0.005,
  /** Recomputed MA vs served MA (fractional) — Polygon's indicator endpoint and a from-closes
   *  recompute differ by a hair on the seed window; 1.5% never false-positives, catches a real bug. */
  maFractional: 0.015,
  /** IV rank absolute tolerance (points, 0–100 scale). */
  ivRankAbs: 6,
  /** Cross-provider King strike agreement (fractional of spot). */
  kingFractionalOfSpot: 0.015,
  /** price_age_ms freshness ceiling during RTH (ms). The pulse lane refreshes ~1s; 90s = a real stall. */
  freshnessMs: 90_000,
} as const;

type Ctx = { ticker: string; now: number; today: string };

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
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Independent SMA over the last `window` closes (most recent inclusive). */
function smaFromCloses(closes: number[], window: number): number | null {
  if (closes.length < window || window <= 0) return null;
  const slice = closes.slice(closes.length - window);
  let sum = 0;
  for (const c of slice) {
    if (!Number.isFinite(c)) return null;
    sum += c;
  }
  return sum / window;
}

/** Independent EMA over closes (standard 2/(n+1) smoothing, SMA seed) — written from scratch. */
function emaFromCloses(closes: number[], window: number): number | null {
  if (closes.length < window || window <= 0) return null;
  const k = 2 / (window + 1);
  // Seed with the SMA of the first `window` closes, then walk forward.
  let ema = 0;
  for (let i = 0; i < window; i++) ema += closes[i];
  ema /= window;
  for (let i = window; i < closes.length; i++) {
    const c = closes[i];
    if (!Number.isFinite(c)) return null;
    ema = c * k + ema * (1 - k);
  }
  return ema;
}

// ---------------------------------------------------------------------------
// L2 INVARIANT + L3 SANITY — over the served desk payload.
// ---------------------------------------------------------------------------
function structuralChecks(
  ctx: Ctx,
  d: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"]
): CheckResult[] {
  const out: CheckResult[] = [];
  const spot = Number(d.price);

  // No NaN/Inf in the served headline aggregates.
  const aggregates: Array<[string, number | null | undefined]> = [
    ["price", d.price],
    ["vix", d.vix],
    ["ema20", d.ema20],
    ["ema50", d.ema50],
    ["ema200", d.ema200],
    ["sma50", d.sma50],
    ["sma200", d.sma200],
    ["gex_net", d.gex_net],
    ["gamma_flip", d.gamma_flip],
    ["max_pain", d.max_pain],
    ["uw_iv_rank", d.uw_iv_rank],
  ];
  const bad = aggregates.filter(([, v]) => v != null && !Number.isFinite(Number(v)));
  out.push(
    mk(
      ctx,
      "sanity-bound",
      "spot",
      bad.length === 0 ? "consistency-only" : "flag",
      bad.length === 0
        ? "No NaN/Inf in served desk aggregates (price, VIX, MAs, GEX, flip, max-pain, IV rank)."
        : `Non-finite served desk aggregate(s): ${bad.map(([k]) => k).join(", ")}.`,
      { id: "desk-no-nan" }
    )
  );

  // INVARIANT: spot ∈ [day low, day high] (the headline price can't sit outside the day's range).
  if (spot > 0 && d.lod != null && d.hod != null && Number.isFinite(d.lod) && Number.isFinite(d.hod)) {
    // Tiny epsilon for tick rounding between the price lane and the HOD/LOD lane.
    const eps = Math.max(spot * 0.0005, 0.01);
    const within = spot >= d.lod - eps && spot <= d.hod + eps;
    out.push(
      mk(
        ctx,
        "invariant",
        "spot",
        within ? "consistency-only" : "flag",
        within
          ? `Spot ${fmt(spot)} ∈ [LOD ${fmt(d.lod)}, HOD ${fmt(d.hod)}].`
          : `Spot ${fmt(spot)} is OUTSIDE the day range [${fmt(d.lod)}, ${fmt(d.hod)}] — a price/HOD-LOD lane disagreement (stale or wrong-source).`,
        { id: "spot-in-day-range", expected: `[${fmt(d.lod)},${fmt(d.hod)}]`, actual: spot }
      )
    );
  } else {
    out.push(
      mk(ctx, "invariant", "spot", "skipped", "No HOD/LOD on the desk (premarket/closed) — spot-in-range not asserted.", {
        id: "spot-in-day-range",
      })
    );
  }

  // INVARIANT: above_vwap label must agree with spot vs VWAP.
  if (spot > 0 && d.vwap != null && Number.isFinite(d.vwap)) {
    const impliedAbove = spot >= d.vwap;
    const agree = impliedAbove === d.above_vwap;
    out.push(
      mk(
        ctx,
        "invariant",
        "spot",
        agree ? "consistency-only" : "flag",
        agree
          ? `above_vwap=${d.above_vwap} matches spot ${fmt(spot)} vs VWAP ${fmt(d.vwap)}.`
          : `above_vwap=${d.above_vwap} CONTRADICTS spot ${fmt(spot)} vs VWAP ${fmt(d.vwap)} — label/value divergence.`,
        { id: "above-vwap-consistent", expected: String(impliedAbove), actual: String(d.above_vwap) }
      )
    );
  }

  // INVARIANT: above_gamma_flip label must agree with spot vs gamma_flip.
  if (spot > 0 && d.gamma_flip != null && Number.isFinite(d.gamma_flip)) {
    const impliedAbove = spot >= d.gamma_flip;
    const agree = impliedAbove === d.above_gamma_flip;
    out.push(
      mk(
        ctx,
        "invariant",
        "gamma_flip",
        agree ? "consistency-only" : "flag",
        agree
          ? `above_gamma_flip=${d.above_gamma_flip} matches spot ${fmt(spot)} vs flip ${fmt(d.gamma_flip)}.`
          : `above_gamma_flip=${d.above_gamma_flip} CONTRADICTS spot ${fmt(spot)} vs flip ${fmt(d.gamma_flip)} — regime label is wrong-side.`,
        { id: "above-flip-consistent", expected: String(impliedAbove), actual: String(d.above_gamma_flip) }
      )
    );
  }

  // SANITY: IV rank ∈ [0,100].
  if (d.uw_iv_rank != null && Number.isFinite(d.uw_iv_rank)) {
    const ok = d.uw_iv_rank >= 0 && d.uw_iv_rank <= 100;
    out.push(
      mk(
        ctx,
        "sanity-bound",
        "iv_rank",
        ok ? "consistency-only" : "flag",
        ok ? `IV rank ${fmt(d.uw_iv_rank)} ∈ [0,100].` : `IV rank ${fmt(d.uw_iv_rank)} is OUT of [0,100] — scale bug.`,
        { id: "iv-rank-bounded", actual: d.uw_iv_rank, expected: "[0,100]" }
      )
    );
  }

  // SANITY: VIX > 0 when present.
  if (d.vix != null && Number.isFinite(d.vix)) {
    out.push(
      mk(
        ctx,
        "sanity-bound",
        "vix",
        d.vix > 0 ? "consistency-only" : "flag",
        d.vix > 0 ? `VIX ${fmt(d.vix)} > 0.` : `VIX is ${fmt(d.vix)} — implausible.`,
        { id: "vix-positive", actual: d.vix }
      )
    );
  }

  // SANITY: gamma_flip / max_pain within ±50% of spot (strike-axis sanity).
  for (const [label, level] of [
    ["gamma_flip", d.gamma_flip],
    ["max_pain", d.max_pain],
    ["gex_king", d.gex_king],
  ] as const) {
    if (level == null || !Number.isFinite(level) || !(spot > 0)) continue;
    const within = Math.abs(level - spot) <= spot * 0.5;
    out.push(
      mk(
        ctx,
        "sanity-bound",
        label === "gex_king" ? "king" : label,
        within ? "consistency-only" : "flag",
        within
          ? `${label} ${fmt(level)} within ±50% of spot ${fmt(spot)}.`
          : `${label} ${fmt(level)} implausibly far from spot ${fmt(spot)} — strike-key/scale bug.`,
        { id: `${label}-near-spot`, expected: spot, actual: level, tolerance: spot * 0.5 }
      )
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// L1 SHADOW RECOMPUTE — moving averages from Polygon daily bars.
// ---------------------------------------------------------------------------
async function maShadowChecks(
  ctx: Ctx,
  d: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"]
): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  if (process.env.CORRECTNESS_SHADOW_RAW === "0") {
    out.push(
      mk(ctx, "shadow-recompute", "moving_avg", "skipped", "MA shadow recompute disabled (CORRECTNESS_SHADOW_RAW=0).", {
        id: "ma-recompute",
      })
    );
    return out;
  }
  // Need enough daily closes for the 200-period windows. Pull ~300 calendar days (≈ 210 trading
  // bars) of I:SPX daily bars in ONE rate-limited call.
  let closes: number[] = [];
  try {
    const { fetchIndexDailyBars } = await import("@/lib/providers/polygon");
    const to = ctx.today;
    const fromDate = new Date(Date.now() - 300 * 86_400_000);
    const from = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(fromDate);
    const bars = await fetchIndexDailyBars("I:SPX", from, to, "400");
    closes = (bars ?? [])
      .map((b: { c?: number }) => Number(b?.c))
      .filter((c: number) => Number.isFinite(c) && c > 0);
  } catch {
    closes = [];
  }
  if (closes.length < 50) {
    out.push(
      mk(
        ctx,
        "shadow-recompute",
        "moving_avg",
        "skipped",
        `Only ${closes.length} I:SPX daily closes available — too few to recompute MAs (upstream thin); skipped, not flagged.`,
        { id: "ma-recompute" }
      )
    );
    return out;
  }

  const pairs: Array<[string, number | null | undefined, () => number | null]> = [
    ["sma50", d.sma50, () => smaFromCloses(closes, 50)],
    ["sma200", d.sma200, () => smaFromCloses(closes, 200)],
    ["ema20", d.ema20, () => emaFromCloses(closes, 20)],
    ["ema50", d.ema50, () => emaFromCloses(closes, 50)],
    ["ema200", d.ema200, () => emaFromCloses(closes, 200)],
  ];
  for (const [label, served, recompute] of pairs) {
    if (served == null || !Number.isFinite(Number(served))) continue;
    const mine = recompute();
    if (mine == null) {
      out.push(
        mk(ctx, "shadow-recompute", "moving_avg", "skipped", `Not enough closes for ${label} recompute (need its window).`, {
          id: `ma-${label}`,
        })
      );
      continue;
    }
    const fd = fractionalDiff(mine, Number(served));
    const ok = fd <= TOL.maFractional;
    out.push(
      mk(
        ctx,
        "shadow-recompute",
        "moving_avg",
        ok ? "consistency-only" : "flag",
        ok
          ? `${label} ${fmt(Number(served))} reconciles with an independent from-closes recompute ${fmt(mine)} (Δ ${(fd * 100).toFixed(2)}%).`
          : `${label} ${fmt(Number(served))} DIVERGES from independent recompute ${fmt(mine)} — Δ ${(fd * 100).toFixed(2)}% > ${(TOL.maFractional * 100).toFixed(1)}% (wrong window/timeframe/seed?).`,
        { id: `ma-${label}`, expected: mine, actual: Number(served), tolerance: TOL.maFractional }
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// L4 CROSS-PROVIDER — desk spot vs real index; GEX King + net-sign vs UW (same #104 oracle).
// ---------------------------------------------------------------------------
async function crossProviderChecks(
  ctx: Ctx,
  d: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"]
): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const spot = Number(d.price);

  // (a) Spot vs the REAL index — Polygon I:SPX snapshot (the index, not an option-implied figure).
  if (spot > 0) {
    let idx: number | null = null;
    try {
      const { fetchIndexSnapshot } = await import("@/lib/providers/polygon");
      const q = await fetchIndexSnapshot("I:SPX");
      idx = q && Number.isFinite(q.price) ? Number(q.price) : null;
    } catch {
      idx = null;
    }
    if (idx != null && idx > 0) {
      const fd = fractionalDiff(spot, idx);
      const ok = fd <= TOL.spotFractional;
      out.push(
        mk(
          ctx,
          "cross-provider",
          "spot",
          ok ? "pass" : "flag",
          ok
            ? `Desk SPX price ${fmt(spot)} INDEPENDENTLY CONFIRMED by the Polygon I:SPX index ${fmt(idx)} (Δ ${(fd * 100).toFixed(3)}%).`
            : `Desk SPX price ${fmt(spot)} DISAGREES with the Polygon I:SPX index ${fmt(idx)} — Δ ${(fd * 100).toFixed(2)}% > tol (wrong source / SPY-as-SPX / stale).`,
          { id: "spot-vs-index", expected: idx, actual: spot, tolerance: TOL.spotFractional, independentlyConfirmed: ok }
        )
      );
    } else {
      out.push(
        mk(ctx, "cross-provider", "spot", "consistency-only", "Polygon I:SPX snapshot unavailable this run — desk spot consistency-only.", {
          id: "spot-vs-index",
        })
      );
    }
  }

  // (b) GEX King + net-sign vs the UW native GEX ladder (SPX) — the SAME oracle the heatmap uses.
  if (process.env.CORRECTNESS_UW_ORACLE === "0") {
    out.push(
      mk(ctx, "cross-provider", "king", "consistency-only", "UW oracle disabled (CORRECTNESS_UW_ORACLE=0) — desk King consistency-only.", {
        id: "desk-oracle-king",
      })
    );
    return out;
  }
  let uw: { rows: Record<string, unknown>[]; source: string } = { rows: [], source: "none" };
  try {
    const { fetchUwOdteGexLadder } = await import("@/lib/providers/unusual-whales");
    uw = await fetchUwOdteGexLadder("SPX");
  } catch {
    uw = { rows: [], source: "none" };
  }
  if (!uw.rows.length) {
    out.push(
      mk(ctx, "cross-provider", "king", "consistency-only", "UW GEX ladder unavailable this run — desk King/net-sign consistency-only.", {
        id: "desk-oracle-king",
      })
    );
    return out;
  }
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

  // Desk King.
  if (uwKing != null && d.gex_king != null && Number.isFinite(d.gex_king) && spot > 0) {
    const fd = Math.abs(uwKing - d.gex_king) / spot;
    const ok = fd <= TOL.kingFractionalOfSpot;
    out.push(
      mk(
        ctx,
        "cross-provider",
        "king",
        ok ? "pass" : "flag",
        ok
          ? `Desk GEX King ${fmt(d.gex_king)} INDEPENDENTLY CONFIRMED by UW (${uw.source}) King ${fmt(uwKing)} (Δ ${(fd * 100).toFixed(2)}% of spot).`
          : `Desk GEX King ${fmt(d.gex_king)} DISAGREES with UW (${uw.source}) King ${fmt(uwKing)} — Δ ${(fd * 100).toFixed(2)}% of spot > tol.`,
        { id: "desk-oracle-king", expected: uwKing, actual: d.gex_king, tolerance: TOL.kingFractionalOfSpot, independentlyConfirmed: ok }
      )
    );
  } else {
    out.push(
      mk(ctx, "cross-provider", "king", "consistency-only", "Desk or UW King indeterminate this run — King consistency-only.", {
        id: "desk-oracle-king",
      })
    );
  }

  // Desk net-GEX sign.
  if (uwNet !== 0 && d.gex_net != null && Number.isFinite(d.gex_net) && d.gex_net !== 0) {
    const agree = Math.sign(uwNet) === Math.sign(d.gex_net);
    out.push(
      mk(
        ctx,
        "cross-provider",
        "gex_net",
        agree ? "pass" : "flag",
        agree
          ? `Desk net-GEX sign (${d.gex_net > 0 ? "positive" : "negative"}) INDEPENDENTLY CONFIRMED by UW (${uw.source}, ${uwNet > 0 ? "positive" : "negative"}).`
          : `Desk net-GEX sign (${d.gex_net > 0 ? "positive" : "negative"}) CONTRADICTS UW (${uw.source}, ${uwNet > 0 ? "positive" : "negative"}) — dealer-regime disagreement.`,
        { id: "desk-oracle-net-sign", expected: Math.sign(uwNet), actual: Math.sign(d.gex_net), independentlyConfirmed: agree }
      )
    );
  } else {
    out.push(
      mk(ctx, "cross-provider", "gex_net", "consistency-only", "Desk or UW net GEX ~flat this run — net-sign consistency-only.", {
        id: "desk-oracle-net-sign",
      })
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// L6 FRESHNESS — price_age_ms within TTL during RTH.
// ---------------------------------------------------------------------------
function freshnessCheck(
  ctx: Ctx,
  d: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"],
  marketOpen: boolean
): CheckResult {
  if (!marketOpen) {
    return mk(ctx, "freshness", "freshness", "skipped", "Market closed — desk freshness not asserted (closed-market data legitimately stale).", {
      id: "desk-price-fresh",
    });
  }
  const age = d.price_age_ms;
  if (age == null || !Number.isFinite(Number(age))) {
    return mk(
      ctx,
      "freshness",
      "freshness",
      "skipped",
      "No price_age_ms on the desk payload — freshness not assertable this run.",
      { id: "desk-price-fresh" }
    );
  }
  const ageMs = Number(age);
  const fresh = ageMs <= TOL.freshnessMs;
  return mk(
    ctx,
    "freshness",
    "freshness",
    fresh ? "consistency-only" : "flag",
    fresh
      ? `Desk price is ${(ageMs / 1000).toFixed(1)}s old (≤ ${(TOL.freshnessMs / 1000).toFixed(0)}s TTL during RTH).`
      : `Desk price is ${(ageMs / 1000).toFixed(0)}s stale during RTH${d.feed_stalled ? " (feed_stalled=true)" : ""} — stale-shown-as-live.`,
    { id: "desk-price-fresh", actual: Number((ageMs / 1000).toFixed(1)), tolerance: TOL.freshnessMs / 1000 }
  );
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
 * Verify the SPX desk's numbers across all applicable layers. SPX-only (the desk is SPX). Never throws —
 * a thrown layer degrades to a skipped check so one layer can't abort the run.
 */
export async function verifyDesk(marketOpen: boolean): Promise<TickerScore> {
  const ctx: Ctx = { ticker: "SPX", now: Date.now(), today: todayEtYmdLocal() };

  const bundle = await loadMergedSpxDesk().catch(() => null);
  const d = bundle?.merged;
  if (!d || !d.available || !(Number(d.price) > 0)) {
    const skip: CheckResult = {
      id: "SPX:desk:freshness:cold",
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: "SPX desk unavailable/cold (no price) — nothing to verify this run.",
    };
    return { ticker: "SPX", status: "skipped", metrics: groupMetrics("SPX", [skip]) };
  }

  const checks: CheckResult[] = [];
  const runners: Array<[string, () => CheckResult[] | Promise<CheckResult[]>]> = [
    ["structural", () => structuralChecks(ctx, d)],
    ["freshness", () => [freshnessCheck(ctx, d, marketOpen)]],
    ["ma-shadow", () => maShadowChecks(ctx, d)],
    ["oracle", () => crossProviderChecks(ctx, d)],
  ];
  for (const [name, run] of runners) {
    try {
      checks.push(...(await run()));
    } catch (err) {
      checks.push({
        id: `SPX:${name}:invariant:threw`,
        layer: "invariant",
        metric: name,
        outcome: "skipped",
        detail: `Desk layer "${name}" threw (${err instanceof Error ? err.message : String(err)}) — skipped, not flagged.`,
      });
    }
  }

  const metrics = groupMetrics("SPX", checks);
  return { ticker: "SPX", status: worstStatus(metrics.map((m) => m.status)), metrics };
}

function todayEtYmdLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
