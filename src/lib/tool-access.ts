// Launch-gating config: which in-app tools are LIVE vs "Launching Soon". Pure + alias-free (no Clerk,
// no Next, no process beyond env) so it is client + server + unit-test safe. Admin bypass is layered on
// in tool-access-server.ts — this module only knows the per-tool launch state.
//
// WHY: paying (Whop) users should NOT get the whole site on day one. SPX Slayer + HELIX ship live;
// Largo, Heatmaps, and Night Hawk are gated behind a padlock until they're finished. The locked set is
// env-overridable (LAUNCHED_TOOLS) so each tool can be flipped live with a single Railway var edit —
// no code change, no redeploy, no risk of shipping a bug just to unlock a feature.

export type ToolKey = "spx" | "flows" | "heatmap" | "largo" | "nighthawk" | "grid";

/** ProductMark sigil keys — kept inline (not imported) so this module stays alias-free + test-safe.
 *  Structurally identical to MarkProduct in components/marks/ProductMark.tsx, so a ToolMeta.product
 *  is directly assignable to <ProductMark product>. */
export type ToolSigil = "spx" | "helix" | "heatmap" | "largo" | "nighthawk" | "grid";

export type ToolMeta = {
  key: ToolKey;
  /** Display label (matches the nav). */
  label: string;
  /** Canonical in-app route. */
  href: string;
  /** ProductMark sigil key (for the lock screen). */
  product: ToolSigil;
  /** Live for everyone on launch day? */
  defaultLaunched: boolean;
};

export const TOOLS: readonly ToolMeta[] = [
  { key: "spx", label: "SPX Slayer", href: "/dashboard", product: "spx", defaultLaunched: true },
  { key: "flows", label: "HELIX", href: "/flows", product: "helix", defaultLaunched: true },
  { key: "heatmap", label: "BlackOut Thermal", href: "/heatmap", product: "heatmap", defaultLaunched: false },
  { key: "largo", label: "Largo AI", href: "/terminal", product: "largo", defaultLaunched: false },
  { key: "nighthawk", label: "Night Hawk", href: "/nighthawk", product: "nighthawk", defaultLaunched: false },
  // BlackOut Grid — market-intelligence command center. Ships LOCKED ("Launching Soon"); flip live via
  // LAUNCHED_TOOLS=grid (additive env, no redeploy). Admin bypass is automatic (tool-access-server.ts).
  { key: "grid", label: "BlackOut Grid", href: "/grid", product: "grid", defaultLaunched: false },
] as const;

const TOOL_BY_KEY = new Map<ToolKey, ToolMeta>(TOOLS.map((t) => [t.key, t]));

export function toolMeta(key: ToolKey): ToolMeta | undefined {
  return TOOL_BY_KEY.get(key);
}

/** Map an in-app href to its tool key (for nav rendering). Returns null for non-tool links. */
export function toolKeyForHref(href: string): ToolKey | null {
  const hit = TOOLS.find((t) => t.href === href);
  return hit ? hit.key : null;
}

/** Tool keys explicitly flipped LIVE via env. ADDITIVE to the default-launched set, so you unlock a
 *  tool by adding it to LAUNCHED_TOOLS (e.g. "heatmap,largo") — never accidentally lock spx/flows. */
function envLaunchedKeys(env: NodeJS.ProcessEnv): Set<ToolKey> {
  const raw = (env.LAUNCHED_TOOLS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(raw.filter((k): k is ToolKey => TOOL_BY_KEY.has(k as ToolKey)));
}

/** A tool is launched if it ships live by default OR is explicitly enabled via LAUNCHED_TOOLS. */
export function isToolLaunched(key: ToolKey, env: NodeJS.ProcessEnv = process.env): boolean {
  const meta = TOOL_BY_KEY.get(key);
  if (!meta) return false;
  return meta.defaultLaunched || envLaunchedKeys(env).has(key);
}

/** All currently-locked (non-launched) tool keys — drives the nav padlocks. */
export function lockedToolKeys(env: NodeJS.ProcessEnv = process.env): ToolKey[] {
  return TOOLS.filter((t) => !isToolLaunched(t.key, env)).map((t) => t.key);
}
