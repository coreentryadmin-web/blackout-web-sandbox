import "server-only";
import { getAdminStatus, resolveAdminApi } from "@/lib/admin-access";
import { isToolLaunched, type ToolKey } from "@/lib/tool-access";

// Server-side launch gate = the per-tool launch flag (tool-access.ts) + admin bypass (admin-access.ts,
// the ECS ADMIN_EMAILS allowlist / publicMetadata.role==="admin"). Admins always get every tool
// exactly as today; everyone else only gets launched tools. A LAUNCHED tool short-circuits before any
// Clerk call, so the common path adds zero overhead — the getUser only happens on a LOCKED tool.

/**
 * PAGE gate. True if the current user may render this tool's page. Locked tool → admins only. Call
 * AFTER the page's existing tier gate (requireTier), then render <ComingSoon> when this returns false.
 */
export async function canAccessTool(key: ToolKey): Promise<boolean> {
  if (isToolLaunched(key)) return true;
  const { admin } = await getAdminStatus();
  return admin;
}

/** Desk/cron auth result from authorizeMarketDeskApi / authorizeCronOrTierApi. */
export type DeskApiAuth = { userId: string | null; via: "cron" | "user" };

/**
 * Launch gate for cache-reader desk routes. Cron bearer (ops audits, zerodte-warm probes) skips
 * the per-tool launch flag — same contract as zerodte board's cron bypass. Premium members
 * still hit requireToolApi when via === "user".
 */
export async function requireToolApiForDeskCaller(
  auth: DeskApiAuth,
  key: ToolKey
): Promise<Response | null> {
  if (auth.via === "cron") return null;
  return requireToolApi(key);
}

/**
 * API gate. Returns a 403 "coming soon" Response when the tool is LOCKED and the caller is not an
 * admin, else null (allowed). Call AFTER the route's own auth (tier/desk), so the caller is already
 * authenticated; this just adds the launch boundary so a locked tool's endpoints can't be hit
 * directly (matters most for Largo, where every call spends Anthropic tokens).
 */
export async function requireToolApi(key: ToolKey): Promise<Response | null> {
  if (isToolLaunched(key)) return null;
  const { actor } = await resolveAdminApi(); // actor is non-null ONLY for admins
  if (actor) return null;
  return new Response(
    JSON.stringify({ error: "coming_soon", message: "This tool is launching soon." }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * API gate for a shared surface reachable from MULTIPLE tools. Allowed if ANY of the
 * keys is launched (or the caller is an admin). Used by the canonical GEX positioning
 * route, which both SPX Slayer and Heat Maps read — so an SPX user isn't blocked just
 * because the Heat Maps launch flag is off.
 */
export async function requireAnyToolApi(keys: ToolKey[]): Promise<Response | null> {
  if (keys.some((k) => isToolLaunched(k))) return null;
  const { actor } = await resolveAdminApi();
  if (actor) return null;
  return new Response(
    JSON.stringify({ error: "coming_soon", message: "This tool is launching soon." }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

