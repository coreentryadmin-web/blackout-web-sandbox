import type { GexWalls } from "@/lib/providers/gex-wall-levels";

/**
 * Wall-proximity intelligence — turns the static walls into a live "what matters
 * right now" read. When spot approaches a major GEX wall (or the gamma flip),
 * that level is the one the member should be watching: in long gamma a wall is a
 * magnet/resistance dealers defend; the gamma flip is the regime hinge. This
 * derives the single nearest significant level within a proximity band and a
 * plain-English callout for it — the dynamic pulse of the desk terminal.
 *
 * Pure + Date-free → deterministic and unit-testable.
 */

export type WallProximitySide = "call" | "put" | "flip";

export type WallProximity = {
  strike: number;
  side: WallProximitySide;
  /** Signed distance as a % of spot: positive = level is above spot. */
  distancePct: number;
  /** How close: within a third of the band = "at", within two thirds = "testing", else "near". */
  nearness: "near" | "testing" | "at";
  callout: string;
};

const DEFAULT_BAND_PCT = 0.5;

function absPct(spot: number, strike: number): number {
  return (Math.abs(strike - spot) / spot) * 100;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Nearest significant level to spot within `bandPct`, or null when spot is in
 * open space (no level close enough to matter). Considers the top call wall, top
 * put wall, and the gamma flip; picks whichever is closest.
 */
export function deriveWallProximity(input: {
  spot: number | null | undefined;
  walls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  bandPct?: number;
}): WallProximity | null {
  const { spot, walls, gammaFlip } = input;
  const band = input.bandPct ?? DEFAULT_BAND_PCT;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;

  const candidates: Array<{ strike: number; side: WallProximitySide }> = [];
  const call = walls?.callWalls?.[0]?.strike;
  const put = walls?.putWalls?.[0]?.strike;
  if (call != null && Number.isFinite(call)) candidates.push({ strike: call, side: "call" });
  if (put != null && Number.isFinite(put)) candidates.push({ strike: put, side: "put" });
  if (gammaFlip != null && Number.isFinite(gammaFlip) && gammaFlip > 0)
    candidates.push({ strike: gammaFlip, side: "flip" });

  let best: { strike: number; side: WallProximitySide; dist: number } | null = null;
  for (const c of candidates) {
    const dist = absPct(spot, c.strike);
    if (dist > band) continue;
    if (!best || dist < best.dist) best = { ...c, dist };
  }
  if (!best) return null;

  const signed = ((best.strike - spot) / spot) * 100;
  const nearness = best.dist <= band / 3 ? "at" : best.dist <= (band * 2) / 3 ? "testing" : "near";
  const above = signed >= 0;

  let callout: string;
  if (best.side === "flip") {
    callout = `${fmt(best.strike)} gamma flip ${above ? "overhead" : "below"} (${best.dist.toFixed(2)}% away) — a cross flips the regime; expect the sharpest moves here.`;
  } else if (best.side === "call") {
    callout = above
      ? `Testing ${fmt(best.strike)} call wall (${best.dist.toFixed(2)}% below) — dealers sell into strength; resistance unless it breaks on volume.`
      : `Back under the ${fmt(best.strike)} call wall (${best.dist.toFixed(2)}% away) — lost magnet, watch for fade.`;
  } else {
    callout = !above
      ? `Testing ${fmt(best.strike)} put wall (${best.dist.toFixed(2)}% above) — dealers buy weakness; support unless it breaks on volume.`
      : `Just over the ${fmt(best.strike)} put wall (${best.dist.toFixed(2)}% away) — reclaimed support, dip-buy zone.`;
  }

  return { strike: best.strike, side: best.side, distancePct: signed, nearness, callout };
}
