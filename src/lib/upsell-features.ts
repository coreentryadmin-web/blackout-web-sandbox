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
    label: "Live HELIX flow feed",
    detail: "Real-time options flow tape, sorted and tagged",
    free: false,
    premium: true,
  },
  {
    label: "SPX live dashboard",
    detail: "Confluence, GEX walls, gamma desk — live",
    free: false,
    premium: true,
  },
  {
    label: "Largo AI terminal",
    detail: "Ask the desk anything across every tool",
    free: false,
    premium: true,
  },
  {
    label: "Night Hawk scanner",
    detail: "Evening plays scanner, ranked setups",
    free: false,
    premium: true,
  },
  {
    label: "Full heatmaps",
    detail: "Strike-level positioning across the chain",
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
    detail: "SPX Sniper playbook and method docs",
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
 * ($111/mo, $1,111/yr, $2,222 lifetime). If you change Whop prices, update the
 * labels in whop-checkout.ts AND these strings together.
 */
export const PLAN_VALUE_PROPS: Record<string, PlanValueProp> = {
  "Monthly — $111": {
    subline: "Billed monthly. Cancel anytime.",
  },
  "Yearly — $1,111": {
    badge: "Best value",
    subline: "≈ $93/mo, billed yearly",
    savings: "Save $221 vs monthly",
    featured: true,
  },
  "Lifetime — $2,222": {
    subline: "One payment. Yours forever.",
    savings: "Pays for itself in ~2 years",
  },
};

/** Lookup helper kept pure for unit tests. */
export function valuePropFor(label: string): PlanValueProp {
  return PLAN_VALUE_PROPS[label] ?? {};
}
