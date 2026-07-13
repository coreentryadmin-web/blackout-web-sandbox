// Pure path-allowlist guard for BIE's get_uw / get_polygon read tools (side-effect-free so it's
// unit-testable without importing the provider graph). Read-only by construction — the tools only
// ever GET — this is defense-in-depth: it blocks SSRF (absolute URLs), path traversal, and
// off-allowlist endpoints so a raw path can't be pointed anywhere unexpected.

/** Reject absolute URLs, traversal, control chars, over-long paths; return the cleaned path or null. */
export function sanitizeProviderPath(endpoint: string): string | null {
  if (!endpoint || typeof endpoint !== "string") return null;
  const e = endpoint.trim();
  if (!e.startsWith("/")) return null; // must be a path — blocks "http://…" SSRF
  if (e.startsWith("//")) return null; // protocol-relative → SSRF
  if (e.includes("://") || e.includes("..") || e.includes("\\") || /[\n\r\t]/.test(e)) return null;
  if (e.length > 512) return null;
  return e.split("#")[0]!;
}

// UW is a read-only data API (all GET). Allowlist the known DATA collections; deny anything else.
const UW_ALLOW_RE =
  /^\/api\/(stock|darkpool|dark-pool|option-trades|option-contract|options|market|market-tide|market-general|etf|etfs|net-flow|net-prem-ticks|congress|insider|institution|institutions|screener|gex|greek|greeks|greek-exposure|greek-flow|group-flow|seasonality|earnings|news|flow|flow-alerts|flow-per-strike|oi|oi-change|spike|volatility|iv|realized|shorts|short-interest|ftds|expiry-breakdown|nope|correlations|economic|economy|analyst|ratings|predictions|spot-exposures)\b/i;

/** True when a UW endpoint is an allowlisted read-data path. */
export function isAllowedUwPath(endpoint: string): boolean {
  const p = sanitizeProviderPath(endpoint);
  return p != null && UW_ALLOW_RE.test(p);
}

// Polygon/Massive REST: versioned data namespaces + snapshot/reference/marketstatus. All GET reads.
const POLYGON_ALLOW_RE = /^\/(v[0-9x]+|snapshot|reference|marketstatus|aggs|meta|last)\b/i;

/** True when a Polygon endpoint is an allowlisted read-data path. */
export function isAllowedPolygonPath(endpoint: string): boolean {
  const p = sanitizeProviderPath(endpoint);
  return p != null && POLYGON_ALLOW_RE.test(p);
}
