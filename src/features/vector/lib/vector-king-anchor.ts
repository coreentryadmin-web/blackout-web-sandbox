import type { VectorWalls } from "@/lib/api";

/**
 * The "king" anchor strikes — the dominant call wall and put wall the chart marks with a persistent
 * anchor line (member ask: "mark the King node / anchor on the chart"). The walls handed in are
 * already the HORIZON-SCOPED set the chart draws (`liveGexWalls()` — 0DTE / weekly / monthly / all),
 * ranked strongest-first by `computeGexWalls`, so the anchor re-scopes with the DTE toggle for free
 * (different horizon → different dominant strike → anchor moves).
 *
 * TIMEFRAME awareness (member ask: "dynamic based on both tf and dte"): without a band the king is
 * just the global top-ranked strike, which is TF-invariant (zooming the candles doesn't change which
 * strike holds the most gamma). With a `{spot, bandPct}` context — `bandPct` scaling UP with the
 * candle timeframe — the anchor is the strongest wall WITHIN that spot-relative band: a tight 1m view
 * anchors to the nearest strong wall in view, and a wide 4h view lets a bigger further-out wall
 * become the anchor. When no wall on a side falls inside the band (all walls far, tight zoom) it
 * falls back to the NEAREST wall on that side so the anchor stays relevant to what's on screen.
 *
 * Pure + dependency-light so the selection is unit-tested away from the imperative price-line draw.
 */
export type KingAnchors = { call: number | null; put: number | null };

export type KingAnchorOpts = {
  /** Live spot — required (with bandPct) to make the anchor timeframe-aware. */
  spot?: number | null;
  /** Half-width of the "in view" strike band as a fraction of spot; scales up with the timeframe. */
  bandPct?: number;
};

/**
 * The dominant strike on ONE ranked side. Global king (first finite/positive) when there's no band
 * context; otherwise the strongest wall within `spot·bandPct` of spot, falling back to the nearest
 * wall on that side when none is in-band.
 */
function pickSideKing(
  levels: ReadonlyArray<{ strike: number }> | undefined | null,
  opts?: KingAnchorOpts
): number | null {
  const clean = (levels ?? []).filter((l) => Number.isFinite(l.strike) && l.strike > 0);
  if (clean.length === 0) return null;
  const spot = opts?.spot;
  const bandPct = opts?.bandPct;
  // No band context → the original behaviour: the global strongest strike (top-ranked).
  if (!(spot != null && spot > 0 && bandPct != null && bandPct > 0)) return clean[0]!.strike;
  const band = spot * bandPct;
  // Walls are strength-ranked, so the FIRST one inside the band is the strongest in view.
  const inBand = clean.find((l) => Math.abs(l.strike - spot) <= band);
  if (inBand) return inBand.strike;
  // Nothing in the (tight) band → anchor to the nearest wall so the line stays on-screen-relevant.
  let nearest = clean[0]!;
  for (const l of clean) {
    if (Math.abs(l.strike - spot) < Math.abs(nearest.strike - spot)) nearest = l;
  }
  return nearest.strike;
}

export function pickKingStrikes(
  walls: VectorWalls | null | undefined,
  opts?: KingAnchorOpts
): KingAnchors {
  return {
    call: pickSideKing(walls?.callWalls, opts),
    put: pickSideKing(walls?.putWalls, opts),
  };
}

/** Short anchor line title, e.g. `⚓ 750`. Colour (gold call / purple put) conveys the side. */
export function kingAnchorTitle(strike: number): string {
  return `⚓ ${Math.round(strike).toLocaleString("en-US")}`;
}
