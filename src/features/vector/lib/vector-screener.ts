import type { VectorUniverseRow } from "./vector-universe";

/**
 * Universe screener — turns the flat scanner table into a sortable/filterable
 * desk view so a member can ask "which names are about to flip regime?", "which
 * are most pinned?", "where's the vol-expansion risk?" instead of eyeballing 21
 * rows. Pure over the rows the scanner already loads — no new data.
 *
 * All derived metrics return null when the inputs are missing (a ticker whose
 * snapshot hasn't populated), and sorting always sends null-metric rows to the
 * BOTTOM regardless of direction — a name with no flip data must never rank as
 * "nearest to flip" just because null sorted small.
 */

export type ScreenerRegime = "above" | "below" | "unknown";
export type ScreenerSortKey = "flip-distance" | "wall-strength" | "ticker";
export type ScreenerRegimeFilter = "all" | "above" | "below";
export type ScreenerPreset = "all" | "nearest-flip" | "most-pinned" | "most-explosive";

/** Regime = spot vs gamma flip. Above → dealers hedge with the move (pin); below → against (momentum). */
export function screenerRegimeOf(row: VectorUniverseRow): ScreenerRegime {
  if (row.spot == null || row.gammaFlip == null || !(row.spot > 0)) return "unknown";
  return row.spot >= row.gammaFlip ? "above" : "below";
}

/** Signed distance from spot to the gamma flip, in % ((flip - spot)/spot). */
export function flipDistancePct(row: VectorUniverseRow): number | null {
  if (row.spot == null || row.gammaFlip == null || !(row.spot > 0)) return null;
  return ((row.gammaFlip - row.spot) / row.spot) * 100;
}

export function absFlipDistancePct(row: VectorUniverseRow): number | null {
  const d = flipDistancePct(row);
  return d == null ? null : Math.abs(d);
}

/** Strongest wall on either side (0–100 net-gamma share) — the row's structural conviction. */
export function wallStrength(row: VectorUniverseRow): number {
  return Math.max(row.topCallPct ?? 0, row.topPutPct ?? 0);
}

export type ScreenerOptions = {
  regime?: ScreenerRegimeFilter;
  sort?: ScreenerSortKey;
  dir?: "asc" | "desc";
  /** A preset overrides `regime`/`sort`/`dir` with a curated desk combo. */
  preset?: ScreenerPreset;
};

const PRESET_CONFIG: Record<
  Exclude<ScreenerPreset, "all">,
  { regime: ScreenerRegimeFilter; sort: ScreenerSortKey; dir: "asc" | "desc" }
> = {
  // About to change regime — the most actionable list. Nearest flip first.
  "nearest-flip": { regime: "all", sort: "flip-distance", dir: "asc" },
  // Strong walls while dealers are pinning — mean-revert candidates.
  "most-pinned": { regime: "above", sort: "wall-strength", dir: "desc" },
  // Below flip and close to it — dealers amplify, vol-expansion risk. Nearest flip first.
  "most-explosive": { regime: "below", sort: "flip-distance", dir: "asc" },
};

function metricFor(row: VectorUniverseRow, sort: ScreenerSortKey): number | string | null {
  switch (sort) {
    case "flip-distance":
      return absFlipDistancePct(row);
    case "wall-strength":
      return wallStrength(row);
    case "ticker":
      return row.ticker;
  }
}

/** Filter by regime, then sort — null-metric rows always land last. */
export function screenUniverse(
  rows: readonly VectorUniverseRow[],
  opts: ScreenerOptions = {}
): VectorUniverseRow[] {
  const cfg =
    opts.preset && opts.preset !== "all"
      ? PRESET_CONFIG[opts.preset]
      : { regime: opts.regime ?? "all", sort: opts.sort ?? "ticker", dir: opts.dir ?? "asc" };

  const filtered =
    cfg.regime === "all" ? [...rows] : rows.filter((r) => screenerRegimeOf(r) === cfg.regime);

  const dirMul = cfg.dir === "desc" ? -1 : 1;
  return filtered.sort((a, b) => {
    const ma = metricFor(a, cfg.sort);
    const mb = metricFor(b, cfg.sort);
    // Nulls to the bottom regardless of direction.
    if (ma == null && mb == null) return a.ticker.localeCompare(b.ticker);
    if (ma == null) return 1;
    if (mb == null) return -1;
    if (typeof ma === "string" || typeof mb === "string") {
      return String(ma).localeCompare(String(mb)) * dirMul;
    }
    if (ma === mb) return a.ticker.localeCompare(b.ticker); // stable tiebreak
    return (ma - mb) * dirMul;
  });
}
