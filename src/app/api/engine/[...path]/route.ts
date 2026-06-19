import { NextRequest, NextResponse } from "next/server";
import { engineConfigured, fetchEngine } from "@/lib/engine";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Allowlisted read-only engine sub-paths the app proxies. Anything else is
 * rejected so this catch-all can never forward arbitrary engine endpoints.
 * `/health` has its own dedicated route and is intentionally excluded here.
 */
const ALLOWED_ENGINE_PATHS = new Set(["nighthawk/plays", "heatmap"]);

function normalizeEnginePath(path: string[]): string | null {
  const joined = path.join("/").replace(/^\/+|\/+$/g, "");
  // No traversal, no nested arbitrary depth beyond the allowlist.
  if (!joined || joined.includes("..")) return null;
  return ALLOWED_ENGINE_PATHS.has(joined) ? joined : null;
}

async function proxyGet(req: NextRequest, context: RouteContext) {
  // Gate: signed-in user (any tier) or cron secret. Closes public access —
  // this route forwards server-credentialed requests to the internal engine.
  const gate = await authorizeCronOrTierApi(req, "premium");
  if (gate instanceof Response) return gate;

  if (!engineConfigured()) {
    return NextResponse.json({ error: "Engine not configured", available: false }, { status: 503 });
  }

  const { path } = await context.params;
  const safePath = normalizeEnginePath(path);
  if (!safePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const query = req.nextUrl.searchParams.toString();
  const fullPath = query ? `/${safePath}?${query}` : `/${safePath}`;

  try {
    const data = await fetchEngine(fullPath);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[engine proxy]", fullPath, error);
    return NextResponse.json({ error: "Engine unreachable" }, { status: 502 });
  }
}

export const GET = proxyGet;

// POST proxying is intentionally disabled — no caller uses it, and forwarding an
// attacker-controlled body to the credentialed engine is a mutation/SSRF vector.
export function POST() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
