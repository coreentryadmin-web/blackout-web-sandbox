import type { SpxDeskSummary } from "@/lib/platform/types";
import type { PlaybookPlay } from "../types";
import type { DayTradeSignal } from "./day-trade-types";
import { todayEt as todayEtStr } from "@/lib/et-date";

export type SpxMacroBias = "bull" | "bear" | "neutral";

/** Infer session-wide SPX bias from desk summary fields. */
export function resolveSpxMacroBias(spx: SpxDeskSummary): SpxMacroBias {
  let bullish = 0;
  let bearish = 0;

  if (spx.above_vwap === true) bullish += 1;
  else if (spx.above_vwap === false) bearish += 1;

  const tide = (spx.tide_bias ?? "").toLowerCase();
  if (/bull|risk.?on|positive/i.test(tide)) bullish += 1;
  if (/bear|risk.?off|negative/i.test(tide)) bearish += 1;

  if (spx.flow_0dte_net != null) {
    if (spx.flow_0dte_net > 0) bullish += 1;
    else if (spx.flow_0dte_net < 0) bearish += 1;
  }

  if (spx.change_pct != null) {
    if (spx.change_pct > 0.15) bullish += 1;
    else if (spx.change_pct < -0.15) bearish += 1;
  }

  if (bullish >= bearish + 2) return "bull";
  if (bearish >= bullish + 2) return "bear";
  return "neutral";
}

export function isLongDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  return d.includes("LONG") || d === "BULL" || d === "BULLISH";
}

export function isShortDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  return d.includes("SHORT") || d === "BEAR" || d === "BEARISH";
}

export function isAmbiguousDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  if (!d || d === "—" || d === "NEUTRAL" || d === "UNKNOWN") return true;
  const long = isLongDirection(direction);
  const short = isShortDirection(direction);
  return !long && !short;
}

export function playAlignsWithSpxBias(direction: string, bias: SpxMacroBias): boolean {
  if (isAmbiguousDirection(direction)) return false;
  if (bias === "neutral") return true;
  if (bias === "bull") return isLongDirection(direction);
  return isShortDirection(direction);
}

export function filterSignalsBySpxAlignment(
  signals: DayTradeSignal[],
  spx: SpxDeskSummary | null,
  requireAlignment: boolean
): { signals: DayTradeSignal[]; bias: SpxMacroBias | null; dropped: number } {
  if (!requireAlignment || !spx) {
    return { signals, bias: spx ? resolveSpxMacroBias(spx) : null, dropped: 0 };
  }

  const bias = resolveSpxMacroBias(spx);
  const aligned = signals.map((s) => ({
    ...s,
    spx_aligned: playAlignsWithSpxBias(s.direction, bias),
  }));
  const kept = aligned.filter((s) => s.spx_aligned);
  return { signals: kept, bias, dropped: aligned.length - kept.length };
}

export function parseDayMaxDte(filters: Record<string, string | number | boolean>): number {
  const raw = Number(filters.max_dte);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return 1;
}

export function optionsPlayWithinMaxDte(optionsPlay: string, maxDte: number): boolean {
  const text = optionsPlay.trim();
  if (!text || text === "—") return true;

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const expiry = new Date(`${iso[1]}T16:00:00-04:00`);
    const todayEt = todayEtStr();
    const todayMs = new Date(`${todayEt}T12:00:00-04:00`).getTime();
    const dte = Math.round((expiry.getTime() - todayMs) / 86_400_000);
    return dte <= maxDte;
  }
  // No parseable expiry — reject when enforcing tight DTE (0–1 DTE day trade).
  return maxDte > 1;
}

export function filterPlaysByMaxDte(plays: PlaybookPlay[], maxDte: number): PlaybookPlay[] {
  return plays.filter((p) => optionsPlayWithinMaxDte(p.options_play, maxDte));
}
