import type { MarkProduct } from "@/components/marks/ProductMark";

/** Primary product routes where the iOS bottom tab bar should appear. */
export const IOS_TOOL_ROUTES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/grid",
] as const;

export type IosToolRoute = (typeof IOS_TOOL_ROUTES)[number];

export type IosRouteKey =
  | "dashboard"
  | "flows"
  | "heatmap"
  | "largo"
  | "nighthawk"
  | "grid"
  | "vector"
  | "account"
  | "faq"
  | "learn"
  | "upgrade"
  | "admin"
  | "other";

export type IosToolMeta = {
  href: IosToolRoute;
  label: string;
  short: string;
  mark: MarkProduct;
  accent: string;
  tagline: string;
  /** Terminal instrument code (instrument rail). */
  code: string;
};

/** Canonical tool metadata for native iOS chrome (header, tab bar, menu). */
export const IOS_TOOLS: IosToolMeta[] = [
  {
    href: "/dashboard",
    label: "SPX Slayer",
    short: "SPX",
    mark: "spx",
    accent: "#00e676",
    tagline: "0DTE structure desk",
    code: "SPX",
  },
  {
    href: "/flows",
    label: "HELIX",
    short: "HELIX",
    mark: "helix",
    accent: "#bf5fff",
    tagline: "Institutional flow tape",
    code: "HLX",
  },
  {
    href: "/heatmap",
    label: "BlackOut Thermal",
    short: "Thermal",
    mark: "heatmap",
    accent: "#ff6b2b",
    tagline: "Dealer gamma map",
    code: "THM",
  },
  {
    href: "/terminal",
    label: "Largo",
    short: "Largo",
    mark: "largo",
    accent: "#22d3ee",
    tagline: "AI desk analyst",
    code: "LRG",
  },
  {
    href: "/nighthawk",
    label: "Night Hawk",
    short: "Hawk",
    mark: "nighthawk",
    accent: "#ff2d55",
    tagline: "Overnight playbook",
    code: "HWK",
  },
  {
    href: "/grid",
    label: "0DTE Command",
    short: "0DTE",
    mark: "grid",
    accent: "#ffcc4d",
    tagline: "Always-on hunter",
    code: "0DT",
  },
];

const IOS_UTILITY_META: Record<
  "account" | "faq" | "learn" | "upgrade" | "admin" | "vector" | "other",
  { title: string; accent: string }
> = {
  account: { title: "Account", accent: "#7dd3fc" },
  faq: { title: "FAQ", accent: "#7dd3fc" },
  learn: { title: "Learn", accent: "#7dd3fc" },
  upgrade: { title: "Membership", accent: "#7dd3fc" },
  admin: { title: "Admin", accent: "#7dd3fc" },
  // Not a bottom-tab tool (see IOS_NATIVE_SHELL_PATH_PREFIXES below) — routed through the
  // utility-header branch so it still gets a proper title/accent without joining the
  // fixed 6-tool tab bar registry that iOS Phase 0d is consolidating.
  vector: { title: "Vector", accent: "#2dd4bf" },
  other: { title: "BlackOut", accent: "#00e676" },
};

/** Maps URL path → `data-ios-route` key (used by chrome + CSS). */
export function getIosRouteKey(path: string): IosRouteKey {
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "dashboard";
  if (path.startsWith("/flows")) return "flows";
  if (path.startsWith("/heatmap")) return "heatmap";
  if (path.startsWith("/terminal")) return "largo";
  if (path.startsWith("/nighthawk")) return "nighthawk";
  if (path.startsWith("/grid")) return "grid";
  if (path.startsWith("/vector")) return "vector";
  if (path.startsWith("/account")) return "account";
  if (path.startsWith("/faq")) return "faq";
  if (path.startsWith("/learn")) return "learn";
  if (path.startsWith("/upgrade")) return "upgrade";
  if (path.startsWith("/admin")) return "admin";
  return "other";
}

export const IOS_TOOL_NAV_LABELS: Record<IosToolRoute, string> = Object.fromEntries(
  IOS_TOOLS.map((t) => [t.href, t.label])
) as Record<IosToolRoute, string>;

export function isIosToolRoute(path: string): boolean {
  return IOS_TOOL_ROUTES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Tab order index for direction-aware iOS page transitions (-1 when not a tool route). */
export function getIosToolRouteIndex(path: string): number {
  return IOS_TOOL_ROUTES.findIndex((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function getIosToolMeta(path: string): IosToolMeta | null {
  return IOS_TOOLS.find((t) => path === t.href || path.startsWith(`${t.href}/`)) ?? null;
}

/** Resolve the active tool label for iOS nav chrome (null when not on a tool route). */
export function getIosToolNavLabel(path: string): string | null {
  return getIosToolMeta(path)?.label ?? null;
}

export type IosHeaderMeta = {
  key: IosRouteKey;
  title: string;
  kicker: string;
  accent: string;
  mark?: MarkProduct;
  /** Show back-to-desk affordance (utility routes). */
  showBack: boolean;
};

/** Header title/accent for native chrome — tools + utility routes. */
export function getIosHeaderMeta(path: string): IosHeaderMeta {
  const tool = getIosToolMeta(path);
  if (tool) {
    return {
      key: getIosRouteKey(path),
      title: tool.label,
      kicker: tool.tagline,
      accent: tool.accent,
      mark: tool.mark,
      showBack: false,
    };
  }
  const key = getIosRouteKey(path);
  const utilityKey =
    key === "account" ||
    key === "faq" ||
    key === "learn" ||
    key === "upgrade" ||
    key === "admin" ||
    key === "vector" ||
    key === "other"
      ? key
      : "other";
  const utility = IOS_UTILITY_META[utilityKey];
  return {
    key,
    title: utility.title,
    kicker: "",
    accent: utility.accent,
    showBack: key !== "other" && !isIosToolRoute(path),
  };
}

/** Product paths that use native chrome once signed in (head script pre-flag). */
export const IOS_NATIVE_SHELL_PATH_PREFIXES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/grid",
  "/vector",
  "/account",
  "/faq",
  "/learn",
  "/upgrade",
  "/admin",
] as const;

export function isIosNativeShellPath(path: string): boolean {
  return IOS_NATIVE_SHELL_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** In-app routes that use the native header (signed-in product shell). */
export function isIosNativeShellRoute(path: string): boolean {
  if (isIosToolRoute(path)) return true;
  return isIosNativeShellPath(path);
}
