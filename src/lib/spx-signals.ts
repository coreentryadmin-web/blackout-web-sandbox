/**
 * 0DTE SPX confluence engine — client + server safe (no provider imports).
 */
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

export type SpxSignalAction = "BUY_CALL" | "BUY_PUT" | "HOLD" | "WAIT";
export type SpxPlayAction = "SCANNING" | "WATCHING" | "BUY" | "HOLD" | "TRIM" | "SELL";
export type SpxPlayDirection = "long" | "short";
export type SpxConfluenceGrade = "A+" | "A" | "B" | "C" | "D";

export type SpxSignalFactor = {
  label: string;
  weight: number;
  detail: string;
};

export type SpxTradeSignal = {
  action: SpxSignalAction;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  score: number;
  headline: string;
  thesis: string;
  factors: SpxSignalFactor[];
  levels: {
    entry: number | null;
    stop: number | null;
    target: number | null;
    invalidation: string;
  };
  as_of: string;
};

export type SpxConfluence = SpxTradeSignal & {
  grade: SpxConfluenceGrade;
  conflicts: number;
  agreeing: number;
  direction: SpxPlayDirection | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function nearestWall(
  walls: SpxDeskPayload["gex_walls"],
  kind: "support" | "resistance",
  price: number
) {
  const pool = walls.filter((w) => w.kind === kind);
  if (!pool.length) return null;
  return pool.reduce((best, w) => {
    const d = Math.abs(w.strike - price);
    const bd = Math.abs(best.strike - price);
    return d < bd ? w : best;
  });
}

function tapeSkew(desk: SpxDeskPayload): { bull: number; bear: number } {
  let bull = 0;
  let bear = 0;
  for (const t of (desk.unified_tape ?? []).slice(0, 8)) {
    if (t.kind !== "flow") continue;
    if (t.side === "call") bull += t.premium;
    else if (t.side === "put") bear += t.premium;
  }
  return { bull, bear };
}

function scoreToGrade(absScore: number, conflicts: number): SpxConfluenceGrade {
  if (absScore >= 75 && conflicts === 0) return "A+";
  if (absScore >= 62 && conflicts <= 1) return "A";
  if (absScore >= 52 && conflicts <= 2) return "B";
  if (absScore >= 35) return "C";
  return "D";
}

function buildLevels(
  desk: SpxDeskPayload,
  price: number,
  bias: "bullish" | "bearish" | "neutral",
  action: SpxSignalAction
) {
  const support = nearestWall(desk.gex_walls ?? [], "support", price);
  const resistance = nearestWall(desk.gex_walls ?? [], "resistance", price);
  const entry = price;
  let stop: number | null = null;
  let target: number | null = null;
  let invalidation = "No clean level — reduce size or wait";

  if (action === "BUY_CALL" || (action === "HOLD" && bias === "bullish")) {
    stop = support?.strike ?? desk.lod ?? desk.vwap ?? null;
    target = resistance?.strike ?? desk.hod ?? desk.max_pain ?? null;
    if (stop != null) invalidation = `Below ${stop.toFixed(0)} (GEX support / LOD)`;
  } else if (action === "BUY_PUT" || (action === "HOLD" && bias === "bearish")) {
    stop = resistance?.strike ?? desk.hod ?? desk.vwap ?? null;
    target = support?.strike ?? desk.lod ?? desk.max_pain ?? null;
    if (stop != null) invalidation = `Above ${stop.toFixed(0)} (GEX resistance / HOD)`;
  }

  return { entry, stop, target, invalidation, support, resistance };
}

/** Full confluence with grade, conflicts, and extended desk inputs. */
export function computeSpxConfluence(desk: SpxDeskPayload): SpxConfluence | null {
  const price = desk.price;
  if (!price || price <= 0 || !desk.available) return null;

  const factors: SpxSignalFactor[] = [];
  let score = 0;

  if (desk.vwap != null) {
    const above = price >= desk.vwap;
    const w = 12;
    score += above ? w : -w;
    factors.push({
      label: "VWAP",
      weight: above ? w : -w,
      detail: above
        ? `Above VWAP ${desk.vwap.toFixed(2)} — buyers in control`
        : `Below VWAP ${desk.vwap.toFixed(2)} — sellers pressing`,
    });
  }

  if (desk.gamma_flip != null) {
    const aboveFlip = price > desk.gamma_flip;
    const regime = desk.gamma_regime ?? "unknown";
    if (regime === "mean_revert" && aboveFlip) {
      const w = 10;
      score += w;
      factors.push({
        label: "γ regime",
        weight: w,
        detail: `Above γ flip ${desk.gamma_flip.toFixed(0)} — mean-revert favors dips bought`,
      });
    } else if (regime === "amplification" && !aboveFlip) {
      const w = -10;
      score += w;
      factors.push({
        label: "γ regime",
        weight: w,
        detail: `Below γ flip ${desk.gamma_flip.toFixed(0)} — amplification favors momentum down`,
      });
    }
  }

  const { support, resistance } = buildLevels(desk, price, "neutral", "WAIT");
  if (support) {
    const dist = price - support.strike;
    if (dist >= 0 && dist <= 12) {
      const w = 18;
      score += w;
      factors.push({
        label: "GEX support",
        weight: w,
        detail: `At 0DTE support node ${support.strike.toFixed(0)} (+${dist.toFixed(0)} pts)`,
      });
    }
  }
  if (resistance) {
    const dist = resistance.strike - price;
    if (dist >= 0 && dist <= 12) {
      const w = -18;
      score += w;
      factors.push({
        label: "GEX resistance",
        weight: w,
        detail: `Into 0DTE resistance ${resistance.strike.toFixed(0)} (−${dist.toFixed(0)} pts)`,
      });
    }
  }

  if (desk.gex_king != null) {
    const dist = price - desk.gex_king;
    const w = dist > 0 ? 6 : -6;
    if (Math.abs(dist) <= 25) {
      score += w;
      factors.push({
        label: "GEX king",
        weight: w,
        detail: `${dist >= 0 ? "Above" : "Below"} king strike ${desk.gex_king.toFixed(0)}`,
      });
    }
  }

  if (desk.max_pain != null) {
    const dist = price - desk.max_pain;
    if (Math.abs(dist) <= 15) {
      const w = dist > 0 ? -5 : 5;
      score += w;
      factors.push({
        label: "Max pain",
        weight: w,
        detail: `Price ${dist >= 0 ? "above" : "below"} max pain ${desk.max_pain.toFixed(0)}`,
      });
    }
  }

  const flowNet = desk.flow_0dte_net;
  if (flowNet != null && Math.abs(flowNet) > 50_000) {
    const w = flowNet > 0 ? 14 : -14;
    score += w;
    factors.push({
      label: "0DTE flow",
      weight: w,
      detail: flowNet > 0 ? "Call premium leading 0DTE tape" : "Put premium leading 0DTE tape",
    });
  }

  const dpBias = desk.dark_pool?.bias;
  if (dpBias && dpBias !== "neutral" && dpBias !== "mixed") {
    const w = dpBias === "bullish" ? 8 : -8;
    score += w;
    factors.push({
      label: "Dark pool",
      weight: w,
      detail: `Institutional bias ${dpBias}`,
    });
  }

  if (desk.tide_bias && desk.tide_bias !== "neutral") {
    const w = desk.tide_bias === "bullish" ? 10 : -10;
    score += w;
    factors.push({
      label: "Market tide",
      weight: w,
      detail: `${desk.tide_bias} broad flow`,
    });
  }

  if (desk.nope != null && Math.abs(desk.nope) > 0.5) {
    const w = desk.nope > 0 ? 7 : -7;
    score += w;
    factors.push({
      label: "NOPE",
      weight: w,
      detail: `NOPE ${desk.nope > 0 ? "+" : ""}${desk.nope.toFixed(2)}`,
    });
  }

  if (desk.uw_iv_rank != null) {
    if (desk.uw_iv_rank > 70 && score > 0) {
      score -= 4;
      factors.push({
        label: "IV rank",
        weight: -4,
        detail: `High IV rank ${desk.uw_iv_rank} — fade risk on longs`,
      });
    } else if (desk.uw_iv_rank < 30 && score < 0) {
      score += 4;
      factors.push({
        label: "IV rank",
        weight: 4,
        detail: `Low IV rank ${desk.uw_iv_rank} — squeeze risk on shorts`,
      });
    }
  }

  if (desk.tick != null) {
    const w = desk.tick > 200 ? 8 : desk.tick < -200 ? -8 : desk.tick > 0 ? 4 : -4;
    if (Math.abs(w) >= 4) {
      score += w;
      factors.push({
        label: "TICK",
        weight: w,
        detail: `NYSE TICK ${desk.tick > 0 ? "+" : ""}${desk.tick.toFixed(0)}`,
      });
    }
  }

  if (desk.trin != null && desk.trin > 0) {
    const w = desk.trin < 0.85 ? 6 : desk.trin > 1.15 ? -6 : 0;
    if (w) {
      score += w;
      factors.push({
        label: "TRIN",
        weight: w,
        detail: `TRIN ${desk.trin.toFixed(2)} — ${w > 0 ? "broad buying" : "broad selling"}`,
      });
    }
  }

  if (desk.add != null) {
    const w = desk.add > 100 ? 5 : desk.add < -100 ? -5 : 0;
    if (w) {
      score += w;
      factors.push({
        label: "ADD",
        weight: w,
        detail: `Advance/decline ${desk.add > 0 ? "+" : ""}${desk.add.toFixed(0)}`,
      });
    }
  }

  const leaders = desk.leader_stocks ?? [];
  if (leaders.length) {
    const avg = leaders.reduce((s, l) => s + l.change_pct, 0) / leaders.length;
    const w = avg > 0.35 ? 8 : avg < -0.35 ? -8 : avg > 0 ? 3 : -3;
    score += w;
    factors.push({
      label: "Mega-caps",
      weight: w,
      detail: `Leadership avg ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`,
    });
  }

  const { bull, bear } = tapeSkew(desk);
  if (bull + bear > 100_000) {
    const w = bull > bear * 1.25 ? 12 : bear > bull * 1.25 ? -12 : 0;
    if (w) {
      score += w;
      factors.push({
        label: "Live tape",
        weight: w,
        detail: w > 0 ? "Recent SPX flow skews calls" : "Recent SPX flow skews puts",
      });
    }
  }

  if (desk.ema20 != null) {
    const w = price > desk.ema20 ? 5 : -5;
    score += w;
    factors.push({
      label: "EMA 20",
      weight: w,
      detail: price > desk.ema20 ? "Above intraday EMA 20" : "Below intraday EMA 20",
    });
  }

  const netPrem = desk.net_prem_ticks ?? [];
  if (netPrem.length >= 2) {
    const last = netPrem[netPrem.length - 1]?.net ?? 0;
    const prev = netPrem[netPrem.length - 2]?.net ?? 0;
    const delta = last - prev;
    if (Math.abs(delta) > 500_000) {
      const w = delta > 0 ? 6 : -6;
      score += w;
      factors.push({
        label: "Net prem",
        weight: w,
        detail: `SPY net prem ${delta > 0 ? "accelerating" : "decelerating"}`,
      });
    }
  }

  score = clamp(score, -100, 100);
  const abs = Math.abs(score);
  const bullFactors = factors.filter((f) => f.weight > 0).length;
  const bearFactors = factors.filter((f) => f.weight < 0).length;
  const conflicts = score > 0 ? bearFactors : score < 0 ? bullFactors : Math.min(bullFactors, bearFactors);

  let action: SpxSignalAction;
  let bias: "bullish" | "bearish" | "neutral";
  if (score >= 28) {
    action = "BUY_CALL";
    bias = "bullish";
  } else if (score <= -28) {
    action = "BUY_PUT";
    bias = "bearish";
  } else if (abs >= 12) {
    action = "HOLD";
    bias = score > 0 ? "bullish" : "bearish";
  } else {
    action = "WAIT";
    bias = "neutral";
  }

  const confidence = clamp(Math.round(abs * 1.15 + factors.length * 3), 0, 96);
  const grade = scoreToGrade(abs, conflicts);
  const direction: SpxPlayDirection | null =
    bias === "bullish" ? "long" : bias === "bearish" ? "short" : null;
  const agreeing = direction === "long" ? bullFactors : direction === "short" ? bearFactors : 0;

  const levels = buildLevels(desk, price, bias, action);

  return {
    action,
    bias,
    confidence,
    score,
    grade,
    conflicts,
    agreeing,
    direction,
    headline: "",
    thesis: "",
    factors: factors.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    levels: {
      entry: levels.entry,
      stop: levels.stop,
      target: levels.target,
      invalidation: levels.invalidation,
    },
    as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
  };
}

/** Legacy signal helper — maps confluence to BUY_CALL/BUY_PUT/HOLD/WAIT labels. */
export function computeSpxTradeSignal(desk: SpxDeskPayload): SpxTradeSignal | null {
  const c = computeSpxConfluence(desk);
  if (!c) return null;

  const actionLabel =
    c.action === "BUY_CALL"
      ? "BUY CALL"
      : c.action === "BUY_PUT"
        ? "BUY PUT"
        : c.action === "HOLD"
          ? "HOLD / TRIM"
          : "WAIT — NO EDGE";

  const headline =
    c.action === "WAIT"
      ? "Mixed confluence — stand aside"
      : `${actionLabel} · ${c.confidence}% conviction`;

  const thesis =
    c.action === "BUY_CALL"
      ? `0DTE long bias: ${c.agreeing} bullish factors at ${desk.price.toFixed(2)} (${c.grade}).`
      : c.action === "BUY_PUT"
        ? `0DTE short bias: ${c.agreeing} bearish factors at ${desk.price.toFixed(2)} (${c.grade}).`
        : c.action === "HOLD"
          ? `Lean ${c.bias} but confluence insufficient for a fresh entry — manage existing risk.`
          : "Dealer, flow, and internals conflict — no high-quality 0DTE entry.";

  return {
    action: c.action,
    bias: c.bias,
    confidence: c.confidence,
    score: c.score,
    headline,
    thesis,
    factors: c.factors,
    levels: c.levels,
    as_of: c.as_of,
  };
}
