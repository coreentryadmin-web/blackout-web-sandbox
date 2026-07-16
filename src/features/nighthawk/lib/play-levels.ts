// Leaf module — NO server-only imports. play-constraints.ts is pulled into CLIENT
// component bundles (PlaybookPlayRow), so the shared level parser must not drag
// play-outcomes' Polygon/db chain (api-telemetry-persist is "server-only") with it.
// play-outcomes re-exports these so grading and publish-time geometry validation
// keep using literally the same parser.
import type { PlaybookPlay } from "./types";

export type ParsedPlayLevels = {
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
};

function parseDecimal(text: unknown): number | null {
  if (text == null) return null;
  const m = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parsePlayLevels(play: PlaybookPlay): ParsedPlayLevels {
  const entryText = String(play.entry_range ?? "");
  const normalized = entryText.replace(/[–—]/g, "-");
  const entryParts = normalized
    .split("-")
    .map((p) => parseDecimal(p))
    .filter((n): n is number => n != null);

  let entry_range_low: number | null = null;
  let entry_range_high: number | null = null;
  if (entryParts.length >= 2) {
    entry_range_low = Math.min(entryParts[0]!, entryParts[1]!);
    entry_range_high = Math.max(entryParts[0]!, entryParts[1]!);
  } else if (entryParts.length === 1) {
    entry_range_low = entryParts[0]!;
    entry_range_high = entryParts[0]!;
  }

  return {
    entry_range_low,
    entry_range_high,
    target: parseDecimal(play.target),
    stop: parseDecimal(play.stop),
  };
}

/** Format a stock price for member-visible entry/target/stop strings. */
export function formatStockLevel(n: number): string {
  return n.toFixed(2);
}

/**
 * Build entry/target/stop strings for ranked-pool or mechanical-fallback plays that
 * satisfy validatePlayGeometry's direction-aware gate. "Near $X" + stop=X (the prior
 * backfill shape) collapses entry mid to X and fails LONG geometry (stop not below mid).
 */
export function buildDirectionalStockLevels(params: {
  direction: "long" | "short";
  support?: number | null;
  resistance?: number | null;
  /** Current spot price. When provided, entries anchor near spot (overnight plays
   *  where members act at the next session's open, not at a pullback to support). */
  spot?: number | null;
}): { entry_range: string; target: string; stop: string } {
  const support = params.support != null && Number.isFinite(params.support) ? params.support : null;
  const resistance =
    params.resistance != null && Number.isFinite(params.resistance) ? params.resistance : null;
  const spot = params.spot != null && Number.isFinite(params.spot) && params.spot > 0 ? params.spot : null;

  // Spot-anchored path: overnight plays where the member acts at the next open.
  // Entry bands near spot, stop at real S/R, target at real S/R.
  if (spot != null && support != null && resistance != null && resistance > support) {
    if (params.direction === "long") {
      return {
        entry_range: `$${formatStockLevel(spot * 0.995)}-$${formatStockLevel(spot * 1.005)}`,
        target: formatStockLevel(resistance),
        stop: formatStockLevel(support),
      };
    }
    if (params.direction === "short") {
      return {
        entry_range: `$${formatStockLevel(spot * 0.995)}-$${formatStockLevel(spot * 1.005)}`,
        target: formatStockLevel(support),
        stop: formatStockLevel(resistance),
      };
    }
  }

  // Legacy pullback-entry path (no spot): entry near S/R boundaries.
  if (params.direction === "long" && support != null && resistance != null && resistance > support) {
    const lo = support * 0.998;
    const hi = support;
    const stop = support * 0.99;
    return {
      entry_range: `$${formatStockLevel(lo)}-$${formatStockLevel(hi)}`,
      target: formatStockLevel(resistance),
      stop: formatStockLevel(stop),
    };
  }

  if (params.direction === "short" && support != null && resistance != null && resistance > support) {
    const lo = resistance;
    const hi = resistance * 1.002;
    const stop = resistance * 1.01;
    return {
      entry_range: `$${formatStockLevel(lo)}-$${formatStockLevel(hi)}`,
      target: formatStockLevel(support),
      stop: formatStockLevel(stop),
    };
  }

  return {
    entry_range: support != null ? `Near $${formatStockLevel(support)}` : "See technical levels",
    target: resistance != null ? formatStockLevel(resistance) : "-",
    stop: support != null ? formatStockLevel(support) : "-",
  };
}
