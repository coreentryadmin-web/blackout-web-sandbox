import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/flows",
  "/terminal",
  "/heatmap",
  "/nighthawk",
  "/vector",
  "/admin",
  "/account",
];

export const WEBHOOK_PREFIXES = ["/api/webhook/", "/api/webhooks/"];

export const PUBLIC_TELEMETRY_PATHS = new Set([
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

export const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const IS_STAGING =
  (process.env.NEXT_PUBLIC_SITE_URL ?? "").includes("staging.") ||
  process.env.SENTRY_ENVIRONMENT === "staging";

export function withStagingNoEdgeCache(res: NextResponse): NextResponse {
  if (!IS_STAGING) return res;
  res.headers.set("CDN-Cache-Control", "no-store");
  res.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  res.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return res;
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isWebhookPath(pathname: string): boolean {
  return WEBHOOK_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isAuthExemptPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/cognito/");
}

export function hasBearerToken(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization") ?? "";
  return bearer.startsWith("Bearer ") && bearer.length > 27;
}

export const middlewareConfig = {
  matcher: [
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
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
