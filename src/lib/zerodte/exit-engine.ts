// 0DTE EXIT ENGINE (B-8, docs/audit/0DTE-BREAKTHROUGH-LEDGER.md) — the pure,
// deterministic "when do we get OUT" core. NO LLM in this path, no IO, no clock
// reads: everything arrives as input and the answer is a machine-readable decision,
// so the same tick is replayable in tests and auditable after the fact. The user's
// directive this file enforces: "never make a green trade turn red; if the thesis
// or logic breaks, enforce the exit strongly; everything should have a valid reason."
//
// Four rule families:
//   1. PROFIT RATCHET — an ACTIVATION-THRESHOLD floor (not a literal never-red lock
//      at +1%, which would scratch every winner into 0DTE noise — contracts oscillate
//      ±15% doing nothing): peak P&L ≥ +25% arms a breakeven floor; ≥ +50% raises it
//      to +20%; after a TRIM the runner's floor is +50%. The floor derives from the
//      LATCHED PEAK, so it is monotonic by construction — a retracing mark can never
//      lower it, only breach it.
//   2. THESIS-BREAK — unconditional and independent of P&L: a Cortex VETO-class
//      evidence item against the play, or ≥2 opposing items whose combined decayed
//      weight exceeds the entry's committed score margin, exits at market even at a
//      loss. A broken thesis is exited, not hoped on.
//   3. FLAT-TIMEOUT — ≥45 minutes inside the ±10% band is not "still working", it is
//      theta bleed: on 0DTE flat = losing, and a small scratch beats certain decay.
//   4. PLAN STOP/TARGET — the printed plan stays authoritative: stop exits, target
//      trims first (banks half) and exits the runner if already trimmed.
//
// PRECEDENCE (checked in this order — WHY documented per step):
//   protective exit (plan stop vs ratchet floor, whichever sits at the HIGHER mark)
//     > thesis break > plan target > flat timeout > hold.
//   - Protective exits first because they are the capital-preservation rules; when
//     both the stop and a ratchet floor are breached on the same tick, the HIGHER of
//     the two exit marks is the one that actually bounded the loss/protected the
//     profit, so its reason is the honest label for the exit that happened.
//   - Thesis break outranks the target: evidence that the play is WRONG beats a
//     rule that says "let it run" — taking the market price now is the strong-exit
//     enforcement the user asked for, and it fires at any P&L.
//   - Flat timeout last among the exits: it only exists for plays no other rule has
//     an opinion about (never reached when a stop/floor/thesis/target already fired).
//
// Missing data NEVER exits: no mark / no entry premium / no evidence → the engine
// holds (and keeps reporting the armed floor). Exits happen on observed numbers only.

import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import { pinnedLivePnlPct } from "./marks-math";

/** v1 exit constants (B-8: "thresholds are v1 constants; the counterfactual exit
 *  grader measures scratched-winner cost vs saved-losses and tunes them with data"). */
export const EXIT_RULES = {
  /** Peak P&L % that ARMS the ratchet (floor at breakeven). Below this the trade is
   *  still inside 0DTE noise and gets room to work. */
  ratchet_arm_pnl_pct: 25,
  /** The armed floor: breakeven — a trade that reached +25% may never finish red. */
  ratchet_arm_floor_pct: 0,
  /** Peak P&L % that LOCKS profit: floor rises from breakeven to +20%. */
  ratchet_lock_pnl_pct: 50,
  ratchet_lock_floor_pct: 20,
  /** Post-TRIM runner floor: half is banked at target; the rest never gives back
   *  more than down to +50% of the remaining position's basis. */
  runner_floor_pct: 50,
  /** Flat-timeout: age ≥ this AND the play never left the ±band → theta bleed exit. */
  flat_timeout_min: 45,
  flat_band_pct: 10,
  /** Thesis-break via opposing (non-veto) evidence needs at least this many items —
   *  one contrary reading is a data point, a cluster is a broken thesis. */
  thesis_min_opposes: 2,
  /** Noise floor for the opposing-weight margin when the entry's committed Cortex
   *  score is unknown/zero: two microscopic decayed opposes (< this combined) are
   *  residue, not evidence. Same scale as compose.ts's decayed weights. */
  thesis_min_oppose_weight: 0.5,
} as const;

