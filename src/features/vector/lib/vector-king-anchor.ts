import type { VectorWalls } from "@/lib/api";

/**
 * The "king" anchor strikes — the single dominant call wall and put wall the chart marks with a
 * persistent anchor line (member ask: "mark the King node / anchor on the chart"). Because the
 * walls handed in are already the HORIZON-SCOPED set the chart draws (`liveGexWalls()` — 0DTE /
 * weekly / monthly / all), and are ranked strongest-first by `computeGexWalls`, the king is simply
 * the top-ranked strike per side. That makes the anchor re-scope automatically with the DTE toggle
 * (a different horizon → a different dominant strike → the anchor moves) and stay put across chart
 * timeframes (the dominant strike doesn't change when you zoom the candles).
 *
 * Pure + dependency-light so the selection is unit-tested away from the imperative price-line draw.
 */
export type KingAnchors = { call: number | null; put: number | null };

/** First finite, positive strike on a ranked side, or null. */
function topStrike(levels: ReadonlyArray<{ strike: number }> | undefined | null): number | null {
  if (!levels) return null;
  for (const l of levels) {
    if (Number.isFinite(l.strike) && l.strike > 0) return l.strike;
  }
  return null;
}

export function pickKingStrikes(walls: VectorWalls | null | undefined): KingAnchors {
  return {
    call: topStrike(walls?.callWalls),
    put: topStrike(walls?.putWalls),
  };
}

/** Short anchor line title, e.g. `⚓ 750`. Colour (gold call / purple put) conveys the side. */
export function kingAnchorTitle(strike: number): string {
  return `⚓ ${Math.round(strike).toLocaleString("en-US")}`;
}
