import type { MacroEvent } from "@/lib/providers/macro-events";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import {
  playLottoFlowMinNotional,
  playLottoGapMinPct,
  playLottoMinDirectionSignals,
  playLottoMinDirectionWeight,
} from "@/lib/spx-play-config";

export type LottoDirectionSignal = {
  id: string;
  direction: SpxPlayDirection;
  label: string;
  /** Strength-weighted vote (1.0 = baseline signal). */
  weight: number;
};

export type LottoCatalystHit = {
  id: string;
  label: string;
  direction: SpxPlayDirection | "neutral";
};

export type LottoCatalystEvaluation = {
  qualified: boolean;
  direction: SpxPlayDirection | null;
  catalysts: LottoCatalystHit[];
  direction_signals: LottoDirectionSignal[];
  catalyst_summary: string;
  confidence: number;
  reason: string;
};

const MACRO_RE =
  /\b(CPI|FOMC|FED|PCE|NFP|NONFARM|JOBS|PAYROLL|PPI|GDP|RETAIL SALES|ISM|PMI|UNEMPLOYMENT|CLAIMS)\b/i;

function gapPct(desk: SpxDeskPayload): number | null {
  const pdc = desk.prior_close;
  if (pdc == null || pdc <= 0 || desk.price <= 0) return null;
  return ((desk.price - pdc) / pdc) * 100;
}

function clampWeight(value: number, max = 4): number {
  return Math.min(max, Math.max(0.5, value));
}

function flowSkew(desk: SpxDeskPayload): {
  direction: SpxPlayDirection | null;
  notional: number;
  label: string;
  weight: number;
} {
  const floor = playLottoFlowMinNotional();
  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) >= floor) {
    return {
      direction: net > 0 ? "long" : "short",
      notional: Math.abs(net),
      label: `$${(Math.abs(net) / 1_000_000).toFixed(1)}M 0DTE flow skew`,
      weight: clampWeight(Math.abs(net) / floor),
    };
  }

  let bull = 0;
  let bear = 0;
  for (const f of desk.spx_flows?.slice(0, 12) ?? []) {
    // THREE-WAY (mirror spx-signals.tapeSkew): UNKNOWN-side prints (parser-truth
    // option_type='UNKNOWN'/direction='unknown') must DROP — never fall into bear,
    // which produced false SHORT/put-led lotto signals on typeless UW prints.
    const opt = f.option_type.toUpperCase();
    if (f.direction === "bullish" || opt.startsWith("C")) bull += f.premium;
    else if (f.direction === "bearish" || opt.startsWith("P")) bear += f.premium;
    // else: unknown/typeless — count neither side
  }
  const total = bull + bear;
  if (total < floor) {
    return { direction: null, notional: total, label: "Flow below catalyst floor", weight: 0 };
  }
  if (bull > bear * 1.15) {
    return {
      direction: "long",
      notional: total,
      label: `$${(total / 1_000_000).toFixed(1)}M call-led tape`,
      weight: clampWeight(total / floor),
    };
  }
  if (bear > bull * 1.15) {
    return {
      direction: "short",
      notional: total,
      label: `$${(total / 1_000_000).toFixed(1)}M put-led tape`,
      weight: clampWeight(total / floor),
    };
  }
  return { direction: null, notional: total, label: "Flow mixed", weight: 0 };
}

function macroCatalysts(events: MacroEvent[]): LottoCatalystHit[] {
  const hits: LottoCatalystHit[] = [];
  for (const ev of events) {
    const title = `${ev.event} ${ev.country}`.toUpperCase();
    if (!MACRO_RE.test(title)) continue;
    hits.push({
      id: `macro:${ev.event}`,
      label: `Macro: ${ev.event}`,
      direction: "neutral",
    });
  }
  return hits;
}

function darkPoolDirection(desk: SpxDeskPayload): {
  direction: SpxPlayDirection | null;
  weight: number;
} {
  const dp = desk.dark_pool;
  if (!dp) return { direction: null, weight: 0 };
  const call = dp.call_premium ?? 0;
  const put = dp.put_premium ?? 0;
  const total = call + put;
  if (total < 500_000) return { direction: null, weight: 0 };
  const weight = clampWeight(total / 500_000, 2.5);
  if (call > put * 2) return { direction: "long", weight };
  if (put > call * 2) return { direction: "short", weight };
  if (dp.bias === "bullish") return { direction: "long", weight: Math.max(1, weight * 0.85) };
  if (dp.bias === "bearish") return { direction: "short", weight: Math.max(1, weight * 0.85) };
  return { direction: null, weight: 0 };
}

