// SPX Live Desk commentary — deterministic, trader-first (2026-07-13 redesign).
//
// Directive: "We print a lot of shitty data. All the user wants: price action
// bullish/bearish, important events, king node anchor changes — walls fading, new ones
// building — chart technicals drifting hard, regime changes. Meaningful data so a user
// says: this can happen → I should take calls, puts, or wait."
//
// The old composition (composeSpxDeskBrief) restated ~25 labeled sections of mostly
// unchanged numbers (INTERNALS/DEALERS/WALLS/CROSSCHK/…) every 5-minute window. This
// rewrite serves EXACTLY three things, all composed by the shared BIE voice brain in
// src/lib/bie/spx-live-voice.ts (the same brain the SpxCommentaryRail runs client-side
// per desk tick, and Largo terminal Q&A prepends as its READ line):
//   headline — the one-line bias header (direction · conviction · mechanism → posture)
//   body     — the 3–4 sentence BIE voice read (+ live engine/lotto/power-hour lines)
//   watch    — the ≤3 trigger levels that would CHANGE the bias
//   changed  — transition events vs the previous 5-min window's desk (dedupe-keyed)
//
// No LLM, no grounding guard needed: every number is the desk's own value (or its
// rounding) by construction — asserted by spx-commentary.test.ts.

import type { SpxDeskPayload } from "./spx-desk";
import {
  composeBiasHeaderLine,
  composeBiasVoice,
  deriveSpxBias,
  deriveTriggerLevels,
  detectSpxVoiceEvents,
  fmtLevel,
  voiceSnapshotFromDesk,
} from "@/lib/bie/spx-live-voice";

export type SpxCommentaryResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

export type SpxCommentaryCross = {
  openPlay?: {
    status: string;
    direction: string;
    entry_price: number | null;
    stop: number | null;
    target: number | null;
  } | null;
  lotto?: { phase: string; direction: string | null; strike: number | null } | null;
  powerHour?: { phase: string; direction: string | null; strike: number | null } | null;
};

/** Live engine/lotto/power-hour positions — one line each, only when actually live.
 *  The read must never hand a member the opposite side of an open desk position silently. */
function playLines(cross: SpxCommentaryCross | undefined, bias: "bullish" | "bearish" | "neutral"): string[] {
  const lines: string[] = [];
  const op = cross?.openPlay;
  if (op && op.status === "open") {
    const dir = op.direction === "long" ? "LONG" : "SHORT";
    const conflict =
      (op.direction === "long" && bias === "bearish") || (op.direction === "short" && bias === "bullish");
    lines.push(
      `🎯 engine live ${dir}${op.entry_price != null ? ` from ${fmtLevel(op.entry_price)}` : ""}${op.stop != null ? `, stop ${fmtLevel(op.stop)}` : ""}${op.target != null ? `, target ${fmtLevel(op.target)}` : ""}${conflict ? " — read now conflicts with the open play, manage it first" : ""}`
    );
  }
  const lp = cross?.lotto;
  if (lp && lp.phase !== "NONE" && lp.phase !== "INVALID") {
    lines.push(
      `🎰 lotto ${lp.phase} — ${lp.direction === "long" ? "CALL" : "PUT"}${lp.strike != null ? ` ${fmtLevel(lp.strike)}` : ""}`
    );
  }
  const ph = cross?.powerHour;
  if (ph && ph.phase !== "NONE") {
    lines.push(
      `⚡ power hour ${ph.phase} — ${ph.direction === "long" ? "CALL" : "PUT"}${ph.strike != null ? ` ${fmtLevel(ph.strike)}` : ""}`
    );
  }
  return lines;
}

/**
 * Deterministic Live Desk read. `previous` (the prior 5-min window's desk) drives the
 * transition-only `changed` feed; a first window simply has no events.
 */
export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null,
  cross?: SpxCommentaryCross
): Promise<SpxCommentaryResult | null> {
  if (!desk.available || desk.price == null || !Number.isFinite(desk.price) || desk.price <= 0) {
    console.warn("[spx-commentary] skipping read: desk unavailable / no price");
    return null;
  }

  const snap = voiceSnapshotFromDesk(desk);
  const bias = deriveSpxBias(snap);
  const triggers = deriveTriggerLevels(snap, bias);
  const voice = composeBiasVoice(snap, bias);
  const headline = composeBiasHeaderLine(snap, bias);

  // Transition events vs the previous window — only genuine state changes print.
  // `previous` is a Partial; voiceSnapshotFromDesk only reads nullable fields, so a
  // partial desk simply yields fewer computable signals (never a throw).
  const changed = previous?.price
    ? detectSpxVoiceEvents(voiceSnapshotFromDesk(previous as SpxDeskPayload), snap).map((e) => e.line)
    : [];

  const body = [voice, ...playLines(cross, bias.direction)].join("\n");

  return {
    headline,
    bias: bias.direction,
    body,
    watch: triggers.map((t) => t.line),
    changed,
    as_of: new Date().toISOString(),
  };
}
