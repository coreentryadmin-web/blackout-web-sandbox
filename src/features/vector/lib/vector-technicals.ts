/**
 * Always-on TECHNICALS readout for the desk terminal (member ask: "the terminal should keep talking
 * about the indicators even when I haven't selected them on the chart"). The chart overlays are
 * opt-in (default off), but the READ — where price sits vs VWAP, whether the EMAs are stacked, RSI
 * zone, MACD posture, the auto-fib golden pocket, the last market-structure break — is useful all
 * the time. This module computes that read from the displayed bars, INDEPENDENT of which overlays
 * are toggled, so the terminal can narrate it continuously.
 *
 * Pure + dependency-light (reuses the same unit-tested `vector-indicators` / `vector-fib-swing` /
 * `vector-market-structure` numerics the chart draws, so the terminal can never disagree with a
 * toggled-on overlay). Every field is independently null-safe: a study that can't compute at the
 * current bar count simply doesn't contribute a line — honest, never fabricated.
 *
 * Session-scoping note (multi-session seed, TARGET_SEED_SESSIONS = 3): VWAP is session-anchored
 * and resets at each ET day boundary inside vwapSeries (#305). EMA/RSI/MACD are continuous by
 * definition — extra prior-session history only improves their warm-up. The golden pocket and
 * market structure are WINDOW-scoped BY DESIGN (dominant swing / pivots over everything displayed,
 * matching the chart's fib-auto + structure overlays) — deliberately NOT sliced to the last
 * session, because a swing or BOS that started in a prior seeded day is real context.
 */

import { vwapSeries, emaSeries, rsiSeries, macdSeries } from "./vector-indicators";
import { dominantSwing, goldenPocket } from "./vector-fib-swing";
import { detectStructureEvents, type StructureEvent } from "./vector-market-structure";

export type TechnicalsBar = { time: number; high: number; low: number; close: number; volume?: number };

export type EmaStack = "bullish" | "bearish" | "mixed";
export type RsiZone = "overbought" | "neutral" | "oversold";
export type MacdState = "bullish" | "bearish";

export type TechnicalsSummary = {
  spot: number | null;
  vwap: number | null;
  /** price vs VWAP as a signed % (positive = above). null when either is undefined. */
  vwapDeltaPct: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  /** ema9>ema21>ema50 → bullish; strictly reversed → bearish; anything else → mixed. */
  emaStack: EmaStack | null;
  rsi: number | null;
  rsiZone: RsiZone | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  macdState: MacdState | null;
  /** Auto-fib golden pocket (61.8–65%) of the dominant swing, low-to-high; null when no real swing. */
  goldenPocket: { low: number; high: number } | null;
  /** Most recent market-structure break (BOS/CHOCH), or null when none confirmed yet. */
  structure: StructureEvent | null;
};

