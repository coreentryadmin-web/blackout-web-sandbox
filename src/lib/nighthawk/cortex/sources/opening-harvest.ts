// CORTEX SOURCE: opening harvest 9:30–9:45 ET — the restriction turned into alpha.
// docs/audit/0DTE-BREAKTHROUGH-LEDGER.md B-2: the user cut the opening block to the
// first 15 minutes; instead of idling there, HARVEST the window — overnight gap
// (direction + size as a fraction of expected move), gap-and-go vs gap-fade shape
// (did price extend beyond the open or reverse back through it), first-15m range
// vs EM, and internals (TICK/ADD) agreement. At the 9:45 unlock this is fresh,
// high-relevance evidence exactly when most plays are expected to fire; before
// 9:45 (window still forming) or without bars it is ABSENT, never guessed.
//
// One evidence item: supports when the play direction agrees with the harvested
// opening character, opposes when it fights it.

import type { CortexInputs, CortexOpeningBar, EvidenceItem } from "../types";
import { absentForMissingSlice, etMinutesOfDay, fmtNum, parseMs } from "./shared";

/** The harvest window: RTH minutes-of-day 9:30 (570) to 9:45 (585) ET — B-2's own
 *  boundary (the user's opening block, verbatim). Bars at/after 585 are the tape
 *  the play trades IN, not the opening character being harvested. */
export const OPENING_WINDOW_START_ET_MIN = 9 * 60 + 30;
export const OPENING_WINDOW_END_ET_MIN = 9 * 60 + 45;

/** The source only speaks once the window has CLOSED (now ≥ 9:45 ET): a half-formed
 *  opening shape is exactly the false signal the 9:30–9:45 block exists to avoid. */
export const OPENING_HARVEST_READY_ET_MIN = OPENING_WINDOW_END_ET_MIN;

/** A gap (or gapless opening drive) must clear 0.25× EM before it is a CHARACTER
 *  rather than noise — the same "meaningful fraction of the day's expected range"
 *  yardstick gex-walls uses for entry-support distance (0.25× EM). */
export const OPENING_MIN_MOVE_EM_FRAC = 0.25;

/** Raw weight 0.9 — deliberately just below the 1.0 structural gex-walls unit:
 *  B-2 calls this high-relevance evidence at the 9:45 unlock, but it is a single
 *  session-shape read, not dealer structure; it should never outvote the ladder. */
export const OPENING_HARVEST_WEIGHT = 0.9;

/** When BOTH internals (TICK and ADD) are present and BOTH disagree with the price
 *  character, the character is unconfirmed — half weight. Named (not computed) so
 *  the calibration loop can tune the confirmation discount independently. */
export const OPENING_UNCONFIRMED_WEIGHT = 0.45;

/** Per-source support cap (a single item is all this source emits). */
export const OPENING_HARVEST_SUPPORT_CAP = 0.9;

/** Half-life 35 min — the middle of B-2's "~30–40 min": opening character decays
 *  fast (by ~11:30 ET, 3 half-lives, it is absent — lunch tape owes the open nothing). */
export const OPENING_HARVEST_HALF_LIFE_SEC = 35 * 60;

export type OpeningCharacter = {
  /** The harvested tape direction ("bullish"/"bearish"). */
  bias: "bullish" | "bearish";
  /** Shape label for the detail sentence. */
  shape: "gap-and-go" | "gap-fade" | "opening drive";
  open: number;
  last: number;
  /** Signed gap in points (open − priorClose); null when priorClose was missing. */
  gapPts: number | null;
  /** First-15m high−low range in points. */
  rangePts: number;
};

/** In-window bars, ascending. Exported for the narrative guard test. */
export function openingWindowBars(bars: CortexOpeningBar[]): CortexOpeningBar[] {
  return bars
    .filter((b) => {
      if (!Number.isFinite(b.time)) return false;
      const etMin = etMinutesOfDay(b.time * 1000);
      return etMin >= OPENING_WINDOW_START_ET_MIN && etMin < OPENING_WINDOW_END_ET_MIN;
    })
    .sort((a, b) => a.time - b.time);
}

/**
 * PURE character classifier (exported for tests + the guard's derivation closure):
 *  - meaningful gap (|open − priorClose| ≥ 0.25× EM): price beyond the open in the
 *    gap direction by window end = GAP-AND-GO (character = gap direction); price
 *    back through the open into the gap = GAP-FADE (character = counter-gap).
 *  - no meaningful gap (or no priorClose): a first-15m net drive ≥ 0.25× EM sets an
 *    OPENING-DRIVE character in the drive direction.
 *  - anything else → null (flat/indeterminate open — absent, not guessed).
 */
