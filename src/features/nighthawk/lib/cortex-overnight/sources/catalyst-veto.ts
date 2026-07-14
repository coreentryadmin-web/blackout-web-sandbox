// OVERNIGHT CORTEX SOURCE: catalyst-veto — THE overnight killer.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md §3.4): today the picker only
// NUDGES a score for earnings/binary events (−6 catalyst points, and only when a
// flow expiry matches the event date). "No play can currently be VETOED for an
// earnings/binary event, and no play was." A hot-flow name absorbs −6 and publishes
// anyway; a Friday-expiry play the night before Tuesday earnings takes zero penalty.
// The deep-dive's fix shape, verbatim: "earnings-tomorrow (or before the play's
// option expiry) + directional premium ⇒ hard publish veto ... with the usual
// SKIP-card visibility instead of silence."
//
// This source implements exactly that: a scheduled earnings report — or any dated
// binary event (FDA/PDUFA/M&A) — that lands BEFORE or AT the play's grading horizon
// is a HARD VETO, unless the candidate is explicitly flagged a catalyst play (then
// the event IS the thesis, §3.4's one documented exemption). When there is no event
// inside the horizon, the source emits a small SUPPORT: "clear of binary events
// overnight" is a genuine positive for a next-day hold (no gap-through-stop landmine),
// and it also keeps a clean, calendared name from reading as a total-outage abstain.

import type { OvernightInputs, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, dayNumber } from "./shared";

/** Raw weight of the catalyst VETO. Vetoes are unbounded blocks, so the magnitude is
 *  for the calibration ledger only — 3.0 dwarfs any support so a vetoed play can
 *  never read as size-worthy even if the ledger ever summed stances by mistake. */
export const CATALYST_VETO_WEIGHT = 3.0;

/** Raw weight of the "clear overnight" support. 0.3 — a real but modest positive:
 *  no binary landmine in the hold window is the baseline a good overnight pick should
 *  clear, not an edge. Also the signal that keeps a calendared-but-quiet name OUT of
 *  the total-outage abstain path (types.ts OvernightVerdict.abstained). */
export const CATALYST_CLEAR_SUPPORT_WEIGHT = 0.3;

/** Per-source support cap (one "clear" support max). */
export const CATALYST_VETO_SUPPORT_CAP = 0.3;

/** Raw weight of the residual-risk OPPOSE emitted for an explicit catalyst play whose
 *  event lands in-horizon. The veto is exempted (the member is deliberately trading
 *  the event) but binary event risk on an overnight hold is never zero, so the lens
 *  still records an honest opposition rather than pretending the risk vanished. */
export const CATALYST_PLAY_RESIDUAL_OPPOSE_WEIGHT = 0.5;

/**
 * Does a scheduled earnings report on `earningsDate` land before or at the play's
 * grading horizon (`horizonDate`)? PREMARKET earnings gap the stock BEFORE it can be
 * entered — even an earnings date equal to the horizon is a landmine because the play
 * is held THROUGH the open. AFTERHOURS earnings on a date strictly inside the horizon
 * are inside the hold; afterhours ON the horizon date report at the horizon's own
 * close (the grading bar) and are treated as in-horizon too (the binary resolves
 * against the position before it is graded). Undated/unknown report time is treated
 * as the riskier premarket case (the event exists; only its timing is unverified).
 */
export function earningsInHorizon(
  earningsDay: number,
  reportTime: "premarket" | "afterhours" | "unknown" | null,
  horizonDay: number
): boolean {
  // An event strictly before the horizon that has already passed at NOW is handled by
  // the caller (it filters events dated before `now`'s day). Here both operands are
  // day-numbers; earnings on or before the horizon day are in the hold window, with
  // afterhours getting the same treatment as premarket for the on-horizon boundary
  // (the report still resolves before grading).
  void reportTime; // report-time nuance is captured in the detail sentence, not the boundary
  return earningsDay <= horizonDay;
}

