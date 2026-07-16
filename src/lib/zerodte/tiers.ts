// 0DTE merit-tier engine core (PR-F phase 1) — rank plays A/B/C at commit time from
// the SAME pinned evidence the calibration loop grades, with the product's honesty
// spine built into the type system: **advertised performance is EARNED from the
// record, never asserted.**
//
// The three hard rules, in order of importance:
//
// 1. **A+ IS NOT ASSIGNABLE.** `ZeroDteTier` deliberately excludes it. A+ is a
//    DISPLAY promotion computed from the measured record of the "A" bucket
//    (analyzeTierRecord, ./calibration.ts, against TIER_APLUS_UNLOCK below) — the
//    entry-time function can never mint one. This is C-1 from the decision doc
//    (docs/audit/NIGHTHAWK-0DTE-DECISION.md): the top label was mis-calibrated on
//    all three surfaces independently (F-5: Slayer grade A+ → 25% WR vs A → 54.5%;
//    NH edition A+ → 0/1), so the top label must be re-earned from graded plays,
//    not re-asserted by a scorer that already proved it over-rewards the top.
//
// 2. **A HIGH RAW SCORE IS NOT A STRONG POSITIVE.** F-5 measured a top-band
//    INVERSION (Slayer score 85+ → 33.3% WR n=6 vs 75-84 → 63.6% n=11; observations
//    70+ → 45.1% n=125 vs 60-70 → 60.8% n=57 — the same shape three times,
//    independently). So W_SCORE_TOP == W_SCORE_MID: a mid-band score with clean
//    Cortex evidence outranks raw-score maximalism until the tier record
//    (analyzeTierRecord's inversion check) proves the top band has fixed itself.
//
// 3. **MISSING EVIDENCE DEGRADES, NEVER UPGRADES.** Every input is nullable
//    (pre-C-2 ledger rows carry no context at all); a null contributes zero points
//    AND caps the reachable tier — an evidence gap can keep a play out of "A", it
//    can never argue it in. Same fail-closed posture as the hard gates.
//
// Pure and deterministic throughout (same inputs → same tier + same factors); no
// clock, no IO, no imports that drag providers in. ./scan.ts (follow-up PR) will
// call assignZeroDteTier at commit with live inputs; ./calibration.ts and
// ./record.ts call tierFromEntryContext to tier PAST plays from their pinned
// entry_context blobs — which is what makes the record analysis able to grade the
// tier function retroactively on day one.

import { ZERODTE_SCORE_FLOOR, VIX_ELEVATED_THRESHOLD, VIX_EXTREME_THRESHOLD } from "./gates";

/** Assignable tiers, best → worst. "A+" is deliberately NOT here (rule 1 above)
 *  and "F" is not either — F is the skip pile (tierForSkip), never a ranking of a
 *  committed play. */
export type ZeroDteTier = "A" | "B" | "C";

/** What a pane may DISPLAY: assignable tiers, plus the earned "A+" promotion and
 *  the "F" skip pile. The gap between this type and ZeroDteTier IS the honesty
 *  model — display can promote to A+ only via the measured record (displayTierFor),
 *  and only skips are ever F. */
export type ZeroDteDisplayTier = "A+" | ZeroDteTier | "F";

/** One human-readable reason the tier is what it is — the pane's "WHY is this a B"
 *  chips render these verbatim. direction "up" = argued the tier up, "down" =
 *  dragged or capped it. */
export type TierFactor = {
  label: string;
  direction: "up" | "down";
  detail: string;
};

export type ZeroDteTierAssignment = {
  tier: ZeroDteTier;
  factors: TierFactor[];
};

/** The pinned entry evidence the tier function ranks on. ALL nullable — a missing
 *  field is an evidence gap (pre-C-2 row, provider outage at commit, Cortex never
 *  ran), and evidence gaps degrade (rule 3), never upgrade. */
export type ZeroDteTierInput = {
  /** Commit-time score (entry_context.score — NOT the ratcheted score_max). */
  score: number | null;
  /** G-3 floor the score was judged against. Null = use today's ZERODTE_SCORE_FLOOR
   *  (a config default, not an evidence gap — it never caps the tier). */
  scoreFloor: number | null;
  /** Cortex net evidence score (entry_context.cortex.score). Null = Cortex
   *  abstained or never ran — an evidence gap. */
  cortexScore: number | null;
  cortexVetoCount: number | null;
  cortexSupportCount: number | null;
  /** Day-open I:VIX (entry_context.vix_open). */
  vixOpen: number | null;
  /** ET minutes since midnight at commit (from committed_at_et). */
  committedEtMinutes: number | null;
};

