import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/flows(.*)",
  "/terminal(.*)",
  "/heatmap(.*)",
  "/nighthawk(.*)",
  "/admin(.*)",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  },
  {
    // Tolerate small server/client clock drift so a still-valid ~60s session JWT isn't
    // treated as expired on a soft (RSC) navigation → false /sign-in bounce. Belt-and-
    // suspenders alongside NTP-synced replicas (Clerk default tolerance is 5000ms).
    clockSkewInMs: 10_000,
  }
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
//       (/dashboard, /flows, /terminal, /heatmap, /nighthawk, /admin, /docs)
//
//   NOT protected by this middleware (callback is a no-op for them):
//     • EVERY /api/* and /trpc/* route — they pass through unguarded here
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
  ],
};
