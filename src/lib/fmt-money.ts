// Single source of truth for the "compact signed dollar magnitude" formatter
// (e.g. "$38.2M" / "-$4.1K"). Dependency-free so it's safe to import from both
// server code and client components.
//
// MONEY-PATH INVARIANT: this MUST stay byte-identical in behavior to the ~15
// copies it replaces across polygon-options-gex.ts, gex-positioning.ts,
// spx-commentary.ts, gex-heatmap-display.ts, nighthawk/format.ts,
// nighthawk/grounding.ts, largo/flow-strike-stacks.ts, and zerodte/intel.ts —
// several of which rendered a DIFFERENT string for the same dollar figure
// (a real production data-correctness bug). Do not change the branch
// thresholds or decimal precision without auditing every call site.

/** Compact signed dollar magnitude, e.g. "$38.2M" / "-$4.1K". */
export function fmtPremium(n: number | null): string {
  // NaN/Infinity guard (not just null): these formatters are used pervasively by desk
  // components, and one NaN input (a failed Number() upstream) rendered a literal
  // "$NaN" on the member UI. An unrepresentable number displays as the same honest
  // em-dash a missing one does.
  if (n == null || !Number.isFinite(n)) return "—";
  // Sign OUTSIDE the currency glyph so negatives read "-$1.2M", never "$-1.2M".
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // Billions branch BEFORE the millions branch — otherwise Net GEX (≈ -$5B) printed
  // "$5000.0M" instead of "$5.0B" (GexDealerPanel.tsx:39). Mirrors the sibling
  // fmtMoney formatters (GexHeatmap.tsx:254, gex-positioning.ts:80).
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  // Below $10K, keep 1 decimal so $1.4K and $1.5K don't collapse to the same
  // string (premium size is the signal); $10K+ stays whole-K for compactness.
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k < 10 ? k.toFixed(1) : k.toFixed(0)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}
