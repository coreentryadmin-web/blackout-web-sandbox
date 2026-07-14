// BIE route registry — the governed manifest of internal API routes BIE/Largo may READ.
//
// This is the firewall for universal read-access (tasks #53/#54): the ONE source of truth for
// "which internal endpoints is BIE allowed to call, and are they read-only". call_internal_api
// consults `isReadAllowed()` and refuses anything that isn't an explicitly-listed, GET-only,
// class:"read" route. Hand-maintained + test-asserted (same pattern as cron-registry.ts) so the
// allowlist can't silently drift.
//
// SAFETY MODEL — read-only + governed, deny-by-default:
//   1. Whole AREAS are structurally denied regardless of method (admin / cron / auth / webhook /
//      push / membership / engine) — never even listed as routes.
//   2. Cost/LLM + write routes UNDER an allowed area (largo/query, spx/commentary, nighthawk/hunt,
//      nighthawk/play-explain, track-record/publish, …) are listed with class:"mutation" so they're
//      documented AND denied.
//   3. Only class:"read" + GET passes. A path not in this registry at all is denied by default.
// NEVER add a mutation/admin/auth/cost/webhook surface as class:"read".

export type RouteArea =
  | "market"
  | "vector"
  | "spx"
  | "nighthawk"
  | "platform"
  | "track-record"
  | "public"
  | "health";

export type RouteClass = "read" | "mutation";

export type RouteDefinition = {
  /** Full internal path, e.g. "/api/market/gex-positioning". */
  path: string;
  /** HTTP methods BIE may use — read routes are GET-only. */
  methods: ("GET")[];
  area: RouteArea;
  /** "read" = safe for call_internal_api; "mutation" = documented but DENIED. */
  class: RouteClass;
  /** Short description for the generated platform:routes knowledge doc. */
  description: string;
};

/** Area prefixes that are NEVER exposed to BIE, regardless of method or class. The firewall. */
export const DENIED_AREA_PREFIXES: readonly string[] = [
  "/api/admin",
  "/api/cron",
  "/api/auth",
  "/api/webhook",
  "/api/webhooks",
  "/api/push",
  "/api/membership",
  "/api/engine", // catch-all [...path] proxy — SSRF risk
];

