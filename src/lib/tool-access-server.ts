import "server-only";
import { getAdminStatus, resolveAdminApi } from "@/lib/admin-access";
import { isToolLaunched, isZeroDteCommandLaunched, type ToolKey } from "@/lib/tool-access";

// Server-side launch gate = the per-tool launch flag (tool-access.ts) + admin bypass (admin-access.ts,
// the Railway ADMIN_EMAILS allowlist / publicMetadata.role==="admin"). Admins always get every tool
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
 * route, which both Heat Maps and the Grid read — so a Grid user isn't blocked just
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

/** Flip via Railway `LAUNCHED_0DTE=1` when 0DTE Command is ready for all premium users. */
export { isZeroDteCommandLaunched } from "@/lib/tool-access";

/**
 * PAGE gate for the 0DTE Command tab on /grid. The classic Market Grid tab follows
 * `canAccessTool("grid")`; this sub-surface stays admin-only until LAUNCHED_0DTE=1.
 */
export async function canAccessZeroDteCommand(): Promise<boolean> {
  if (isZeroDteCommandLaunched()) return true;
  const { admin } = await getAdminStatus();
  return admin;
}

/**
 * API gate for `/api/market/zerodte/board`. Cron callers bypass via authorizeCronOrTierApi
 * before this runs; premium non-admins get 403 until LAUNCHED_0DTE=1.
 */
export async function requireZeroDteCommandApi(): Promise<Response | null> {
  if (isZeroDteCommandLaunched()) return null;
  const { actor, denied } = await resolveAdminApi();
  if (actor) return null;
  return (
    denied ??
    new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  );
}
