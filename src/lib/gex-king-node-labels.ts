/**
 * Shared member-facing copy for the argmax |net dealer gamma| strike — the same level
 * on SPX Slayer and BlackOut Thermal (desk `gex_king`, matrix anchor, KeyLevelBox).
 *
 * "King node" = dominant gamma concentration in the lattice.
 * "GEX anchor" = pin/gravity metaphor — same strike, same math.
 */

/** Primary label — matches learn guides, Discord, Night Hawk `gex_king_strike`. */
export const GEX_KING_NODE_LABEL = "King node";

/** Synonym label — SPX desk levels ladder + commentary tradition. */
export const GEX_ANCHOR_LABEL = "GEX anchor";

/** Compact dual label for tight matrix/profile row tags. */
export const GEX_KING_COMPACT_LABEL = "King · Anchor";

/** Full dual label for tiles, legends, and level rows. */
export const GEX_KING_DUAL_LABEL = "King node · GEX anchor";

/** One-line definition for tooltips / help text. */
export const GEX_KING_NODE_HELP =
  "Strike with the largest absolute net dealer gamma in this view — the dominant pin (King node) and gravitational anchor (GEX anchor). Not the same as call wall or put wall.";

/** Scope-qualified dual label, e.g. "King node · GEX anchor (near-term)". */
export function gexKingDualLabel(scope?: string): string {
  if (!scope?.trim()) return GEX_KING_DUAL_LABEL;
  return `${GEX_KING_DUAL_LABEL} (${scope.trim()})`;
}