export const ROUTES: RouteDefinition[] = [
  // ── Market data (read) ─────────────────────────────────────────────────
  { path: "/api/market/quote", methods: ["GET"], area: "market", class: "read", description: "Live quote for a ticker." },
  { path: "/api/market/indices", methods: ["GET"], area: "market", class: "read", description: "SPX/SPY/QQQ/VIX index snapshot." },
  { path: "/api/market/news", methods: ["GET"], area: "market", class: "read", description: "Market/ticker news headlines." },
  { path: "/api/market/heatmap", methods: ["GET"], area: "market", class: "read", description: "GEX/VEX/DEX/CHARM heatmap matrix (Thermal)." },
  { path: "/api/market/gex-heatmap", methods: ["GET"], area: "market", class: "read", description: "GEX heatmap surface for a ticker." },
  { path: "/api/market/gex-heatmap/explain", methods: ["GET"], area: "market", class: "read", description: "Deterministic GEX-heatmap narrative." },
  { path: "/api/market/gex-positioning", methods: ["GET"], area: "market", class: "read", description: "Canonical dealer positioning (spot/flip/walls/greeks)." },
  { path: "/api/market/dark-pool", methods: ["GET"], area: "market", class: "read", description: "Dark-pool prints (market-wide)." },
  { path: "/api/market/dark-pool/ticker", methods: ["GET"], area: "market", class: "read", description: "Dark-pool prints for a ticker." },
  { path: "/api/market/flows", methods: ["GET"], area: "market", class: "read", description: "HELIX flow tape." },
  { path: "/api/market/flows/stream", methods: ["GET"], area: "market", class: "read", description: "HELIX flow tape SSE stream." },
  { path: "/api/market/flow-brief", methods: ["GET"], area: "market", class: "read", description: "Deterministic flow-tape brief." },
  { path: "/api/market/regime", methods: ["GET"], area: "market", class: "read", description: "Market-regime detector snapshot (GET read)." },
  { path: "/api/market/earnings-calendar", methods: ["GET"], area: "market", class: "read", description: "Upcoming earnings calendar." },
  { path: "/api/market/option-contract", methods: ["GET"], area: "market", class: "read", description: "Single option-contract detail." },
  { path: "/api/market/ticker-search", methods: ["GET"], area: "market", class: "read", description: "Ticker/company search." },
  { path: "/api/market/lotto/today", methods: ["GET"], area: "market", class: "read", description: "Today's SPX lotto state." },
  { path: "/api/market/zerodte/board", methods: ["GET"], area: "market", class: "read", description: "0DTE Command scanner board." },

  // ── Platform / health (read) ───────────────────────────────────────────
  { path: "/api/market/platform/snapshot", methods: ["GET"], area: "platform", class: "read", description: "Cross-product one-call snapshot (SPX desk + flow + Night Hawk)." },
  { path: "/api/platform/intel", methods: ["GET"], area: "platform", class: "read", description: "Platform intel snapshot (market-regime backdrop)." },
  { path: "/api/health", methods: ["GET"], area: "health", class: "read", description: "Service health." },
  { path: "/api/market/health", methods: ["GET"], area: "health", class: "read", description: "Market data health." },

  // ── SPX desk (read) ────────────────────────────────────────────────────
  { path: "/api/market/spx/desk", methods: ["GET"], area: "spx", class: "read", description: "Full live SPX Sniper desk snapshot." },
  { path: "/api/market/spx/play", methods: ["GET"], area: "spx", class: "read", description: "SPX Slayer play-engine state." },
  { path: "/api/market/spx/pulse", methods: ["GET"], area: "spx", class: "read", description: "SPX pulse read." },
  { path: "/api/market/spx/pulse/stream", methods: ["GET"], area: "spx", class: "read", description: "SPX pulse SSE stream." },
  { path: "/api/market/spx/flow", methods: ["GET"], area: "spx", class: "read", description: "SPX desk flow slice." },
  { path: "/api/market/spx/merged", methods: ["GET"], area: "spx", class: "read", description: "Merged SPX desk feed." },
  { path: "/api/market/spx/signals", methods: ["GET"], area: "spx", class: "read", description: "SPX signal log." },
  { path: "/api/market/spx/outcomes", methods: ["GET"], area: "spx", class: "read", description: "SPX closed-play outcomes." },
  { path: "/api/market/spx/power-hour", methods: ["GET"], area: "spx", class: "read", description: "SPX power-hour play state." },
  { path: "/api/market/spx/journal", methods: ["GET"], area: "spx", class: "read", description: "SPX journal (GET read only — POST is a mutation, denied by method)." },
  { path: "/api/market/spx/bootstrap", methods: ["GET"], area: "spx", class: "read", description: "SPX desk bootstrap payload." },

  // ── Vector (read) ──────────────────────────────────────────────────────
  { path: "/api/market/vector/bars", methods: ["GET"], area: "vector", class: "read", description: "Vector chart bars." },
  { path: "/api/market/vector/walls", methods: ["GET"], area: "vector", class: "read", description: "Vector GEX walls (DTE-scoped)." },
  { path: "/api/market/vector/wall-history", methods: ["GET"], area: "vector", class: "read", description: "Vector wall-history bead rail." },
  { path: "/api/market/vector/gex-heatmap", methods: ["GET"], area: "vector", class: "read", description: "Vector strike×time GEX heatmap." },
  { path: "/api/market/vector/gex-ladder", methods: ["GET"], area: "vector", class: "read", description: "Vector per-strike GEX ladder." },
  { path: "/api/market/vector/max-pain", methods: ["GET"], area: "vector", class: "read", description: "Vector horizon max pain." },
  { path: "/api/market/vector/expected-move", methods: ["GET"], area: "vector", class: "read", description: "Vector expected-move cone." },
  { path: "/api/market/vector/flow", methods: ["GET"], area: "vector", class: "read", description: "Vector flow markers." },
  { path: "/api/market/vector/prior-day", methods: ["GET"], area: "vector", class: "read", description: "Vector prior-day levels." },
  { path: "/api/market/vector/universe", methods: ["GET"], area: "vector", class: "read", description: "Vector universe scanner rows." },
  { path: "/api/market/vector/spy-volume", methods: ["GET"], area: "vector", class: "read", description: "SPY per-minute volume (SPX bar alignment)." },
  { path: "/api/market/vector/stream", methods: ["GET"], area: "vector", class: "read", description: "Vector live SSE stream." },

  // ── Night Hawk (read) ──────────────────────────────────────────────────
  { path: "/api/market/nighthawk/edition", methods: ["GET"], area: "nighthawk", class: "read", description: "Published Night Hawk edition." },
  { path: "/api/market/nighthawk/record", methods: ["GET"], area: "nighthawk", class: "read", description: "Night Hawk scoring record/dossier (GET read)." },

  // ── Track record (read) ────────────────────────────────────────────────
  { path: "/api/track-record", methods: ["GET"], area: "track-record", class: "read", description: "Overall track record." },
  { path: "/api/track-record/plays", methods: ["GET"], area: "track-record", class: "read", description: "Track-record play history." },
  { path: "/api/public/track-record", methods: ["GET"], area: "public", class: "read", description: "Public track record." },

  // ── DOCUMENTED-BUT-DENIED (class:"mutation") — cost/LLM + write routes under
  //    otherwise-allowed areas. Listed so the firewall is explicit and test-asserted;
  //    call_internal_api will REFUSE all of these. ───────────────────────
  { path: "/api/market/largo/query", methods: ["GET"], area: "market", class: "mutation", description: "Largo LLM query — COST route, denied." },
  { path: "/api/market/largo/session", methods: ["GET"], area: "market", class: "mutation", description: "Largo session mutation, denied." },
  { path: "/api/market/spx/commentary", methods: ["GET"], area: "spx", class: "mutation", description: "SPX commentary — LLM COST route, denied." },
  { path: "/api/market/nighthawk/hunt", methods: ["GET"], area: "nighthawk", class: "mutation", description: "Night Hawk hunt — LLM COST route, denied." },
  { path: "/api/market/nighthawk/play-explain", methods: ["GET"], area: "nighthawk", class: "mutation", description: "Night Hawk play-explain — LLM COST route, denied." },
  { path: "/api/market/anomalies", methods: ["GET"], area: "market", class: "mutation", description: "Anomalies write path — denied (not in the read allowlist)." },
  { path: "/api/track-record/publish", methods: ["GET"], area: "track-record", class: "mutation", description: "Track-record publish — WRITE, denied." },
];

