/**
 * CROSS-EDITION GOVERNOR (PR-N8).
 *
 * The edition builder's funnel had no memory: it selected tonight's plays with zero awareness
 * of what played yesterday or the day before. The same ticker could appear in consecutive
 * editions (no cooldown), a three-night losing streak on the same name would repeat a fourth
 * time (no loss-halt), and sector exposure was only capped within a single edition (no rolling
 * sector cap). The 0DTE surface's governor (src/lib/zerodte/governor.ts) proved this class of
 * risk layer — concurrent cap, loss halt, re-entry lock — improves realized outcomes.
 *
 * This module adds three cross-edition rules, evaluated as a PURE function of the ranked
 * candidate list + recent play-outcome history:
 *
 *   1. REPEAT-TICKER COOLDOWN — a ticker that appeared in the last N editions is demoted
 *      (ranked lower). A ticker with an unresolved (pending) outcome is demoted further.
 *
 *   2. LOSS-STREAK HALT — a ticker that stopped out in K+ of its last M appearances is
 *      hard-cut. Don't keep recommending a loser.
 *
 *   3. CROSS-EDITION SECTOR CAP — rolling sector concentration: if a sector already has N
 *      plays across the recent edition window, further plays in that sector are demoted.
 *
 * Integration: called from edition-builder.ts between STAGE 4 (ranking) and STAGE 5
 * (synthesis). The governor re-orders and filters the ranked list — it never adds plays.
 * Cut candidates flow into the existing rejection audit trail.
 */

import type { ScoredCandidate } from "./scorer";

// ── Configuration ────────────────────────────────────────────────────────────

/** How many prior editions the governor looks back. */
export const GOV_LOOKBACK_EDITIONS = 3;

/** A ticker that appeared in the last N editions gets its score penalized by this many points
 *  PER recent appearance. Soft demotion — it can still make the cut if it scores high enough. */
export const GOV_REPEAT_PENALTY_PER_APPEARANCE = 5;

/** A ticker with an unresolved (pending) outcome from a prior edition — we're still waiting
 *  to see how the last recommendation played out. Extra penalty on top of the repeat penalty. */
export const GOV_PENDING_EXTRA_PENALTY = 5;

/** If a ticker stopped out in this many of its last GOV_LOOKBACK_EDITIONS appearances, hard-cut. */
export const GOV_LOSS_STREAK_HALT_THRESHOLD = 2;

/** Rolling sector cap: max plays from the same sector across the lookback window PLUS tonight's
 *  edition. The within-edition cap (SECTOR_CONCENTRATION_MAX_PER_SECTOR = 2) still applies
 *  downstream; this is the cross-edition layer. */
export const GOV_CROSS_EDITION_SECTOR_CAP = 4;

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape of a recent play outcome row — only the fields the governor reads. */
export type RecentOutcomeRow = {
  edition_for: string;
  ticker: string;
  direction: string | null;
  outcome: string | null;
  sector: string | null;
};

export type GovernorAction =
  | { type: "pass" }
  | { type: "demote"; penalty: number; reasons: string[] }
  | { type: "cut"; reasons: string[] };

export type GovernorResult = {
  /** Re-ranked candidates after governor penalties/cuts. */
  ranked: ScoredCandidate[];
  /** Candidates hard-cut by the governor, with reasons. */
  cut: Array<{ ticker: string; scored: ScoredCandidate; reasons: string[] }>;
  /** Candidates demoted (penalty applied to effective score for sorting). */
  demoted: Array<{ ticker: string; penalty: number; reasons: string[] }>;
  /** Governor notes for the edition meta / funnel log. */
  notes: string[];
};

// ── Core evaluation (pure) ───────────────────────────────────────────────────