export function classifyOpeningCharacter(
  bars: CortexOpeningBar[],
  priorClose: number | null,
  expectedMovePts: number
): OpeningCharacter | null {
  const win = openingWindowBars(bars);
  if (win.length === 0) return null;
  const open = win[0].open;
  const last = win[win.length - 1].close;
  if (!Number.isFinite(open) || !Number.isFinite(last)) return null;
  const rangePts = Math.max(...win.map((b) => b.high)) - Math.min(...win.map((b) => b.low));

  const gapPts = priorClose != null && Number.isFinite(priorClose) ? open - priorClose : null;
  const floor = expectedMovePts * OPENING_MIN_MOVE_EM_FRAC;

  if (gapPts != null && Math.abs(gapPts) >= floor) {
    const gapUp = gapPts > 0;
    if (last === open) return null; // dead-flat window vs its own open: indeterminate
    const extending = gapUp ? last > open : last < open;
    return {
      bias: extending ? (gapUp ? "bullish" : "bearish") : gapUp ? "bearish" : "bullish",
      shape: extending ? "gap-and-go" : "gap-fade",
      open,
      last,
      gapPts,
      rangePts,
    };
  }

  // Gapless (or unknown-gap) open: only a real drive is a character.
  const drivePts = last - open;
  if (Math.abs(drivePts) >= floor) {
    return {
      bias: drivePts > 0 ? "bullish" : "bearish",
      shape: "opening drive",
      open,
      last,
      gapPts,
      rangePts,
    };
  }
  return null;
}

export function deriveOpeningHarvestEvidence(input: CortexInputs): EvidenceItem[] {
  const { opening, direction, expectedMovePts: em } = input;
  if (!opening) return [absentForMissingSlice("opening-harvest", input, "no opening bars/internals read")];
  const nowMs = parseMs(input.now);
  if (nowMs == null) return [absentForMissingSlice("opening-harvest", input, "invalid now timestamp")];
  if (etMinutesOfDay(nowMs) < OPENING_HARVEST_READY_ET_MIN) {
    return [
      absentForMissingSlice("opening-harvest", input, "opening window still forming (before 9:45 ET) — harvest not ready"),
    ];
  }
  if (em == null || em <= 0) {
    return [absentForMissingSlice("opening-harvest", input, "no expected move to scale the opening character")];
  }
  const character = classifyOpeningCharacter(opening.bars, opening.priorClose, em);
  if (!character) {
    return [
      absentForMissingSlice(
        "opening-harvest",
        input,
        opening.bars.length === 0
          ? "no minute bars in the 9:30-9:45 ET window"
          : "flat/indeterminate opening — no character worth harvesting"
      ),
    ];
  }

  // Internals confirmation: sign agreement of TICK/ADD with the price character.
  // Only a UNANIMOUS disagreement (both present, both against) discounts the read —
  // a single missing/flat internal must not manufacture doubt.
  const wantSign = character.bias === "bullish" ? 1 : -1;
  const signals = [opening.tick, opening.add].filter((v): v is number => v != null && v !== 0);
  const disagreeAll = signals.length === 2 && signals.every((v) => Math.sign(v) !== wantSign);
  const agreeAny = signals.some((v) => Math.sign(v) === wantSign);
  const weight = disagreeAll ? OPENING_UNCONFIRMED_WEIGHT : OPENING_HARVEST_WEIGHT;

  const aligned = (direction === "long") === (character.bias === "bullish");
  const lastWindowBar = openingWindowBars(opening.bars).at(-1);
  const gapPhrase =
    character.gapPts != null
      ? `gap ${character.gapPts > 0 ? "up" : "down"} ${fmtNum(Math.abs(character.gapPts))} pts ` +
        `(${fmtNum(Math.abs(character.gapPts) / em)}x EM), then `
      : "";
  const internalsPhrase =
    signals.length === 0
      ? "internals unavailable"
      : disagreeAll
        ? `TICK/ADD disagree (${opening.tick != null ? fmtNum(opening.tick) : "n/a"} / ${opening.add != null ? fmtNum(opening.add) : "n/a"}) — unconfirmed, half weight`
        : `internals ${agreeAny ? "confirm" : "mixed"} (TICK ${opening.tick != null ? fmtNum(opening.tick) : "n/a"}, ADD ${opening.add != null ? fmtNum(opening.add) : "n/a"})`;

  return [
    {
      source: "opening-harvest",
      stance: aligned ? "supports" : "opposes",
      weight,
      halfLifeSec: OPENING_HARVEST_HALF_LIFE_SEC,
      // The claim is about the window that just closed — freshness anchors to the
      // last in-window bar, so the read decays from 9:45, not from fetch time.
      asOf: lastWindowBar ? new Date(lastWindowBar.time * 1000).toISOString() : opening.asOf,
      detail:
        `opening harvest: ${gapPhrase}${character.shape} from open ${fmtNum(character.open)} to ${fmtNum(character.last)} ` +
        `(${character.bias} character), first-15m range ${fmtNum(character.rangePts / em)}x EM; ${internalsPhrase} — ` +
        `${aligned ? "agrees with" : "fights"} the ${direction}.`,
    },
  ];
}
