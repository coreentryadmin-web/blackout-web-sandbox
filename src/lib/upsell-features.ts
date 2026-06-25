// Presentation-only upsell data. Pure, alias-free, no React, no env reads.
// Sourced from the ACTUAL gated routes (requireTier/requireTierApi grep):
//   premium pages : dashboard, terminal, flows, heatmap, nighthawk, docs/*
//   premium APIs  : spx/commentary, largo/session, largo/query, docs/spx-playbook
//   free APIs     : market/ticker-search
// This file describes value framing ONLY. It creates no tiers and touches no
// billing — the real entitlement check stays in src/lib/auth-access.ts.

export type FeatureRow = {
  /** Short feature name shown in the left column. */
  label: string;
  /** One-line benefit framing (kept concise for the matrix). */
  detail: string;
  /** Whether the Free tier includes this. */
  free: boolean;
  /** Whether Premium includes this (all current premium gates => true). */
  premium: boolean;
};

/**
 * Free-vs-Premium feature matrix. Order = perceived value, high to low.
 * Edit copy here; the component renders it verbatim.
 */
export const FEATURE_MATRIX: FeatureRow[] = [
  {
    label: "HELIX live flow feed",
    detail: "Real-time options-flow tape, sorted and tagged",
    free: false,
    premium: true,
  },
  {
    label: "SPX Slayer desk",
    detail: "Confluence, GEX walls, dealer gamma — live",
    free: false,
    premium: true,
  },
  {
    label: "Largo AI desk analyst",
    detail: "Plain-English answers grounded in every tool's live data",
    free: false,
    premium: true,
  },
  {
    label: "Night Hawk evening playbook",
    detail: "Overnight scan of the session, ranked setups",
    free: false,
    premium: true,
  },
  {
    label: "Strike-level heatmaps",
    detail: "Dealer positioning mapped across the full chain",
    free: false,
    premium: true,
  },
  {
    label: "SPX AI commentary",
    detail: "Generated read on the current tape",
    free: false,
    premium: true,
  },
  {
    label: "Playbook & docs",
    detail: "SPX Slayer playbook and method docs",
    free: false,
    premium: true,
  },
  {
    label: "Ticker search",
    detail: "Look up any symbol",
    free: true,
    premium: true,
  },
  {
    label: "Account & updates",
    detail: "Sign in, profile, product updates",
    free: true,
    premium: true,
  },
];

export type PlanValueProp = {
  /** Optional badge text rendered above the card (e.g. "Best value"). */
  badge?: string;
  /** Sub-price framing line, e.g. "$58/mo billed yearly". */
  subline?: string;
  /** Savings callout, e.g. "Save $260 vs monthly". */
  savings?: string;
  /** Visually emphasize this card (anchor option). */
  featured?: boolean;
};

/**
 * Value framing keyed by the EXACT WHOP_PREMIUM_CHECKOUT_OPTIONS label
 * (see src/lib/whop-checkout.ts). If a label has no entry here the card still
 * renders with just its label/href — framing is purely additive and optional.
 *
 * Numbers below are presentation copy derived from the list prices
 * ($199/mo, $1,999/yr, $4,999 lifetime). If you change Whop prices, update the
 * labels in whop-checkout.ts AND these strings together.
 */
export const PLAN_VALUE_PROPS: Record<string, PlanValueProp> = {
  "Monthly — $199": {
    subline: "Billed monthly · stand down anytime",
  },
  "Yearly — $1,999": {
    badge: "Standard issue",
    subline: "≈ $167/mo · billed yearly",
    savings: "Save $389 vs monthly",
    featured: true,
  },
  "Lifetime — $4,999": {
    subline: "One payment · permanent access",
    savings: "≈ 25 months of monthly",
  },
};

/** Lookup helper kept pure for unit tests. */
export function valuePropFor(label: string): PlanValueProp {
  return PLAN_VALUE_PROPS[label] ?? {};
}
