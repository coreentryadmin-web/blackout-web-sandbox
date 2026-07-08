import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkMiddlewareAuthOptions, clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkIsClerkSyncFailed } from "@/lib/clerk-redirect-url";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/flows(.*)",
  "/terminal(.*)",
  "/heatmap(.*)",
  "/nighthawk(.*)",
  "/vector(.*)",
  "/admin(.*)",
  "/account(.*)",
]);

// Webhook routes use their own HMAC/signature verification (Whop Standard Webhooks
// scheme, Clerk webhook signature). They must bypass the mutation backstop below —
// their security comes from the signature check inside the handler, not from
// session/bearer auth at the middleware level.
const isWebhookRoute = createRouteMatcher([
  "/api/webhook/(.*)",
  "/api/webhooks/(.*)",
]);

// Deliberately public, unauthenticated POST routes: browsers can't carry admin
// auth, and a LOGGED-OUT visitor's JS throwing (or a not-yet-signed-in visitor
// mistyping a password on /sign-in) is exactly the coverage these routes exist
// for. Security is per-IP rate limiting + a hard body-size cap + write-only to
// a low-sensitivity diagnostic table (see each route file) — not session/bearer
// auth, same bypass reasoning as isWebhookRoute above, different mechanism.
const isPublicTelemetryRoute = createRouteMatcher(["/api/telemetry/client-error", "/api/telemetry/auth-failure"]);

// Methods that mutate server state (i.e., not safe reads).
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const IS_STAGING =
  (process.env.NEXT_PUBLIC_SITE_URL ?? "").includes("staging.") ||
  process.env.SENTRY_ENVIRONMENT === "staging";

function withStagingNoEdgeCache(res: NextResponse): NextResponse {
  if (!IS_STAGING) return res;
  // Cloudflare rule #1 caches /_next/static for 1y — a deploy mismatch 404 gets poisoned
  // at the edge as text/plain and bricks the whole UI. Staging must never edge-cache.
  res.headers.set("CDN-Cache-Control", "no-store");
  res.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  res.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return res;
}

export default clerkMiddleware(
  async (auth, req) => {
    if (IS_STAGING) {
      const path = req.nextUrl.pathname;
      if (path === "/sign-in" || path.startsWith("/sign-in/")) {
        const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard";
        const primary = clerkSatelliteAuthRedirect("sign-in", returnPath);
        if (primary) {
          return withStagingNoEdgeCache(NextResponse.redirect(primary, 307));
        }
      }
      if (path === "/sign-up" || path.startsWith("/sign-up/")) {
        const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard";
        const primary = clerkSatelliteAuthRedirect("sign-up", returnPath);
        if (primary) {
          return withStagingNoEdgeCache(NextResponse.redirect(primary, 307));
        }
      }
      if (clerkIsClerkSyncFailed(req.nextUrl)) {
        const hasClerkCookie =
          req.cookies.has("__session") || req.cookies.has("__client_uat");
        if (!hasClerkCookie) {
          const clean = new URL(req.nextUrl);
          clean.searchParams.delete("__clerk_synced");
          const retry = clerkSatelliteAuthRedirect(
            "sign-in",
            `${clean.pathname}${clean.search}`
          );
          if (retry) {
            return withStagingNoEdgeCache(NextResponse.redirect(retry, 307));
          }
        }
      }
    }

    if (isProtectedRoute(req)) {
      await auth.protect();
    }

    // ---------------------------------------------------------------------------
    // R-14: MUTATION BACKSTOP — defense-in-depth for /api/* state changes.
    // ---------------------------------------------------------------------------
    // Every API handler is responsible for its own auth (see SECURITY MODEL below).
    // This backstop is a second line of defense: block any POST/PUT/PATCH/DELETE
    // to /api/* that arrives with NO auth signal at all (no Clerk session cookie
    // and no Authorization header). A legitimate caller is always one of:
    //   a) A signed-in user   → has Clerk session cookies (__session / __client_uat)
    //   b) A cron/service job → has Authorization: Bearer <CRON_SECRET>
    //   c) A webhook (Whop, Clerk) → whitelisted above (own HMAC verification)
    // Anything else is anonymous mutation traffic that no correct client sends.
    //
    // Implementation note: we only check for the PRESENCE of auth signals here —
    // full validation (JWT verification / HMAC check) happens per-handler.
    // This keeps middleware lightweight (no Redis, no network calls) and avoids
    // false-positives on valid requests that carry an auth signal we didn't recognize.
    // ---------------------------------------------------------------------------
    if (
      MUTATION_METHODS.has(req.method) &&
      req.nextUrl.pathname.startsWith("/api/") &&
      !isWebhookRoute(req) &&
      !isPublicTelemetryRoute(req)
    ) {
      const bearer = req.headers.get("authorization") ?? "";
      // A bearer token is present if the header starts with "Bearer " and has a
      // non-trivial payload (≥ 20 chars covers any real secret; < 20 is noise).
      const hasBearerToken = bearer.startsWith("Bearer ") && bearer.length > 27;

      // Clerk sets at least one of these cookies for any active session. We only
      // check presence (not signature) — full JWT validation is the handler's job.
      const hasClerkCookie =
        req.cookies.has("__session") || req.cookies.has("__client_uat");

      if (!hasBearerToken && !hasClerkCookie) {
        return withStagingNoEdgeCache(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        );
      }
    }

    return withStagingNoEdgeCache(NextResponse.next());
  },
  clerkMiddlewareAuthOptions()
);

