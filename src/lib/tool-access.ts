// Launch-gating config: which in-app tools are LIVE vs "Launching Soon". Pure + alias-free (no Clerk,
// no Next, no process beyond env) so it is client + server + unit-test safe. Admin bypass is layered on
// in tool-access-server.ts — this module only knows the per-tool launch state.
//
// WHY: paying (Whop) users get every finished desk tool on day one; Largo stays gated
// behind a padlock until its launch. The locked set remains env-overridable
// (LAUNCHED_TOOLS) for additive unlocks — default-launched tools cannot be locked via env.

export type ToolKey = "spx" | "flows" | "heatmap" | "largo" | "nighthawk" | "vector";

/** ProductMark sigil keys — kept inline (not imported) so this module stays alias-free + test-safe.
 *  Structurally identical to MarkProduct in components/marks/ProductMark.tsx, so a ToolMeta.product
 *  is directly assignable to <ProductMark product>. */
export type ToolSigil = "spx" | "helix" | "heatmap" | "largo" | "nighthawk" | "vector";

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
  { key: "heatmap", label: "BlackOut Thermal", href: "/heatmap", product: "heatmap", defaultLaunched: true },
  { key: "largo", label: "Largo", href: "/terminal", product: "largo", defaultLaunched: false },
  { key: "nighthawk", label: "Night Hawk", href: "/nighthawk", product: "nighthawk", defaultLaunched: true },
  // Vector — admin-only until explicitly launched (LAUNCHED_TOOLS=vector on Railway).
  { key: "vector", label: "Vector", href: "/vector", product: "vector", defaultLaunched: false },
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

export type LaunchSource = "default" | "env" | "locked";

export type LaunchStatusToolRow = {
  key: ToolKey;
  label: string;
  href: string;
  /** Open to paying non-admin users (Whop premium + launch gate). */
  launched: boolean;
  launch_source: LaunchSource;
};

/** Admin/ops snapshot — what premium (non-admin) users see vs Coming Soon. */
export type LaunchStatusSnapshot = {
  /** Raw `LAUNCHED_TOOLS` env (trimmed), or null when unset/empty. */
  launched_tools_env: string | null;
  /** Parsed keys from LAUNCHED_TOOLS (additive to default-launched tools). */
  env_launched_keys: ToolKey[];
  tools: LaunchStatusToolRow[];
  locked_keys: ToolKey[];
  open_count: number;
  total_count: number;
};

export function getLaunchStatusSnapshot(env: NodeJS.ProcessEnv = process.env): LaunchStatusSnapshot {
  const raw = (env.LAUNCHED_TOOLS ?? "").trim();
  const envKeys = [...envLaunchedKeys(env)];
  const tools: LaunchStatusToolRow[] = TOOLS.map((t) => {
    const launched = isToolLaunched(t.key, env);
    const launch_source: LaunchSource = t.defaultLaunched
      ? "default"
      : envKeys.includes(t.key)
        ? "env"
        : "locked";
    return { key: t.key, label: t.label, href: t.href, launched, launch_source };
  });
  const locked_keys = lockedToolKeys(env);
  const open_count = tools.filter((t) => t.launched).length;
  return {
    launched_tools_env: raw || null,
    env_launched_keys: envKeys,
    tools,
    locked_keys,
    open_count,
    total_count: tools.length,
  };
}