function technicalDirection(desk: SpxDeskPayload): {
  direction: SpxPlayDirection | null;
  label: string;
  weight: number;
} {
  const price = desk.price;
  if (price <= 0) return { direction: null, label: "No price", weight: 0 };

  const pdc = desk.prior_close;
  const gap = gapPct(desk);
  const wall = desk.gex_walls?.[0];
  const gapMin = playLottoGapMinPct();

  if (gap != null && Math.abs(gap) >= gapMin) {
    return {
      direction: gap > 0 ? "long" : "short",
      label: `Gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}% vs prior close`,
      weight: clampWeight(Math.abs(gap) / gapMin, 3),
    };
  }

  if (desk.vwap != null) {
    if (price >= desk.vwap && desk.pdh != null && price > desk.pdh - 5) {
      return {
        direction: "long",
        label: `Above VWAP ${desk.vwap.toFixed(0)} / PDH context`,
        weight: 1.2,
      };
    }
    if (price <= desk.vwap && desk.pdl != null && price < desk.pdl + 5) {
      return {
        direction: "short",
        label: `Below VWAP ${desk.vwap.toFixed(0)} / PDL context`,
        weight: 1.2,
      };
    }
  }

  if (wall) {
    if (wall.kind === "support" && price >= wall.strike - 8) {
      return { direction: "long", label: `At GEX support ${wall.strike.toFixed(0)}`, weight: 1.1 };
    }
    if (wall.kind === "resistance" && price <= wall.strike + 8) {
      return { direction: "short", label: `At GEX resistance ${wall.strike.toFixed(0)}`, weight: 1.1 };
    }
  }

  if (pdc != null) {
    // EDGE-09: prior-close alone (weight=1) is insufficient signal to commit
    // to a lotto direction. Return null so the caller can skip lotto rather
    // than being tipped by a weak fallback on low-catalyst days.
    return {
      direction: null,
      label: `Prior close ${pdc.toFixed(0)} — insufficient signal (weight=1 only)`,
      weight: 1,
    };
  }

  return { direction: null, label: "Structure unclear", weight: 0 };
}

function weightedDirectionTotals(signals: LottoDirectionSignal[]): { long: number; short: number } {
  let long = 0;
  let short = 0;
  for (const s of signals) {
    if (s.direction === "long") long += s.weight;
    else short += s.weight;
  }
  return { long, short };
}

export function evaluateLottoCatalysts(desk: SpxDeskPayload): LottoCatalystEvaluation {
  const catalysts: LottoCatalystHit[] = [];
  const direction_signals: LottoDirectionSignal[] = [];

  catalysts.push(...macroCatalysts(desk.macro_events ?? []));

  const flow = flowSkew(desk);
  if (flow.direction && flow.weight > 0) {
    catalysts.push({ id: "flow", label: flow.label, direction: flow.direction });
    direction_signals.push({
      id: "flow",
      direction: flow.direction,
      label: flow.label,
      weight: flow.weight,
    });
  }

  const gap = gapPct(desk);
  const gapMin = playLottoGapMinPct();
  if (gap != null && Math.abs(gap) >= gapMin) {
    const dir: SpxPlayDirection = gap > 0 ? "long" : "short";
    const gapLabel =
      desk.gap_source === "SPY"
        ? `SPY premarket gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}%`
        : `SPX gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}%`;
    const gapWeight = clampWeight(Math.abs(gap) / gapMin, 3);
    catalysts.push({
      id: "gap",
      label: gapLabel,
      direction: dir,
    });
    direction_signals.push({ id: "gap", direction: dir, label: gapLabel, weight: gapWeight });
  }

  const dp = darkPoolDirection(desk);
  if (dp.direction && dp.weight > 0) {
    const label = `Dark pool ${desk.dark_pool?.bias ?? dp.direction} accumulation`;
    catalysts.push({ id: "dark_pool", label, direction: dp.direction });
    direction_signals.push({ id: "dark_pool", direction: dp.direction, label, weight: dp.weight });
  }

  if (desk.vix_term?.structure === "backwardation") {
    catalysts.push({
      id: "vix",
      label: "VIX backwardation — vol expansion bid",
      direction: "neutral",
    });
  }

  const tech = technicalDirection(desk);
  if (tech.direction && tech.weight > 0) {
    direction_signals.push({
      id: "technical",
      direction: tech.direction,
      label: tech.label,
      weight: tech.weight,
    });
  }

  const { long: longWeight, short: shortWeight } = weightedDirectionTotals(direction_signals);
  const minWeight = playLottoMinDirectionWeight();
  const minVotes = playLottoMinDirectionSignals();

  let direction: SpxPlayDirection | null = null;
  if (longWeight >= minWeight && longWeight > shortWeight) direction = "long";
  else if (shortWeight >= minWeight && shortWeight > longWeight) direction = "short";

  const longVotes = direction_signals.filter((s) => s.direction === "long").length;
  const shortVotes = direction_signals.filter((s) => s.direction === "short").length;
  const voteOk =
    direction === "long"
      ? longVotes >= minVotes
      : direction === "short"
        ? shortVotes >= minVotes
        : false;

  const qualified = catalysts.length >= 1 && direction != null && voteOk;
  const catalyst_summary = catalysts.map((c) => c.label).join(" · ") || "No catalyst";
  const leadingWeight = Math.max(longWeight, shortWeight);
  const confidence = Math.min(
    96,
    catalysts.length * 16 + leadingWeight * 10 + (qualified ? 12 : 0)
  );

  const reason = !qualified
    ? catalysts.length < 1
      ? "No catalyst-tier signal — drift day"
      : direction == null
        ? `Direction split (${longWeight.toFixed(1)}L / ${shortWeight.toFixed(1)}S wt) — need ${minWeight}+ aligned`
        : `Need ${minVotes}+ agreeing signals (${longVotes}L / ${shortVotes}S votes)`
    : "Catalyst + weighted direction aligned";

  return {
    qualified,
    direction,
    catalysts,
    direction_signals,
    catalyst_summary,
    confidence,
    reason,
  };
}
