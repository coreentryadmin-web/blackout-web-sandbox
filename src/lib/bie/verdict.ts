import "server-only";

// composeVerdict — the server orchestrator for BIE cross-tool verdict synthesis (task #59).
// Plans the relevant legs (depth matches merit), gathers each FAIL-OPEN (any reader failing → its
// field null + a surfaced unavailableSources entry, never a throw, never fabricated), then hands the
// summarized data to the PURE assembler (verdict-core.ts) which builds the BieAnswerEnvelope.
//
// Consumes ONLY landed readers — getGexPositioning (gamma), getFlowTapeSummary (flow), and Track B's
// arsenal (fetchNextEarningsDate, fetchTickerFundamentalsBundle, fetchPolygonMacroBackdrop,
// fetchMarketBreadthBundle, fetchRelatedCompanies). No new provider calls.

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { getFlowTapeSummary } from "@/lib/platform/flow-service";
import { fetchNextEarningsDate } from "@/lib/providers/uw-earnings";
import { fetchTickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import { fetchPolygonMacroBackdrop } from "@/lib/providers/polygon-macro";
import { fetchMarketBreadthBundle } from "@/lib/bie/market-breadth";
import { fetchRelatedCompanies } from "@/lib/providers/polygon-related";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { cortexCitationFor, directionFromQuestion } from "@/lib/bie/cortex-read";
import {
  planVerdictLegs,
  assembleVerdictEnvelope,
  type VerdictInputs,
  type VerdictLegPlan,
} from "@/lib/bie/verdict-core";
import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import type { BieComposed } from "@/lib/bie/composers-shared";

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Synthesize a cross-tool verdict → a populated BieAnswerEnvelope (+ its markdown for the string path). */
export async function composeVerdict(ticker: string, question: string): Promise<BieComposed | null> {
  const T = normalizeVectorTicker(ticker || "SPX");
  const plan: VerdictLegPlan = planVerdictLegs(question, T);
  const unavailable: BieUnavailableSource[] = [];

  // Gamma + flow anchor every verdict; the arsenal legs run ONLY when the plan warrants them.
  // PR-H: the Cortex leg runs on EVERY verdict — pinned commit-time evidence when a
  // 0DTE play/skip exists this session, live composition otherwise (cortexCitationFor
  // never throws; an outage arrives as mode "unavailable" and is surfaced, not hidden).
  const [pos, flowSummary, earnings, fundamentals, macro, breadth, related, cortexCitation] = await Promise.all([
    safe(() => getGexPositioning(T)),
    plan.flow ? safe(() => getFlowTapeSummary({ ticker: T, limit: 50 })) : Promise.resolve(null),
    plan.earnings ? safe(() => fetchNextEarningsDate(T)) : Promise.resolve(null),
    plan.fundamentals ? safe(() => fetchTickerFundamentalsBundle(T)) : Promise.resolve(null),
    plan.macro ? safe(() => fetchPolygonMacroBackdrop()) : Promise.resolve(null),
    plan.breadth ? safe(() => fetchMarketBreadthBundle()) : Promise.resolve(null),
    plan.related ? safe(() => fetchRelatedCompanies(T)) : Promise.resolve(null),
    safe(() => cortexCitationFor(T, { direction: directionFromQuestion(question), allowLive: true })),
  ]);

  // Positioning → regime.
  const spot = pos?.spot ?? null;
  const flip = pos?.flip ?? null;
  const regime: VerdictInputs["regime"] =
    spot != null && flip != null ? (Math.abs(spot - flip) / spot <= 0.001 ? "transition" : spot > flip ? "long" : "short") : "unknown";

  // Flow call/put split from the recent prints.
  let flow: VerdictInputs["flow"] = null;
  if (plan.flow) {
    if (flowSummary && flowSummary.count > 0) {
      let callP = 0;
      let putP = 0;
      for (const r of flowSummary.recent ?? []) {
        const p = Number(r.premium) || 0;
        if (String(r.option_type).toUpperCase() === "CALL") callP += p;
        else if (String(r.option_type).toUpperCase() === "PUT") putP += p;
      }
      flow = { count: flowSummary.count, total_premium: flowSummary.total_premium, call_premium: callP, put_premium: putP };
    } else {
      unavailable.push({ source: "flow tape", reason: "no prints in-window" });
    }
  }

  // Arsenal legs → summarized shapes; requested-but-thin → unavailableSources.
  const earn: VerdictInputs["earnings"] = plan.earnings
    ? earnings && earnings.earnings_date
      ? { earnings_date: earnings.earnings_date, days_until: earnings.days_until, report_time: earnings.report_time ?? null, is_confirmed: !!earnings.is_confirmed }
      : (unavailable.push({ source: "earnings", reason: "no upcoming date" }), null)
    : null;

  const fund: VerdictInputs["fundamentals"] = plan.fundamentals
    ? fundamentals && (fundamentals.short_interest?.days_to_cover != null || fundamentals.short_volume_ratio != null)
      ? {
          days_to_cover: fundamentals.short_interest?.days_to_cover ?? null,
          short_volume_ratio: fundamentals.short_volume_ratio ?? null,
          price_target: null, // Benzinga PT object left out of the numeric summary; section still renders SI.
          as_of: fundamentals.as_of ?? null,
        }
      : (unavailable.push({ source: "fundamentals/short-interest", reason: "no data for ticker" }), null)
    : null;

  const macroSummary: VerdictInputs["macro"] = plan.macro
    ? macro && (macro.treasury.yield_10_year != null || macro.inflation.cpi != null)
      ? { yield_10_year: macro.treasury.yield_10_year, curve_10y_1y_spread: macro.treasury.curve_10y_1y_spread, cpi: macro.inflation.cpi, date: macro.as_of }
      : (unavailable.push({ source: "macro backdrop", reason: "unavailable" }), null)
    : null;

  const breadthSummary: VerdictInputs["breadth"] = plan.breadth
    ? breadth && breadth.tone !== "unknown"
      ? { tone: breadth.tone, summary: breadth.summary, as_of: breadth.as_of }
      : (unavailable.push({ source: "breadth", reason: "unavailable" }), null)
    : null;

  const relatedList: string[] | null = plan.related ? related?.related ?? (unavailable.push({ source: "peers", reason: "none found" }), null) : null;

  // Cortex leg: an "unavailable" citation (outage / all sources absent) is surfaced in
  // unavailableSources instead of rendered as evidence — honest, never fabricated.
  const cortex: VerdictInputs["cortex"] =
    cortexCitation == null
      ? null
      : cortexCitation.mode === "unavailable"
        ? (unavailable.push({ source: "Night Hawk Cortex", reason: cortexCitation.headline }), null)
        : cortexCitation;

  const inputs: VerdictInputs = {
    ticker: T,
    question,
    plan,
    positioning: pos
      ? { spot, flip, call_wall: pos.call_wall, put_wall: pos.put_wall, max_pain: pos.max_pain, gamma_posture: pos.gamma_posture }
      : (unavailable.push({ source: "GEX positioning", reason: "cold matrix / no spot" }), null),
    regime,
    flow,
    earnings: earn,
    fundamentals: fund,
    macro: macroSummary,
    breadth: breadthSummary,
    related: relatedList,
    cortex,
    unavailable,
  };

  const envelope = assembleVerdictEnvelope(inputs);
  return { answer: envelope.markdown, context: { verdict: inputs, envelope }, envelope };
}