// ── A+ unlock — the honesty spine ────────────────────────────────────────────────
/**
 * A+ becomes displayable ONLY when the measured record of the "A" bucket clears
 * this bar: at least `minGraded` GRADED A-tier plays at `minWinRatePct`+ win rate
 * (plan-outcome grades, record.ts methodology). Computed by analyzeTierRecord
 * (./calibration.ts) — NEVER by assignZeroDteTier, whose output type cannot even
 * express "A+". minGraded matches ENFORCE_MIN_BLOCK_N's rationale (the F-1 priors
 * were n=12/13 and we refused to enforce on them; a headline label needs at least
 * that order of evidence); 80% is far above every measured bucket in the forensics
 * dataset (best real bucket: 69.2%) — the top label is supposed to be HARD to earn.
 */
export const TIER_APLUS_UNLOCK = { minGraded: 10, minWinRatePct: 80 } as const;

/**
 * The one place display promotion happens — the follow-up pane wiring is
 * `displayTierFor(play.tier, report.tier_record.aplus.unlocked)`. "A+" iff the play
 * is tier A AND the A bucket's measured record has unlocked it; everything else
 * displays as assigned.
 */
export function displayTierFor(tier: ZeroDteTier, aplusUnlocked: boolean): ZeroDteDisplayTier {
  return tier === "A" && aplusUnlocked ? "A+" : tier;
}

// ── Factor weights (points) — every number cites its forensic prior ─────────────
/** F-1: day-open VIX 15-17 ran 69.2% WR (9W/4L, n=13, avg +1.85 pts) — the single
 *  strongest split in the dataset. A genuine positive factor, and the only +2 a
 *  play can get without Cortex evidence. */
export const W_VIX_CALM = 2;
/** F-1's other half: VIX 17-20 ran 25.0% WR (3W/9L, n=12, avg −1.54 pts). Same
 *  engine, same fortnight, opposite outcome — the mirror penalty. */
export const W_VIX_ELEVATED = -2;
/** VIX ≥ 20 is beyond the measured range entirely; hardened G-4 would block single
 *  names outright. Worse than elevated because there is not even a prior that a
 *  play survives it. */
export const W_VIX_EXTREME = -3;
/** F-1's calm-band lower edge. Below 15 there is NO measured prior either way —
 *  sub-15 days contribute zero points (evidence present, edge unproven). */
export const VIX_CALM_MIN = 15;

/** Score 75-84: the best measured score band (F-5 surface: 63.6% WR n=11; F-2's
 *  75+ bucket ran 50%/+9.9%). The strongest score signal we have. */
export const W_SCORE_PRIME = 2;
/** Score 65-74 (floor..75): 50% WR, +21.1% avg premium (n=10, F-2) — solidly
 *  positive-expectancy under the −50/+100 payoff, but not the prime band. */
export const W_SCORE_MID = 1;
/** Score 85+: DELIBERATELY equal to W_SCORE_MID, not above W_SCORE_PRIME — the
 *  measured top-band inversion (F-5: 85+ → 33.3% vs 75-84 → 63.6%; the scorers
 *  over-reward crowded/late/obvious setups at the top). Raw-score maximalism gets
 *  no extra credit until analyzeTierRecord's inversion check proves it earned it. */
export const W_SCORE_TOP = 1;
/** Below the G-3 floor (retro/pre-gate rows only — G-3 blocks these live): the
 *  55-64 band ran 18.8% WR / −24.5% avg (n=16, F-2), under the 33% breakeven. */
export const W_SCORE_BELOW_FLOOR = -2;
/** Lower edge of the prime score band (F-2/F-5 band edges, same cut as
 *  calibration.ts's CALIBRATION_SCORE_BANDS). */
export const SCORE_PRIME_MIN = 75;
/** Top-band edge where the F-5 inversion starts. */
export const SCORE_TOP_MIN = 85;

/** Cortex net-positive with ≥2 supporting sources: "clean Cortex evidence" — the
 *  multi-source corroboration the whole Cortex design exists to produce, and the
 *  factor that lets a mid-band score outrank a raw 85+ (rule 2). */
