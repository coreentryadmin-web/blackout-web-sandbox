#!/usr/bin/env node
/**
 * Default-deny API auth guard — every API route.ts under src/app/api must call a known
 * guard helper OR be explicitly allowlisted as a public endpoint.
 *
 * Exit 1 on drift — wired into CI verify job.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** Routes intentionally public — keep this list small and documented. */
const PUBLIC_ROUTE_ALLOWLIST = new Set([
  "src/app/api/health/route.ts",
  "src/app/api/ready/route.ts",
  "src/app/api/webhook/whop/route.ts",
  "src/app/api/webhooks/clerk/route.ts",
  "src/app/api/webhook/clerk/route.ts",
  "src/app/api/market/regime/route.ts",
  // Deliberately public write endpoint — browsers can't carry admin auth, and
  // a logged-out visitor's JS erroring is exactly the coverage it exists for.
  // Secured by per-IP rate limit + hard body-size cap, not a guard helper —
  // see src/middleware.ts's isPublicTelemetryRoute exemption + the route file.
  "src/app/api/telemetry/client-error/route.ts",
  // Same reasoning: a visitor on /sign-in isn't authenticated yet by definition,
  // so this can't require a guard helper. Same protections as the route above.
  "src/app/api/telemetry/auth-failure/route.ts",
  // Cognito Hosted UI OAuth — redirects only; session cookies set on callback.
  "src/app/api/auth/cognito/login/route.ts",
  "src/app/api/auth/cognito/logout/route.ts",
  "src/app/api/auth/cognito/callback/route.ts",
]);

const GUARD_PATTERNS = [
  /requireTierApi\s*\(/,
  /requireAdminApi\s*\(/,
  /resolveAdminApi\s*\(/,
  /getAdminApiActor\s*\(/,
  /isCronAuthorized\s*\(/,
  /authorizeMarketDeskApi\s*\(/,
  /authorizeCronOrTierApi\s*\(/,
  /requireToolApi\s*\(/,
  /webhooks\.unwrap\s*\(/,
  /wh\.verify\s*\(/,
  /if\s*\(\s*!userId\s*\)/,
];

function walkApiRoutes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkApiRoutes(path, out);
    else if (entry === "route.ts") out.push(path);
  }
  return out;
}

const routes = walkApiRoutes(join(ROOT, "src/app/api")).sort();
const failures = [];

for (const absPath of routes) {
  const rel = relative(ROOT, absPath).replace(/\\/g, "/");
  if (PUBLIC_ROUTE_ALLOWLIST.has(rel)) continue;

  const src = readFileSync(absPath, "utf8");
  const guarded = GUARD_PATTERNS.some((re) => re.test(src));
  if (!guarded) {
    failures.push(rel);
  }
}

console.log(`API auth guard scan: ${routes.length} routes, ${PUBLIC_ROUTE_ALLOWLIST.size} public allowlist`);

if (failures.length) {
  console.error("\n[FAIL] Routes missing a recognized auth guard:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nAdd requireTierApi / isCronAuthorized / etc., or document the route in PUBLIC_ROUTE_ALLOWLIST."
  );
  process.exit(1);
}

console.log("GREEN — all non-public API routes declare an auth guard.");
process.exit(0);
