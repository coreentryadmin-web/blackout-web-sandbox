import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cognitoAuthorizeUrl, cognitoConfig, publicSiteUrl } from "@/lib/cognito-config";
import {
  cognitoHasSessionCookie,
  getCognitoSessionFromRequest,
} from "@/lib/cognito-session";
import {
  hasBearerToken,
  isAuthExemptPath,
  isProtectedPath,
  isWebhookPath,
  MUTATION_METHODS,
  PUBLIC_TELEMETRY_PATHS,
  withStagingNoEdgeCache,
} from "@/middleware-shared";

function encodeOAuthState(returnPath: string): string {
  return Buffer.from(JSON.stringify({ returnPath }), "utf8").toString("base64url");
}

function cognitoLoginRedirect(req: NextRequest, returnPath: string, signup = false): NextResponse {
  const cfg = cognitoConfig();
  if (!cfg) {
    return withStagingNoEdgeCache(
      NextResponse.json({ error: "Cognito not configured" }, { status: 500 })
    );
  }
  const state = encodeOAuthState(returnPath);
  const url = cognitoAuthorizeUrl(cfg, { signup, state });
  return withStagingNoEdgeCache(NextResponse.redirect(url));
}

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path === "/sign-in" || path.startsWith("/sign-in/")) {
    const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard";
    return cognitoLoginRedirect(req, returnPath, false);
  }
  if (path === "/sign-up" || path.startsWith("/sign-up/")) {
    const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard";
    return cognitoLoginRedirect(req, returnPath, true);
  }

  if (isProtectedPath(path) && !isAuthExemptPath(path)) {
    const session = await getCognitoSessionFromRequest(req);
    if (!session) {
      const signIn = publicSiteUrl("/sign-in");
      signIn.searchParams.set("redirect_url", `${path}${req.nextUrl.search}`);
      return withStagingNoEdgeCache(NextResponse.redirect(signIn));
    }
  }

  if (
    MUTATION_METHODS.has(req.method) &&
    path.startsWith("/api/") &&
    !isWebhookPath(path) &&
    !PUBLIC_TELEMETRY_PATHS.has(path) &&
    !isAuthExemptPath(path)
  ) {
    const hasSession = cognitoHasSessionCookie(req);
    if (!hasBearerToken(req) && !hasSession) {
      return withStagingNoEdgeCache(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
  }

  return withStagingNoEdgeCache(NextResponse.next());
}