export function deriveCatalystVetoEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { catalyst } = input;
  if (!catalyst) return [absentForMissingSlice("catalyst-veto", input, "no earnings/catalyst calendar read")];

  const nowDay = dayNumber(input.now);
  const horizonDay = dayNumber(input.horizonDate);
  if (nowDay == null || horizonDay == null) {
    return [absentForMissingSlice("catalyst-veto", input, "invalid now/horizon date — cannot place events on the calendar")];
  }

  const items: OvernightEvidenceItem[] = [];
  let sawInHorizonEvent = false;

  // --- Scheduled earnings ----------------------------------------------------
  const earningsDay = dayNumber(catalyst.earningsDate);
  if (earningsDay != null && earningsDay >= nowDay && earningsInHorizon(earningsDay, catalyst.earningsReportTime, horizonDay)) {
    sawInHorizonEvent = true;
    const when =
      catalyst.earningsReportTime === "premarket"
        ? "before the open (premarket)"
        : catalyst.earningsReportTime === "afterhours"
          ? "after the close"
          : "time unconfirmed";
    if (catalyst.isCatalystPlay) {
      // §3.4 exemption: the event is the thesis. No veto — but record the residual risk.
      items.push({
        source: "catalyst-veto",
        stance: "opposes",
        weight: CATALYST_PLAY_RESIDUAL_OPPOSE_WEIGHT,
        asOf: catalyst.asOf,
        detail:
          `${input.ticker} reports earnings ${when} on ${catalyst.earningsDate} (inside the hold to ${input.horizonDate}); ` +
          `play is flagged a catalyst play so the veto is exempt, but overnight binary risk still opposes.`,
      });
    } else {
      items.push({
        source: "catalyst-veto",
        stance: "veto",
        weight: CATALYST_VETO_WEIGHT,
        asOf: catalyst.asOf,
        detail:
          `${input.ticker} reports earnings ${when} on ${catalyst.earningsDate}, at/before the play horizon ${input.horizonDate} — ` +
          `a binary gap the entry cannot manage; not flagged a catalyst play, so VETO (§3.4 overnight killer).`,
      });
    }
  }

  // --- Dated binary events (FDA/PDUFA/M&A/etc.) ------------------------------
  for (const ev of catalyst.binaryEvents) {
    const evDay = dayNumber(ev.date);
    if (evDay == null || evDay < nowDay || evDay > horizonDay) continue; // undated or outside the hold
    sawInHorizonEvent = true;
    if (catalyst.isCatalystPlay) {
      items.push({
        source: "catalyst-veto",
        stance: "opposes",
        weight: CATALYST_PLAY_RESIDUAL_OPPOSE_WEIGHT,
        asOf: catalyst.asOf,
        detail:
          `${input.ticker} has a ${ev.kind} event (${ev.label}) on ${ev.date}, inside the hold to ${input.horizonDate}; ` +
          `catalyst play, so exempt from veto — residual binary risk opposes.`,
      });
    } else {
      items.push({
        source: "catalyst-veto",
        stance: "veto",
        weight: CATALYST_VETO_WEIGHT,
        asOf: catalyst.asOf,
        detail:
          `${input.ticker} has a ${ev.kind} binary event (${ev.label}) on ${ev.date}, at/before the play horizon ${input.horizonDate} — ` +
          `unhedgeable event risk over the hold; not a catalyst play, so VETO.`,
      });
    }
  }

  // --- Clear overnight -------------------------------------------------------
  // No event inside the horizon: a genuine (modest) positive for a next-day hold, and
  // the signal that keeps a calendared-but-quiet name out of the total-outage abstain.
  if (!sawInHorizonEvent) {
    items.push({
      source: "catalyst-veto",
      stance: "supports",
      weight: CATALYST_CLEAR_SUPPORT_WEIGHT,
      asOf: catalyst.asOf,
      detail: `${input.ticker} has no earnings or dated binary event inside the hold to ${input.horizonDate} — clear of gap landmines overnight.`,
    });
  }

  return items;
}
