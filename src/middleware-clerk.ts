import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkMiddlewareAuthOptions, clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkIsClerkSyncFailed } from "@/lib/clerk-redirect-url";
import {
  IS_STAGING,
  MUTATION_METHODS,
  PUBLIC_TELEMETRY_PATHS,
  withStagingNoEdgeCache,
} from "@/middleware-shared";

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

const isWebhookRoute = createRouteMatcher(["/api/webhook/(.*)", "/api/webhooks/(.*)"]);
const isPublicTelemetryRoute = createRouteMatcher([
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (IS_STAGING && process.env.AUTH_PROVIDER !== "cognito") {
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

    if (
      MUTATION_METHODS.has(req.method) &&
      req.nextUrl.pathname.startsWith("/api/") &&
      !isWebhookRoute(req) &&
      !isPublicTelemetryRoute(req)
    ) {
      const bearer = req.headers.get("authorization") ?? "";
      const hasBearerToken = bearer.startsWith("Bearer ") && bearer.length > 27;
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

export { PUBLIC_TELEMETRY_PATHS };
