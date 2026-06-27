/**
 * 0DTE SPX confluence engine — client + server safe (no provider imports).
 */
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { computeWeightedConflicts } from "@/lib/spx-play-conflicts";
import { playDynamicTargetPts } from "@/lib/spx-play-config";
import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";

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
  weighted_conflicts: number;
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

/**
 * Score HELIX 0DTE institutional sweep alignment from desk.spx_flows.
 * Filters for SPX/SPY sweeps expiring today, alerted within the last 30 minutes,
 * then scores net call vs put premium: ±4 (mild skew ≥1.5:1) or ±8 (strong ≥3:1).
 * Returns 0 if there is insufficient flow data.
 */
function scoreHelixFlowAlignment(
  desk: SpxDeskPayload,
  factors: SpxSignalFactor[]
): number {
  const flows = desk.spx_flows;
  if (!flows?.length) return 0;

  const nowMs = Date.now();
  const thirtyMinMs = 30 * 60 * 1000;
  // Today in ET — expiry strings are YYYY-MM-DD (UTC date would flip at 7 PM ET)
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(nowMs));

  let callPrem = 0;
  let putPrem = 0;

  for (const f of flows) {
    const ticker = (f.ticker ?? "").toUpperCase();
    if (ticker !== "SPX" && ticker !== "SPXW" && ticker !== "SPY") continue;
    if (!f.has_sweep) continue;
    if (f.expiry !== todayYmd) continue;
    const alertedAt = f.alerted_at ? new Date(f.alerted_at).getTime() : 0;
    if (!alertedAt || nowMs - alertedAt > thirtyMinMs) continue;

    const optType = (f.option_type ?? "").toUpperCase();
    if (optType.startsWith("C")) callPrem += f.premium;
    else if (optType.startsWith("P")) putPrem += f.premium;
  }

  const total = callPrem + putPrem;
  if (total < 500_000) return 0; // not enough notional to be meaningful

  const ratio = callPrem > putPrem
    ? callPrem / Math.max(putPrem, 1)
    : putPrem / Math.max(callPrem, 1);

  const bullish = callPrem > putPrem;
  let w = 0;
  if (ratio >= 3) {
    w = bullish ? 8 : -8;
  } else if (ratio >= 1.5) {
    w = bullish ? 4 : -4;
  }

  if (w !== 0) {
    factors.push({
      label: "HELIX sweeps",
      weight: w,
      detail: bullish
        ? `0DTE call sweeps dominant — $${(callPrem / 1e6).toFixed(1)}M vs $${(putPrem / 1e6).toFixed(1)}M puts (30min)`
        : `0DTE put sweeps dominant — $${(putPrem / 1e6).toFixed(1)}M vs $${(callPrem / 1e6).toFixed(1)}M calls (30min)`,
    });
  }

  return w;
}

function tapeSkew(desk: SpxDeskPayload): { bull: number; bear: number } {
  let bull = 0;
  let bear = 0;
  // Filter by kind before slicing so dark-pool prints don't crowd out flow items.
  // Without this, a premarket or dark-pool-heavy tape would yield 0 bull/bear and
  // the tape signal would silently drop out even with plenty of flow prints present.
  for (const t of (desk.unified_tape ?? []).filter((t) => t.kind === "flow").slice(0, 8)) {
    if (t.side === "call") bull += t.premium;
    else if (t.side === "put") bear += t.premium;
  }
  return { bull, bear };
}

function scoreToGrade(absScore: number, conflicts: number): SpxConfluenceGrade {
  if (absScore >= 72 && conflicts <= 1) return "A+";
  if (absScore >= 58 && conflicts <= 2) return "A";
  if (absScore >= 45 && conflicts <= 3) return "B";
  if (absScore >= 30) return "C";
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
  // VIX-indexed target: scales with the day's expected range instead of a fixed 10 pts.
  const targetPts = playDynamicTargetPts(desk.vix);

  if (action === "BUY_CALL" || (action === "HOLD" && bias === "bullish")) {
    stop = support?.strike ?? desk.lod ?? desk.vwap ?? null;
    target = price + targetPts;
    if (stop != null) invalidation = `Below ${stop.toFixed(0)} (GEX support / LOD)`;
  } else if (action === "BUY_PUT" || (action === "HOLD" && bias === "bearish")) {
    stop = resistance?.strike ?? desk.hod ?? desk.vwap ?? null;
    target = price - targetPts;
    if (stop != null) invalidation = `Above ${stop.toFixed(0)} (GEX resistance / HOD)`;
  }

  return { entry, stop, target, invalidation, support, resistance };
}

const NEWS_BEAR_RE =
  /\b(fed|fomc|halt|circuit.?breaker|crash|missile|attack|explosion|tariff.?hike|surprise.?cpi|surprise.?pce|geopolit|war|sanctions|default|downgrade)\b/i;
const NEWS_BULL_RE =
  /\b(rate.?cut|dovish|ceasefire|stimulus|deal|beat.?estimates|record.?high|rally)\b/i;