export type ExitAction = "HOLD" | "RAISE_FLOOR" | "TRIM" | "EXIT";

export type ExitDecision = {
  action: ExitAction;
  /** The active protective floor in P&L % terms (null = no floor armed). Populated
   *  on EVERY decision so consumers can render "floor: +20%" even on a HOLD. */
  floorPnlPct: number | null;
  /** Machine-readable snake_case reason — persisted, grepped, never prose. */
  reason: string;
  /** One human sentence arguing the decision with the actual numbers. */
  detail: string;
};

export type ExitEngineInput = {
  /** PINNED ledger entry premium — the only entry reference P&L may use. */
  entryPremium: number | null;
  /** Freshest usable mark (live-marks lane preferred, sync snapshot fallback). */
  currentMark: number | null;
  /** Latched peak premium since flag (widened with currentMark internally). */
  peakPremium: number | null;
  /** Minutes since first flag. */
  ageMinutes: number | null;
  /** Cortex evidence for the play's OWN direction (vetoes+opposes+supports, decayed
   *  weights) — null when the Cortex could not see this tick (thesis check skipped;
   *  everything else still runs — missing data never exits). */
  cortexEvidence: EvidenceItem[] | null;
  /** Plan stop/target premiums (plan.ts rules applied to the pinned entry). */
  planStop: number | null;
  planTarget: number | null;
  /** Current lifecycle status (derivePlayStatus). CLOSED rows are never re-decided. */
  status: string | null;
  /** True once the play has trimmed (status TRIM is sticky via the peak latch). */
  trimmed: boolean;
  /** The entry's committed Cortex score (entry_context.cortex.score) — the cushion
   *  the thesis was bought with; opposing weight must exceed it to break the thesis.
   *  Null/absent → the thesis_min_oppose_weight noise floor is the margin. */
  entryCortexScore?: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtPct = (n: number | null) => (n == null ? "?" : `${n > 0 ? "+" : ""}${round2(n)}%`);

/**
 * The monotonic protective floor (P&L %) for a given PEAK P&L. Pure function of the
 * latched peak (which only ever grows) + the trim latch, so the floor can never
 * lower — the "monotonic ratchet" property is structural, not remembered state.
 */
export function ratchetFloorPct(peakPnlPct: number | null, trimmed: boolean): number | null {
  // Post-trim runner: +50% floor dominates every ratchet tier (20 < 50), so the
  // trim latch alone decides — a trimmed play's floor is never below +50%.
  if (trimmed) return EXIT_RULES.runner_floor_pct;
  if (peakPnlPct == null) return null;
  if (peakPnlPct >= EXIT_RULES.ratchet_lock_pnl_pct) return EXIT_RULES.ratchet_lock_floor_pct;
  if (peakPnlPct >= EXIT_RULES.ratchet_arm_pnl_pct) return EXIT_RULES.ratchet_arm_floor_pct;
  return null;
}

/** The snake_case reason for a floor breach/arm at this floor level. */
function floorReason(floor: number, trimmed: boolean): string {
  if (trimmed) return "runner_floor";
  return floor >= EXIT_RULES.ratchet_lock_floor_pct ? "ratchet_profit_floor" : "ratchet_breakeven_floor";
}

export type ThesisBreak = {
  /** The evidence source that broke the thesis (veto source, or the heaviest oppose). */
  source: string;
  /** "veto" or "opposing cluster" — which arm of the rule fired. */
  kind: "veto" | "oppose_cluster";
  detail: string;
};

/**
 * Thesis-break detection over the play-direction Cortex evidence. The evidence is
 * composed FOR the play's own direction, so stance is already relative to the play:
 * a "veto" item IS a direction-opposing hard fact (one loud contrary fact can kill
 * a thesis — same veto asymmetry as entry), and "opposes" items are the soft
 * contrary readings that must CLUSTER (≥2) past the entry's committed score margin
 * before they outweigh the cushion the play was entered with.
 */
export function detectThesisBreak(
  evidence: EvidenceItem[] | null,
  entryCortexScore: number | null | undefined
): ThesisBreak | null {
  if (evidence == null) return null; // Cortex can't see → thesis check skipped, never an exit
  const veto = evidence.find((e) => e.stance === "veto");
  if (veto) {
    return { source: veto.source, kind: "veto", detail: `[${veto.source}] ${veto.detail}` };
  }
  const opposes = evidence.filter((e) => e.stance === "opposes" && e.weight > 0);
  if (opposes.length < EXIT_RULES.thesis_min_opposes) return null;
  const combined = round2(opposes.reduce((acc, o) => acc + o.weight, 0));
  // The margin is the cushion the entry was committed with (its net Cortex score);
  // when that is unknown or ~0, the noise floor keeps two microscopic decayed
  // opposes from scratching a healthy play.
  const margin = Math.max(entryCortexScore ?? 0, EXIT_RULES.thesis_min_oppose_weight);
  if (combined <= margin) return null;
  const top = [...opposes].sort((a, b) => b.weight - a.weight)[0]!;
  return {
    source: top.source,
    kind: "oppose_cluster",
    detail:
      `${opposes.length} opposing readings, combined weight ${combined} > entry margin ${round2(margin)} — ` +
      `strongest: [${top.source}] ${top.detail}`,
  };
}

/**
 * THE exit decision for one open play at one tick. Pure and total: every input
 * combination returns exactly one decision with a reason — see the module doc for
 * the rule families and the precedence order (and WHY it is that order).
 */
export function evaluateExitState(input: ExitEngineInput): ExitDecision {
  const { entryPremium, currentMark } = input;

  // ── Guards: never re-decide a closed row; never exit on missing data. ──────────
  if (input.status === "CLOSED") {
    return { action: "HOLD", floorPnlPct: null, reason: "already_closed", detail: "Play is already closed — terminal." };
  }
  if (entryPremium == null || entryPremium <= 0) {
    return {
      action: "HOLD",
      floorPnlPct: null,
      reason: "no_entry_premium",
      detail: "No pinned entry premium — P&L is underivable, so no exit rule may fire.",
    };
  }

  // Peak is widened with the current mark so the floor derivation can never see a
  // peak below the mark it is judging (the DB latch does the same GREATEST).
  const peakPremium =
    input.peakPremium != null && currentMark != null
      ? Math.max(input.peakPremium, currentMark)
      : (input.peakPremium ?? currentMark);
  const pnlPct = pinnedLivePnlPct(entryPremium, currentMark);
  const peakPnlPct = pinnedLivePnlPct(entryPremium, peakPremium);
  const floor = ratchetFloorPct(peakPnlPct, input.trimmed);

  if (currentMark == null || pnlPct == null) {
    return {
      action: "HOLD",
      floorPnlPct: floor,
      reason: "no_live_mark",
      detail: "No usable live mark this tick — exits fire on observed prices only.",
    };
  }

  // ── 1. Protective exits: plan stop vs ratchet floor — the HIGHER mark wins. ────
  // Both rules cap damage; when both are breached on one tick, the higher exit
  // level is the one that actually protected more (a breakeven floor at entry ≫
  // the −50% stop), so its reason labels the exit.
  const stopBreached = input.planStop != null && currentMark <= input.planStop;
  const floorBreached = floor != null && pnlPct <= floor;
  if (stopBreached || floorBreached) {
    const floorMark = floor != null ? entryPremium * (1 + floor / 100) : null;
    const useFloor =
      floorBreached && (!stopBreached || (floorMark != null && floorMark >= (input.planStop as number)));
    if (useFloor) {
      const reason = floorReason(floor!, input.trimmed);
      return {
        action: "EXIT",
        floorPnlPct: floor,
        reason,
        detail:
          `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the ${fmtPct(floor)} floor armed by a ` +
          `${fmtPct(peakPnlPct)} peak — the ratchet exits so the green trade cannot finish red.`,
      };
    }
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: "plan_stop",
      detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the plan stop ${input.planStop} — the printed stop is authoritative.`,
    };
  }

  // ── 2. Thesis break: unconditional, fires at ANY P&L (including a loss). ───────
  const broken = detectThesisBreak(input.cortexEvidence, input.entryCortexScore);
  if (broken) {
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: `thesis_break:${broken.source}`,
      detail:
        `Thesis broken (${broken.kind}) at ${fmtPct(pnlPct)} — exiting at market, not hoping: ${broken.detail}`,
    };
  }

  // ── 3. Plan target: trim first (bank half), exit the runner if already trimmed. ─
  if (input.planTarget != null && currentMark >= input.planTarget) {
    if (input.trimmed) {
      return {
        action: "EXIT",
        floorPnlPct: floor,
        reason: "plan_target_final",
        detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) tagged the target ${input.planTarget} again after the trim — runner banked in full.`,
      };
    }
    return {
      action: "TRIM",
      floorPnlPct: EXIT_RULES.runner_floor_pct,
      reason: "plan_target_trim",
      detail:
        `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/above the target ${input.planTarget} — bank half; ` +
        `the runner's floor is now ${fmtPct(EXIT_RULES.runner_floor_pct)}.`,
    };
  }

  // ── 4. Flat timeout: ≥45min inside the ±10% band = theta bleed, scratch it. ────
  // peak < +band means the play NEVER worked (a +12% excursion resets the clock's
  // premise — that play had a pulse); pnl > −band leaves the losing tail to the
  // stop rules, which own it.
  if (
    input.ageMinutes != null &&
    input.ageMinutes >= EXIT_RULES.flat_timeout_min &&
    (peakPnlPct ?? 0) < EXIT_RULES.flat_band_pct &&
    pnlPct > -EXIT_RULES.flat_band_pct
  ) {
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: "flat_theta_bleed",
      detail:
        `${Math.floor(input.ageMinutes)}min in and the play never left the ±${EXIT_RULES.flat_band_pct}% band ` +
        `(peak ${fmtPct(peakPnlPct)}, now ${fmtPct(pnlPct)}) — on 0DTE flat is losing; a small scratch beats theta decay.`,
    };
  }

  // ── 5. Nothing fires: report the armed floor (RAISE_FLOOR) or plain hold. ──────
  if (floor != null) {
    return {
      action: "RAISE_FLOOR",
      floorPnlPct: floor,
      reason: input.trimmed ? "runner_floor_set" : `${floorReason(floor, false)}_set`,
      detail: `Floor ${fmtPct(floor)} armed by a ${fmtPct(peakPnlPct)} peak — holding above it (${fmtPct(pnlPct)}).`,
    };
  }
  return {
    action: "HOLD",
    floorPnlPct: null,
    reason: "hold",
    detail: `No exit rule fires at ${fmtPct(pnlPct)} (peak ${fmtPct(peakPnlPct)}) — plan stop/target stand.`,
  };
}

/** The counterfactual-grading record persisted into entry_context.exit on an engine
 *  EXIT — enough for the record page to later compute "exits saved X% vs riding to
 *  the close" without a new table (close_price lands on the row via the grader). */
export type ZeroDteExitContext = {
  reason: string;
  detail: string;
  /** The mark the engine exited at (becomes the row's frozen last_mark). */
  mark: number;
  pnl_pct: number | null;
  peak_pnl_pct: number | null;
  /** ISO instant of the decision. */
  at: string;
};

/** Pure assembly of the exit record (rounding at the data layer, per repo rule). */
export function buildExitContext(
  decision: ExitDecision,
  entryPremium: number | null,
  mark: number,
  peakPremium: number | null,
  nowMs: number
): ZeroDteExitContext {
  return {
    reason: decision.reason,
    detail: decision.detail,
    mark: round2(mark),
    pnl_pct: pinnedLivePnlPct(entryPremium, mark),
    peak_pnl_pct: pinnedLivePnlPct(entryPremium, peakPremium),
    at: new Date(nowMs).toISOString(),
  };
}