export const W_CORTEX_CLEAN = 2;
/** Cortex net-positive on thinner support (one source). */
export const W_CORTEX_POSITIVE = 1;
/** Cortex net-negative: post-#318 this blocks the commit outright (NET_NEGATIVE);
 *  on retro rows it is a measured strike against the play. */
export const W_CORTEX_NEGATIVE = -2;
export const CORTEX_CLEAN_MIN_SUPPORTS = 2;

/** Committed before 11:00 ET: F-4 — the first ~hour is the weakest window on every
 *  surface with data (0DTE 9:50-11:00 → 36.8% WR n=19; hour-9 signals 36.1% n=147
 *  vs hour-14 60.5% n=126). The user kept the window OPEN (G-2 blocks only
 *  9:30-9:45), so the tier function is where the measured weakness gets priced. */
export const W_EARLY_WINDOW = -1;
export const EARLY_WINDOW_END_ET_MINUTES = 11 * 60;

// ── Tier bands over summed points ────────────────────────────────────────────────
/** "A" needs two independent strong positives (e.g. calm VIX + prime score, or
 *  prime score + clean Cortex) with nothing dragging — one good number is a B. */
export const TIER_A_MIN_POINTS = 4;
/** "B" needs the evidence to net positive at all; a wash or worse is a C. */
export const TIER_B_MIN_POINTS = 1;

const TIER_RANK: Record<ZeroDteTier, number> = { A: 2, B: 1, C: 0 };

/** worse(tier, cap) — clamp helper so evidence gaps/vetoes can only pull DOWN. */
function capTier(tier: ZeroDteTier, cap: ZeroDteTier): ZeroDteTier {
  return TIER_RANK[cap] < TIER_RANK[tier] ? cap : tier;
}

/**
 * Assign the merit tier for ONE play from its pinned entry evidence. Pure and
 * deterministic. The returned factors are the complete argument for the tier —
 * every point and every cap shows up as a chip-renderable line.
 */