// ---------------------------------------------------------------------------
// SECURITY MODEL — READ THIS BEFORE ADDING ANY API ROUTE
// ---------------------------------------------------------------------------
// The matcher below makes clerkMiddleware RUN on (almost) all page + API routes,
// but the middleware callback above only ENFORCES auth on the page routes listed
// in `isProtectedRoute`, via auth().protect(). That is the ENTIRE runtime
// behavior — there is no deny-list and no "protected by default".
//
//   PROTECTED by this middleware (Clerk redirect/401):
//     • only the page routes in `isProtectedRoute` above
//       (/dashboard, /flows, /terminal, /heatmap, /nighthawk, /admin, /account)
//
//   BACKSTOP (mutation 401 if no auth signal):
//     • POST/PUT/PATCH/DELETE on /api/* without a Clerk cookie or Bearer header
//     • Excludes /api/webhook/* and /api/webhooks/* (own HMAC verification)
//     • Excludes /api/telemetry/client-error and /api/telemetry/auth-failure
//       (deliberately public — see isPublicTelemetryRoute above; secured by
//       per-IP rate limit + body cap, not session/bearer auth)
//
//   NOT protected by this middleware (callback is a no-op for them):
//     • GET/HEAD/OPTIONS on /api/* — they pass through unguarded here
//     • all other pages (landing, sign-in, etc.)
//     • static assets + /_next/* — excluded by the matcher regex below
//     • WebSocket upgrades — excluded via the `missing` upgrade-header filter
//
// ==> Adding a route to `isProtectedRoute` does nothing for API routes
//     (protect() is for page navigations). Every /api route MUST authorize
//     ITSELF inside its handler. Do not assume the middleware guards it.
//
//   Self-guard helpers (call one at the top of each API handler):
//     • requireTierApi(minTier) ........ src/lib/market-api-auth.ts
//     • isCronAuthorized(req) ........... src/lib/market-api-auth.ts
//     • authorizeCronOrTierApi(req,…) ... src/lib/market-api-auth.ts
//     • authorizeMarketDeskApi(req) ..... src/lib/market-api-auth.ts
//     • requireAdminApi() ............... src/lib/admin-access.ts
//
//   A genuinely public API route is one that intentionally calls none of the
//   above. Make that choice explicitly per handler; "not listed here" is NOT a
//   security boundary for API routes.
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    // Match all routes except Next.js internals and static assets.
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    // Also explicitly match API/tRPC routes.
    {
      source: "/(api|trpc)(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    {
      source: "/__clerk/(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
  ],
};