/**
 * Scan up to 10 desk news headlines for macro-shock keywords.
 * Returns a score modifier in [−6, +3] and pushes a factor when non-zero.
 */
function scoreNewsRisk(
  headlines: SpxDeskPayload["news_headlines"],
  factors: SpxSignalFactor[],
): number {
  if (!headlines || headlines.length === 0) return 0;
  let bearHits = 0;
  let bullHits = 0;
  for (const h of headlines.slice(0, 10)) {
    const text = h.title ?? "";
    if (NEWS_BEAR_RE.test(text)) bearHits++;
    if (NEWS_BULL_RE.test(text)) bullHits++;
  }
  if (bearHits === 0 && bullHits === 0) return 0;
  // Net skew: negative is stronger than positive (macro shocks are asymmetric).
  const net = bullHits - bearHits * 2;
  const w = net >= 2 ? 3 : net <= -3 ? -6 : net <= -2 ? -4 : net <= -1 ? -2 : 0;
  if (w !== 0) {
    factors.push({
      label: "News risk",
      weight: w,
      detail:
        w < 0
          ? `${bearHits} high-risk headline${bearHits > 1 ? "s" : ""} (Fed/halt/macro shock)`
          : `${bullHits} positive headline${bullHits > 1 ? "s" : ""} (rate cut/deal/beat)`,
    });
  }
  return w;
}

/**
 * Score flow-strike concentration bonus for the confluence engine.
 *
 * Returns +3 when the top strike stack has > 3 repeated prints in the play direction
 * within 30 points of the current price, 0 otherwise. Only the strongest stack (sorted
 * by total_premium descending) is evaluated — we want the dominant institutional bid,
 * not noisy accumulation across many strikes.
 *
 * "Play direction" match: long = CALL stack, short = PUT stack.
 */