export function assignZeroDteTier(input: ZeroDteTierInput): ZeroDteTierAssignment {
  const factors: TierFactor[] = [];
  let points = 0;
  /** Best tier this play can still reach — evidence gaps and vetoes lower it. */
  let ceiling: ZeroDteTier = "A";

  // ── Score band (rule 2: the top band is deliberately discounted) ──────────────
  const floor = input.scoreFloor ?? ZERODTE_SCORE_FLOOR;
  if (input.score == null) {
    // No committed score = no basis to rank at all — hard cap at C, the same
    // "cannot see → worst honest answer" posture as the gates' fail-closed rule.
    ceiling = capTier(ceiling, "C");
    factors.push({
      label: "Score missing",
      direction: "down",
      detail: "No commit-time score pinned — unrankable evidence caps the tier at C.",
    });
  } else if (input.score < floor) {
    points += W_SCORE_BELOW_FLOOR;
    factors.push({
      label: "Score below floor",
      direction: "down",
      detail: `Score ${Math.round(input.score)} is under the ${floor} floor — the 55-64 band ran 18.8% WR (n=16, F-2).`,
    });
  } else if (input.score >= SCORE_TOP_MIN) {
    points += W_SCORE_TOP;
    // F-5 inversion: 85+ ran 33.3% vs 63.6% at 75-84 — the top band is where the
    // money dies. Beyond discounting the weight, cap the reachable tier at B: a raw
    // score extreme cannot earn A regardless of how many other factors align.
    ceiling = capTier(ceiling, "B");
    factors.push({
      label: "Score 85+ (discounted)",
      direction: "up",
      detail:
        `Score ${Math.round(input.score)} counts only as a mid-band positive — the measured top-band ` +
        "inversion (85+ ran 33.3% WR vs 63.6% at 75-84, F-5) means raw-score maximalism is not earned credit.",
    });
    factors.push({
      label: "Score 85+ tier cap",
      direction: "down",
      detail:
        "Score ≥85 also caps the tier at B — A-tier must come through the 75-84 prime band " +
        "where the evidence says quality is, not through raw-score maximalism.",
    });
  } else if (input.score >= SCORE_PRIME_MIN) {
    points += W_SCORE_PRIME;
    factors.push({
      label: "Prime score band",
      direction: "up",
      detail: `Score ${Math.round(input.score)} sits in 75-84 — the best measured band (63.6% WR n=11, F-5 surface).`,
    });
  } else {
    points += W_SCORE_MID;
    factors.push({
      label: "Mid score band",
      direction: "up",
      detail: `Score ${Math.round(input.score)} in 65-74 — positive expectancy on the record (50% WR, +21.1% avg, n=10, F-2).`,
    });
  }

  // ── VIX regime (F-1, the strongest split in the dataset) ──────────────────────
  if (input.vixOpen == null) {
    ceiling = capTier(ceiling, "B");
    factors.push({
      label: "VIX unknown",
      direction: "down",
      detail: "Day-open VIX was not pinned — the strongest measured factor (F-1) is unverifiable, so A is out of reach.",
    });
  } else if (input.vixOpen >= VIX_EXTREME_THRESHOLD) {
    points += W_VIX_EXTREME;
    factors.push({
      label: "VIX extreme",
      direction: "down",
      detail: `Day-open VIX ${input.vixOpen} ≥ ${VIX_EXTREME_THRESHOLD} — beyond the measured range; hardened G-4 would block single names here.`,
    });
  } else if (input.vixOpen >= VIX_ELEVATED_THRESHOLD) {
    points += W_VIX_ELEVATED;
    factors.push({
      label: "VIX elevated",
      direction: "down",
      detail: `Day-open VIX ${input.vixOpen} in 17-20 — the regime that ran 25.0% WR (n=12, F-1).`,
    });
  } else if (input.vixOpen >= VIX_CALM_MIN) {
    points += W_VIX_CALM;
    factors.push({
      label: "VIX calm band",
      direction: "up",
      detail: `Day-open VIX ${input.vixOpen} in 15-17 — the 69.2% WR regime (n=13, F-1), the strongest positive on record.`,
    });
  }
  // vixOpen < 15: evidence present, no measured edge either way — zero points, no factor.

  // ── Cortex evidence (what lets a mid-band score outrank a raw 85+) ────────────
  const vetoes = input.cortexVetoCount ?? 0;
  if (vetoes > 0) {
    // A vetoed setup should never have committed post-#318 — but retro rows and
    // future policy drift both exist, and a standing veto is disqualifying for
    // any advertised quality above C regardless of what else looked good.
    ceiling = capTier(ceiling, "C");
    factors.push({
      label: "Cortex veto",
      direction: "down",
      detail: `${vetoes} standing Cortex veto${vetoes > 1 ? "es" : ""} — a vetoed setup is capped at C, whatever else aligned.`,
    });
  }
  if (input.cortexScore == null) {
    ceiling = capTier(ceiling, "B");
    factors.push({
      label: "Cortex evidence missing",
      direction: "down",
      detail: "Cortex abstained or never ran — no corroborating evidence vector, so A is out of reach (gaps degrade, never upgrade).",
    });
  } else if (input.cortexScore > 0) {
    const supports = input.cortexSupportCount ?? 0;
    const clean = supports >= CORTEX_CLEAN_MIN_SUPPORTS;
    points += clean ? W_CORTEX_CLEAN : W_CORTEX_POSITIVE;
    factors.push({
      label: clean ? "Clean Cortex support" : "Cortex positive",
      direction: "up",
      detail: clean
        ? `Cortex nets +${input.cortexScore} on ${supports} supporting sources — multi-source corroboration.`
        : `Cortex nets +${input.cortexScore} on thin support (${supports} source${supports === 1 ? "" : "s"}).`,
    });
  } else if (input.cortexScore < 0) {
    points += W_CORTEX_NEGATIVE;
    factors.push({
      label: "Cortex net-negative",
      direction: "down",
      detail: `Cortex evidence nets ${input.cortexScore} against the play — post-#318 this blocks the commit outright.`,
    });
  }
  // cortexScore === 0: sources answered and exactly cancelled — a wash, zero points.

  // ── Entry window (F-4) ─────────────────────────────────────────────────────────
  if (input.committedEtMinutes == null) {
    ceiling = capTier(ceiling, "B");
    factors.push({
      label: "Commit time missing",
      direction: "down",
      detail: "No pinned commit time — the F-4 window weakness is unverifiable, so A is out of reach.",
    });
  } else if (input.committedEtMinutes < EARLY_WINDOW_END_ET_MINUTES) {
    points += W_EARLY_WINDOW;
    factors.push({
      label: "Early window",
      direction: "down",
      detail:
        "Committed before 11:00 ET — the weakest measured window on every surface (9:50-11:00 ran 36.8% WR n=19, F-4). " +
        "The window stays open by user direction; the tier prices it instead.",
    });
  }

  const base: ZeroDteTier =
    points >= TIER_A_MIN_POINTS ? "A" : points >= TIER_B_MIN_POINTS ? "B" : "C";
  return { tier: capTier(base, ceiling), factors };
}