/** Evaluate the governor rules for a single candidate. Pure function of the candidate + history. */
export function evaluateGovernor(
  candidate: ScoredCandidate,
  recentOutcomes: RecentOutcomeRow[],
  recentSectorCounts: Map<string, number>
): GovernorAction {
  const ticker = candidate.ticker.toUpperCase();
  const myOutcomes = recentOutcomes.filter(
    (r) => r.ticker.toUpperCase() === ticker
  );

  const reasons: string[] = [];
  let penalty = 0;
  let cut = false;

  // RULE 1: Repeat-ticker cooldown
  if (myOutcomes.length > 0) {
    penalty += GOV_REPEAT_PENALTY_PER_APPEARANCE * myOutcomes.length;
    reasons.push(
      `repeat-ticker: ${myOutcomes.length} appearance(s) in last ${GOV_LOOKBACK_EDITIONS} editions (−${GOV_REPEAT_PENALTY_PER_APPEARANCE * myOutcomes.length})`
    );

    const pending = myOutcomes.filter((r) => r.outcome === "pending");
    if (pending.length > 0) {
      penalty += GOV_PENDING_EXTRA_PENALTY;
      reasons.push(
        `pending-outcome: ${pending.length} unresolved play(s) still open (−${GOV_PENDING_EXTRA_PENALTY})`
      );
    }
  }

  // RULE 2: Loss-streak halt
  const stops = myOutcomes.filter((r) => r.outcome === "stop");
  if (stops.length >= GOV_LOSS_STREAK_HALT_THRESHOLD) {
    cut = true;
    reasons.push(
      `loss-streak-halt: ${stops.length} stop(s) in last ${GOV_LOOKBACK_EDITIONS} editions (threshold ${GOV_LOSS_STREAK_HALT_THRESHOLD})`
    );
  }

  // RULE 3: Cross-edition sector cap
  const sector = candidate.sector?.toLowerCase() ?? null;
  if (sector && recentSectorCounts.has(sector)) {
    const sectorTotal = recentSectorCounts.get(sector)!;
    if (sectorTotal >= GOV_CROSS_EDITION_SECTOR_CAP) {
      penalty += 10;
      reasons.push(
        `cross-edition-sector-cap: ${sector} has ${sectorTotal} plays in last ${GOV_LOOKBACK_EDITIONS} editions (cap ${GOV_CROSS_EDITION_SECTOR_CAP}, −10)`
      );
    }
  }

  if (cut) return { type: "cut", reasons };
  if (penalty > 0) return { type: "demote", penalty, reasons };
  return { type: "pass" };
}

/** Build sector counts from recent outcomes. */
export function buildSectorCounts(
  recentOutcomes: RecentOutcomeRow[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of recentOutcomes) {
    const sector = r.sector?.toLowerCase();
    if (sector) counts.set(sector, (counts.get(sector) ?? 0) + 1);
  }
  return counts;
}

/**
 * Apply the cross-edition governor to the ranked candidate list.
 *
 * 1. Evaluates each candidate against the recent outcome history.
 * 2. Hard-cuts candidates that hit the loss-streak halt.
 * 3. Applies score penalties to repeat/sector-heavy candidates and re-sorts.
 * 4. Returns the re-ranked list + cut/demoted audit data.
 */
export function applyCrossEditionGovernor(
  ranked: ScoredCandidate[],
  recentOutcomes: RecentOutcomeRow[]
): GovernorResult {
  const sectorCounts = buildSectorCounts(recentOutcomes);
  const notes: string[] = [];
  const cutList: GovernorResult["cut"] = [];
  const demotedList: GovernorResult["demoted"] = [];

  type Adjusted = { scored: ScoredCandidate; effectiveScore: number };
  const survivors: Adjusted[] = [];

  for (const candidate of ranked) {
    const action = evaluateGovernor(candidate, recentOutcomes, sectorCounts);

    switch (action.type) {
      case "cut":
        cutList.push({ ticker: candidate.ticker, scored: candidate, reasons: action.reasons });
        notes.push(`GOV CUT ${candidate.ticker}: ${action.reasons.join("; ")}`);
        break;
      case "demote": {
        demotedList.push({ ticker: candidate.ticker, penalty: action.penalty, reasons: action.reasons });
        notes.push(`GOV DEMOTE ${candidate.ticker} −${action.penalty}: ${action.reasons.join("; ")}`);
        survivors.push({ scored: candidate, effectiveScore: candidate.score - action.penalty });
        break;
      }
      case "pass":
        survivors.push({ scored: candidate, effectiveScore: candidate.score });
        break;
    }
  }

  // Re-sort by effective score (governor-adjusted), preserving the original score on the candidate.
  survivors.sort((a, b) => b.effectiveScore - a.effectiveScore);

  if (cutList.length || demotedList.length) {
    notes.unshift(
      `[cross-edition-governor] ${ranked.length} candidates → ${survivors.length} survivors (${cutList.length} cut, ${demotedList.length} demoted)`
    );
  }

  return {
    ranked: survivors.map((s) => s.scored),
    cut: cutList,
    demoted: demotedList,
    notes,
  };
}
