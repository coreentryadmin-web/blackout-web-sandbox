import type { LearnSlug } from "@/lib/learn/nav";
import type { LearnNavItem } from "@/lib/learn/types";

/** Live app routes — cross-linked from Learn docs. */
export const TOOL_ROUTES: Record<
  Exclude<LearnSlug, "getting-started" | "glossary">,
  string
> = {
  "spx-slayer": "/dashboard",
  "helix-flows": "/flows",
  "largo-ai": "/terminal",
  "night-hawk": "/nighthawk",
  "heat-maps": "/heatmap",
  "nights-watch": "/nighthawk",
  "blackout-grid": "/grid",
};

export const SITE_ROUTES = {
  home: "/",
  learn: "/learn",
  account: "/account",
  upgrade: "/upgrade",
  signIn: "/sign-in",
  admin: "/admin",
} as const;

export function toolRoute(slug: LearnSlug): string | null {
  if (slug === "getting-started" || slug === "glossary") return null;
  return TOOL_ROUTES[slug as keyof typeof TOOL_ROUTES] ?? null;
}

export const PRIMARY_NAV: LearnNavItem[] = [
  {
    label: "SPX Slayer",
    href: "/dashboard",
    description: "Primary RTH desk — GEX structure, play engine, live 0DTE intelligence.",
    badge: "Core desk",
  },
  {
    label: "HELIX",
    href: "/flows",
    description: "Institutional options flow tape — sweeps, blocks, and unusual prints.",
  },
  {
    label: "BlackOut Thermal",
    href: "/heatmap",
    description: "GEX, VEX, DEX, and CHARM surfaces across strikes and expiries.",
  },
  {
    label: "Largo",
    href: "/terminal",
    description: "BlackOut Intelligence analyst grounded in live platform data.",
  },
  {
    label: "Night Hawk",
    href: "/nighthawk",
    description: "Evening playbook plus Night's Watch position manager.",
  },
  {
    label: "BlackOut Grid",
    href: "/grid",
    description: "News, catalysts, earnings, sectors, and macro intelligence board.",
  },
  {
    label: "Learn",
    href: "/learn",
    description: "This documentation hub — textbook flow from orientation to advanced workflows.",
  },
  {
    label: "Account",
    href: "/account",
    description: "Membership, alerts, and account settings.",
  },
  {
    label: "Upgrade",
    href: "/upgrade",
    description: "Premium membership and billing.",
  },
];