/** Last non-null value of an aligned indicator series, or null. */
function lastDefined(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function classifyEmaStack(e9: number | null, e21: number | null, e50: number | null): EmaStack | null {
  if (e9 == null || e21 == null || e50 == null) return null;
  if (e9 > e21 && e21 > e50) return "bullish";
  if (e9 < e21 && e21 < e50) return "bearish";
  return "mixed";
}

function classifyRsiZone(rsi: number | null): RsiZone | null {
  if (rsi == null) return null;
  if (rsi >= 70) return "overbought";
  if (rsi <= 30) return "oversold";
  return "neutral";
}

/**
 * Compute the technicals read from the displayed bars. `spot` is the live price (defaults to the
 * last bar's close when null). Reuses the exact chart numerics; every field degrades to null
 * independently when its study can't compute at the current bar count.
 */
export function summarizeTechnicals(
  bars: readonly TechnicalsBar[],
  spot: number | null
): TechnicalsSummary {
  const closes = bars.map((b) => b.close);
  const px = spot != null && Number.isFinite(spot) && spot > 0 ? spot : (closes.length ? closes[closes.length - 1]! : null);

  // vwapSeries takes a mutable IndicatorBar[]; TechnicalsBar is a structural superset, so a shallow
  // copy satisfies the signature without weakening this module's readonly input contract.
  const vwap = bars.length ? lastDefined(vwapSeries([...bars])) : null;
  const ema9 = lastDefined(emaSeries(closes, 9));
  const ema21 = lastDefined(emaSeries(closes, 21));
  const ema50 = lastDefined(emaSeries(closes, 50));
  const rsi = lastDefined(rsiSeries(closes, 14));

  // MACD: take the last point where BOTH the line and its signal are defined.
  const macdPts = macdSeries(closes, 12, 26, 9);
  let macd: number | null = null, macdSignal: number | null = null, macdHist: number | null = null;
  for (let i = macdPts.length - 1; i >= 0; i--) {
    const p = macdPts[i]!;
    if (p.macd != null && p.signal != null) {
      macd = p.macd; macdSignal = p.signal; macdHist = p.histogram;
      break;
    }
  }

  // Auto-fib golden pocket of the dominant swing (same k=3 + 0.15%-of-spot floor as the chart).
  const swing = px != null ? dominantSwing(bars, 3, px * 0.0015) : null;
  const gp = swing ? goldenPocket(swing) : null;

  // Most recent structure break (BOS/CHOCH) at the same k=3 the chart's markers use.
  const events = bars.length ? detectStructureEvents(bars, 3) : [];
  const structure = events.length ? events[events.length - 1]! : null;

  return {
    spot: px,
    vwap,
    vwapDeltaPct: vwap != null && px != null && vwap > 0 ? ((px - vwap) / vwap) * 100 : null,
    ema9,
    ema21,
    ema50,
    emaStack: classifyEmaStack(ema9, ema21, ema50),
    rsi,
    rsiZone: classifyRsiZone(rsi),
    macd,
    macdSignal,
    macdHist,
    macdState: macd != null && macdSignal != null ? (macd >= macdSignal ? "bullish" : "bearish") : null,
    goldenPocket: gp ? { low: gp.bottom, high: gp.top } : null,
    structure,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Terminal-ready lines for the always-on "Technicals" section. Formatted HERE (numbers known) so the
 * terminal just prints them. Only emits a line per study that actually computed — an empty array
 * means "not enough bars yet", which the terminal renders as a quiet warming-up note.
 */
export function technicalsCallouts(s: TechnicalsSummary): string[] {
  const lines: string[] = [];

  if (s.vwap != null && s.vwapDeltaPct != null) {
    const side = s.vwapDeltaPct >= 0 ? "above" : "below";
    lines.push(`VWAP ${fmt(round2(s.vwap))} — price ${Math.abs(s.vwapDeltaPct).toFixed(2)}% ${side}`);
  }

  if (s.emaStack != null && s.ema9 != null && s.ema21 != null && s.ema50 != null) {
    const word = s.emaStack === "bullish" ? "stacked bullish" : s.emaStack === "bearish" ? "stacked bearish" : "mixed";
    const rel = s.emaStack === "bullish" ? ">" : s.emaStack === "bearish" ? "<" : "·";
    lines.push(`EMA 9/21/50 ${word} (${fmt(round2(s.ema9))} ${rel} ${fmt(round2(s.ema21))} ${rel} ${fmt(round2(s.ema50))})`);
  }

  if (s.rsi != null && s.rsiZone != null) {
    lines.push(`RSI ${Math.round(s.rsi)} — ${s.rsiZone}`);
  }

  if (s.macd != null && s.macdState != null) {
    const rel = s.macdState === "bullish" ? "above" : "below";
    const hist = s.macdHist != null ? ` · hist ${s.macdHist >= 0 ? "+" : ""}${round2(s.macdHist)}` : "";
    lines.push(`MACD ${s.macdState} — line ${rel} signal${hist}`);
  }

  if (s.goldenPocket != null) {
    lines.push(`Golden pocket ${fmt(round2(s.goldenPocket.low))}–${fmt(round2(s.goldenPocket.high))}`);
  }

  if (s.structure != null) {
    lines.push(`Structure ${s.structure.type} ${s.structure.direction} @ ${fmt(round2(s.structure.level))}`);
  }

  return lines;
}