function normalizePath(path: string): string {
  // Strip query string + trailing slash for matching.
  const noQuery = path.split("?")[0]!.split("#")[0]!;
  return noQuery.length > 1 && noQuery.endsWith("/") ? noQuery.slice(0, -1) : noQuery;
}

/** True when a path falls under a structurally-denied area (admin/cron/auth/webhook/push/…). */
export function isDeniedAreaPath(path: string): boolean {
  const p = normalizePath(path);
  return DENIED_AREA_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
}

/**
 * Resolve the registry entry for a request path, matching the registered route exactly OR as a
 * prefix of a deeper sub-resource (e.g. "/api/market/quote/AAPL" → the quote route). Query strings
 * and trailing slashes are ignored.
 */
export function routeFor(path: string): RouteDefinition | null {
  const p = normalizePath(path);
  // Prefer the longest matching registered path so a specific route wins over a shorter prefix.
  let best: RouteDefinition | null = null;
  for (const r of ROUTES) {
    if (p === r.path || p.startsWith(r.path + "/")) {
      if (!best || r.path.length > best.path.length) best = r;
    }
  }
  return best;
}

/**
 * The single gate call_internal_api uses. Read-only + governed: GET only, not in a denied area, and
 * resolves to a class:"read" registry route. Everything else — a non-GET method, a denied area, a
 * class:"mutation" route, or an unregistered path — is refused.
 */
export function isReadAllowed(path: string, method = "GET"): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (isDeniedAreaPath(path)) return false;
  const r = routeFor(path);
  return r != null && r.class === "read";
}

/** The read-allowlisted paths — for docs / the generated knowledge chunk / the tool description. */
export function readAllowedPaths(): string[] {
  return ROUTES.filter((r) => r.class === "read").map((r) => r.path);
}

/** Prose manifest of the read allowlist for ingestBieKnowledge (platform:routes chunk). */
export function routeRegistryKnowledgeText(): string {
  const byArea = new Map<RouteArea, string[]>();
  for (const r of ROUTES) {
    if (r.class !== "read") continue;
    const list = byArea.get(r.area) ?? [];
    list.push(`- ${r.path} — ${r.description}`);
    byArea.set(r.area, list);
  }
  const sections = [...byArea.entries()].map(([area, lines]) => `## ${area}\n${lines.join("\n")}`);
  return [
    "BLACKOUT internal READ routes BIE may call (GET-only, governed by route-registry.ts).",
    "Denied areas (never callable): " + DENIED_AREA_PREFIXES.join(", ") + ", plus all non-GET verbs and LLM-cost routes.",
    "",
    ...sections,
  ].join("\n\n");
}
