import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";

export type VectorDarkPoolLevel = { strike: number; premium: number; pct: number };

const MAX_LEVELS = 6;

/** Map SPY-scale prints to SPX chart coordinates (~10×). */
export function spxStrikeFromDarkPoolPrint(strike: number): number | null {
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (strike >= 1000) return Math.round(strike);
  return Math.round(strike * 10);
}

/** Top institutional dark-pool strike levels for the chart overlay. */
export function darkPoolLevelsFromSnapshot(
  snapshot: DarkPoolSnapshot | null | undefined,
  opts: { scale?: "native" | "spx-from-spy" } = {}
): VectorDarkPoolLevel[] {
  const scale = opts.scale ?? "spx-from-spy";
  if (!snapshot?.prints?.length) return [];

  const byStrike = new Map<number, number>();
  for (const print of snapshot.prints) {
    const strike =
      scale === "spx-from-spy" ? spxStrikeFromDarkPoolPrint(print.strike) : Math.round(print.strike);
    const premium = Number(print.premium);
    if (strike == null || !Number.isFinite(strike) || strike <= 0) continue;
    if (!Number.isFinite(premium) || premium <= 0) continue;
    byStrike.set(strike, (byStrike.get(strike) ?? 0) + premium);
  }

  const total = [...byStrike.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];

  return [...byStrike.entries()]
    .map(([strike, premium]) => ({
      strike,
      premium,
      pct: (premium / total) * 100,
    }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, MAX_LEVELS);
}