// ── F — the skip pile ────────────────────────────────────────────────────────────
/**
 * F is not a ranking; it is the DEFINITION of a blocked/vetoed setup. The future
 * pane wiring renders SKIP/WATCH cards with `tierForSkip(setup.gate.blocks)` so the
 * chip carries the same {label, direction, detail} shape as ranked plays — every
 * failing gate/veto becomes a "down" factor, verbatim from the gate's own sentence.
 */
export function tierForSkip(
  blocks?: ReadonlyArray<{ code: string; reason: string }> | null
): { tier: "F"; factors: TierFactor[] } {
  const list = blocks ?? [];
  if (list.length === 0) {
    return {
      tier: "F",
      factors: [
        {
          label: "Blocked",
          direction: "down",
          detail: "Setup was blocked at the gates — skips are tier F by definition.",
        },
      ],
    };
  }
  return {
    tier: "F",
    factors: list.map((b) => ({ label: b.code, direction: "down" as const, detail: b.reason })),
  };
}

// ── Retroactive tiering off the pinned entry_context blob ─────────────────────────
/**
 * Adapt an ALREADY-PINNED entry_context blob (entry-context.ts's ZeroDteEntryContext,
 * read back as raw JSONB) into the tier input, so past graded plays are tierable
 * TODAY — no backfill, no re-derivation. Defensive throughout: any malformed field
 * degrades to null (and null-degradation then applies, rule 3).
 *
 * Returns null when there is no blob at all (rows committed before the C-2 column):
 * with ZERO pinned evidence a "C" would be a statement about missing data, not
 * about the play — the record analysis counts these as untiered instead.
 *
 * Fields the blob CANNOT recover (documented, not guessed):
 * - scoreFloor: the floor at COMMIT time is not pinned anywhere (entry_context nor
 *   gate_calibration_json carry it). G-3's floor has been 65 since it shipped, so
 *   today's ZERODTE_SCORE_FLOOR is exact for every existing row; if the floor ever
 *   moves, rows committed before the move will be judged against the new floor
 *   until a floor-at-commit pin ships.
 * - spy_bias / gamma_regime are pinned but deliberately NOT scored: G-1 hard-blocks
 *   counter-tape commits, so alignment is a precondition of every committed row
 *   (no ranking variance left), and gamma regime has no measured prior yet.
 */
export function tierFromEntryContext(
  entryContext: Record<string, unknown> | null | undefined
): ZeroDteTierAssignment | null {
  if (entryContext == null || typeof entryContext !== "object") return null;
  const ctx = entryContext as Record<string, unknown>;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  // Cortex blob: {abstained:true,...} or the full evidence vector. Abstained (or
  // absent, or malformed) → all-null cortex inputs → the missing-evidence cap.
  let cortexScore: number | null = null;
  let cortexVetoCount: number | null = null;
  let cortexSupportCount: number | null = null;
  const cortex = ctx.cortex;
  if (cortex != null && typeof cortex === "object" && (cortex as Record<string, unknown>).abstained === false) {
    const c = cortex as Record<string, unknown>;
    cortexScore = num(c.score);
    cortexVetoCount = Array.isArray(c.vetoes) ? c.vetoes.length : null;
    cortexSupportCount = Array.isArray(c.supports) ? c.supports.length : null;
  }

  // committed_at_et is "YYYY-MM-DD HH:mm ET" (entry-context.ts formatEtStamp) —
  // parse the trailing clock; anything else (malformed, truncated) degrades to null.
  let committedEtMinutes: number | null = null;
  if (typeof ctx.committed_at_et === "string") {
    const m = /\b(\d{1,2}):(\d{2}) ET$/.exec(ctx.committed_at_et);
    if (m) committedEtMinutes = Number(m[1]) * 60 + Number(m[2]);
  }

  return assignZeroDteTier({
    score: num(ctx.score),
    scoreFloor: null, // → today's ZERODTE_SCORE_FLOOR; see the doc comment above.
    cortexScore,
    cortexVetoCount,
    cortexSupportCount,
    vixOpen: num(ctx.vix_open),
    committedEtMinutes,
  });
}