export function scoreFlowStrikeConcentration(
  strikeStacks: FlowStrikeStack[],
  currentPrice: number,
  playDirection: "long" | "short" | null
): number {
  if (!strikeStacks.length || !playDirection || !(currentPrice > 0)) return 0;

  // Sort by total premium descending so the dominant stack is first.
  const sorted = [...strikeStacks].sort((a, b) => b.total_premium - a.total_premium);
  const top = sorted[0];

  const expectedOptType = playDirection === "long" ? "CALL" : "PUT";
  if (top.option_type.toUpperCase() !== expectedOptType) return 0;

  const strikeDistance = Math.abs(top.strike - currentPrice);
  if (strikeDistance > 30) return 0;

  // Must have more than 3 repeated prints (alert_count > 3 is the threshold).
  if (top.alert_count <= 3) return 0;

  return 3;
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

  // ISSUE-01: GEX support AND resistance could both fire when price is between two walls,
  // adding +18 AND -18 simultaneously. They cancel the score but inflate conflict/agreeing
  // counts, degrading the grade for rangebound markets.
  // Fix: make them mutually exclusive — only score the nearer wall.
  const { support, resistance } = buildLevels(desk, price, "neutral", "WAIT");
  const supportDist = support ? price - support.strike : Infinity;
  const resistanceDist = resistance ? resistance.strike - price : Infinity;
  const supportInRange = support != null && supportDist >= 0 && supportDist <= 12;
  const resistanceInRange = resistance != null && resistanceDist >= 0 && resistanceDist <= 12;
  if (supportInRange && resistanceInRange) {
    // Both walls in range — score only the closer one.
    if (supportDist <= resistanceDist) {
      const w = 18;
      score += w;
      factors.push({
        label: "GEX support",
        weight: w,
        detail: `At 0DTE support node ${support!.strike.toFixed(0)} (+${supportDist.toFixed(0)} pts)`,
      });
    } else {
      const w = -18;
      score += w;
      factors.push({
        label: "GEX resistance",
        weight: w,
        detail: `Into 0DTE resistance ${resistance!.strike.toFixed(0)} (−${resistanceDist.toFixed(0)} pts)`,
      });
    }
  } else {
    if (supportInRange) {
      const w = 18;
      score += w;
      factors.push({
        label: "GEX support",
        weight: w,
        detail: `At 0DTE support node ${support!.strike.toFixed(0)} (+${supportDist.toFixed(0)} pts)`,
      });
    }
    if (resistanceInRange) {
      const w = -18;
      score += w;
      factors.push({
        label: "GEX resistance",
        weight: w,
        detail: `Into 0DTE resistance ${resistance!.strike.toFixed(0)} (−${resistanceDist.toFixed(0)} pts)`,
      });
    }
  }

  if (desk.gex_king != null) {
    const dist = price - desk.gex_king;
    const w = dist > 0 ? 6 : -6;
    if (Math.abs(dist) <= 25) {
      score += w;
      factors.push({
        label: "GEX anchor",
        weight: w,
        detail: `${dist >= 0 ? "Above" : "Below"} anchor strike ${desk.gex_king.toFixed(0)}`,
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

  // C8: desk.nope can be NaN from a failed float parse. NaN != null is true so the null
  // check passes. Add Number.isFinite() to block NaN from the score.
  if (desk.nope != null && Number.isFinite(desk.nope) && Math.abs(desk.nope) > 0.5) {
    const w = desk.nope > 0 ? 7 : -7;
    score += w;
    factors.push({
      label: "NOPE",
      weight: w,
      detail: `NOPE ${desk.nope > 0 ? "+" : ""}${desk.nope.toFixed(2)}`,
    });
  }

  // C8: Same NaN guard for uw_iv_rank.
  if (desk.uw_iv_rank != null && Number.isFinite(desk.uw_iv_rank)) {
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

  // C8: NaN guard for tick.
  // ISSUE-05: The `if (Math.abs(w) >= 4)` guard was always true (smallest w is ±4).
  // Removed the dead conditional; just apply the weight directly.
  if (desk.tick != null && Number.isFinite(desk.tick)) {
    const w = desk.tick > 200 ? 8 : desk.tick < -200 ? -8 : desk.tick > 0 ? 4 : -4;
    score += w;
    factors.push({
      label: "TICK",
      weight: w,
      detail: `NYSE TICK ${desk.tick > 0 ? "+" : ""}${desk.tick.toFixed(0)}`,
    });
  }

  // C8: NaN guard for trin.
  if (desk.trin != null && Number.isFinite(desk.trin) && desk.trin > 0) {
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

  // C8: NaN guard for add.
  if (desk.add != null && Number.isFinite(desk.add)) {
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
    // ISSUE-36: UW sometimes returns numeric strings for `net`. Use Number() to coerce
    // so "1234" - "5678" doesn't produce NaN.
    const last = Number(netPrem[netPrem.length - 1]?.net ?? 0);
    const prev = Number(netPrem[netPrem.length - 2]?.net ?? 0);
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

  // VIX term structure — backwardation (spot VIX > 3m VIX) signals near-term fear and
  // typically precedes a volatility spike. Contango (spot < 3m) is the "calm" baseline.
  // We only score meaningful divergence (>1 pt), not tick-level noise.
  const vt = desk.vix_term;
  if (vt?.vix9d != null && vt?.vix3m != null) {
    const termDiff = vt.vix9d - vt.vix3m;
    if (termDiff > 1) {
      // Backwardation: short-dated vol elevated vs deferred — near-term crash risk
      const w = -8;
      score += w;
      factors.push({
        label: "VIX curve",
        weight: w,
        detail: `VIX backwardation: 9d ${vt.vix9d.toFixed(1)} > 3m ${vt.vix3m.toFixed(1)} — elevated near-term fear`,
      });
    } else if (termDiff < -1) {
      // Normal contango: term structure calm, supports short-vol / call-buying
      const w = 4;
      score += w;
      factors.push({
        label: "VIX curve",
        weight: w,
        detail: `VIX contango: 9d ${vt.vix9d.toFixed(1)} < 3m ${vt.vix3m.toFixed(1)} — calm near-term structure`,
      });
    }
  }

  score += scoreHelixFlowAlignment(desk, factors);

  // News risk: scan headlines for macro shock keywords and apply a sentiment
  // modifier (−6 to +3). Extreme negative news gates aggressive plays downstream.
  const newsWeight = scoreNewsRisk(desk.news_headlines ?? [], factors);
  score += newsWeight;

  // Flow-strike concentration: +3 bonus when the dominant strike stack has > 3 repeated
  // institutional prints in the play direction within 30 pts of spot.
  // Derive a provisional direction from the pre-clamp score to avoid a chicken-and-egg.
  const provisionalDir: "long" | "short" | null = score > 0 ? "long" : score < 0 ? "short" : null;
  const strikeBonus = scoreFlowStrikeConcentration(
    desk.strike_stacks ?? [],
    price,
    provisionalDir
  );
  if (strikeBonus !== 0) {
    score += strikeBonus;
    const top = [...(desk.strike_stacks ?? [])].sort((a, b) => b.total_premium - a.total_premium)[0];
    factors.push({
      label: "Strike stack",
      weight: strikeBonus,
      detail: `${top.option_type} $${top.strike} — ${top.alert_count} repeated prints (${provisionalDir})`,
    });
  }

  score = clamp(score, -100, 100);
  const abs = Math.abs(score);
  const bullFactors = factors.filter((f) => f.weight > 0).length;
  const bearFactors = factors.filter((f) => f.weight < 0).length;
  const { conflicts, weighted_conflicts } = computeWeightedConflicts(desk, score, factors);

  let action: SpxSignalAction;
  let bias: "bullish" | "bearish" | "neutral";
  if (score >= 22) {
    action = "BUY_CALL";
    bias = "bullish";
  } else if (score <= -22) {
    action = "BUY_PUT";
    bias = "bearish";
  } else if (abs >= 10) {
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
    weighted_conflicts,
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
