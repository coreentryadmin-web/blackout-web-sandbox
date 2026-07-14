// OVERNIGHT CORTEX SOURCE: flow-persistence — did the flagging flow last into the close.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md §2.2 / the "one-print splash" class):
// an overnight pick is only as good as the conviction of the flow that flagged it. A
// multi-day flow STREAK, or flow that persisted into the back half of today's session,
// is durable positioning worth holding overnight; a single morning print that never
// repeated is a splash that has already played out by the close — nothing to carry.
// Deterministic reads:
//   - STREAK: dossier.flow_streak.days ≥ 2 ⇒ durable (support); a single-day, single-
//     print flag whose last print was in the MORNING ⇒ splash (oppose).
// Asymmetric: persistence is a modest support, a splash is a heavier oppose (holding a
// spent splash overnight is exactly the low-conviction carry the deep-dive warns of).

import type { OvernightInputs, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum } from "./shared";

/** A flow streak of at least this many sessions is durable positioning. */
export const PERSISTENT_STREAK_DAYS = 2;

/** ET minutes-of-day after which a print counts as "into the close" (persisted). 780 =
 *  1:00 PM ET, the back half of the 9:30–4:00 session. A single-print flag whose last
 *  print is before this is a morning splash. */
export const CLOSE_HALF_ET_MINUTES = 13 * 60;

/** Support weight for persistent flow (streak or into-the-close). Capped small. */
export const FLOW_PERSISTENT_SUPPORT_WEIGHT = 0.5;

/** Per-source support cap. */
export const FLOW_PERSISTENCE_SUPPORT_CAP = 0.5;

/** Oppose weight for a spent one-print morning splash. */
export const FLOW_SPLASH_OPPOSE_WEIGHT = 0.6;

/** Minutes-of-day in America/New_York for an ISO instant; null when unparseable.
 *  Deterministic given its input (Intl, no Date.now()). */
export function etMinutesOfDay(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function deriveFlowPersistenceEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { flow } = input;
  if (!flow) return [absentForMissingSlice("flow-persistence", input, "no flow-streak read for the ticker")];
  if (flow.streakDays == null && flow.flowCount == null) {
    return [absentForMissingSlice("flow-persistence", input, "neither a flow streak nor a print count available")];
  }

  // --- Multi-day streak: the strongest persistence signal --------------------
  if (flow.streakDays != null && flow.streakDays >= PERSISTENT_STREAK_DAYS) {
    return [
      {
        source: "flow-persistence",
        stance: "supports",
        weight: FLOW_PERSISTENT_SUPPORT_WEIGHT,
        asOf: flow.asOf,
        detail: `flow streak ${fmtNum(flow.streakDays)} sessions — durable positioning behind the pick, worth carrying overnight.`,
      },
    ];
  }

  // --- Single-session flag: did it reach the close, or splash in the morning? -
  const lastMin = flow.lastPrintAt ? etMinutesOfDay(flow.lastPrintAt) : null;
  if (lastMin != null) {
    if (lastMin >= CLOSE_HALF_ET_MINUTES) {
      return [
        {
          source: "flow-persistence",
          stance: "supports",
          weight: FLOW_PERSISTENT_SUPPORT_WEIGHT,
          asOf: flow.asOf,
          detail: `flow persisted into the close (last print ${fmtNum(lastMin / 60)}h ET) — not a morning splash.`,
        },
      ];
    }
    const oneProbable = (flow.flowCount ?? 0) <= 1;
    if (oneProbable) {
      return [
        {
          source: "flow-persistence",
          stance: "opposes",
          weight: FLOW_SPLASH_OPPOSE_WEIGHT,
          asOf: flow.asOf,
          detail: `single morning print (last ${fmtNum(lastMin / 60)}h ET, ${fmtNum(flow.flowCount ?? 0)} print(s), no multi-day streak) — a spent splash, nothing to carry overnight.`,
        },
      ];
    }
  }

  // Some flow, no streak, timing unknown / multi-print but early — honest no-edge.
  return [
    absentForMissingSlice(
      "flow-persistence",
      input,
      `flow present (${flow.flowCount == null ? "n/a" : fmtNum(flow.flowCount)} print(s), streak ${flow.streakDays == null ? "n/a" : fmtNum(flow.streakDays)}) but no clear persistence or splash read`
    ),
  ];
}
