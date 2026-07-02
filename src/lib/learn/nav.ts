import type { MarkProduct } from "@/components/marks/ProductMark";

export type LearnSlug =
  | "getting-started"
  | "spx-slayer"
  | "helix-flows"
  | "largo-ai"
  | "night-hawk"
  | "heat-maps"
  | "nights-watch"
  | "blackout-grid"
  | "glossary";

export type LearnNavItem = {
  slug: LearnSlug;
  product: MarkProduct | "docs";
  label: string;
  description: string;
  tag?: string;
};

export const LEARN_NAV: LearnNavItem[] = [
  {
    slug: "getting-started",
    product: "docs",
    label: "Getting Started",
    description: "Membership, navigation, daily workflow, and the shared data pipeline.",
    tag: "Chapter 1",
  },
  {
    slug: "spx-slayer",
    product: "spx",
    label: "SPX Slayer",
    description: "Real-time 0DTE SPX desk — GEX walls, play engine, structure.",
  },
  {
    slug: "helix-flows",
    product: "helix",
    label: "HELIX",
    description: "Institutional options flow — whale alerts and dark-pool prints.",
  },
  {
    slug: "largo-ai",
    product: "largo",
    label: "Largo",
    description: "BlackOut Intelligence desk analyst grounded in live GEX, flow, and positioning.",
  },
  {
    slug: "night-hawk",
    product: "nighthawk",
    label: "Night Hawk",
    description: "Evening playbook — tomorrow's setups, scored tonight.",
  },
  {
    slug: "heat-maps",
    product: "heatmap",
    label: "Thermal",
    description: "GEX, VEX, DEX, and CHARM dealer positioning surfaces.",
  },
  {
    slug: "nights-watch",
    product: "nighthawk",
    label: "Night's Watch",
    description: "Personal position manager with live P&L and Greeks.",
  },
  {
    slug: "blackout-grid",
    product: "grid",
    label: "BlackOut Grid",
    description: "Market intelligence — news, flow, earnings, catalysts.",
  },
  {
    slug: "glossary",
    product: "docs",
    label: "Glossary",
    description: "Terms and metrics used across the platform.",
  },
];

export function learnHref(slug: LearnSlug): string {
  return `/learn/${slug}`;
}
