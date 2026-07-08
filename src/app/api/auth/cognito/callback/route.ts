import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  cognitoAuthorizeUrl,
  cognitoConfig,
  cognitoRedirectUri,
  cognitoTokenEndpoint,
  publicSiteUrl,
} from "@/lib/cognito-config";
import {
  COGNITO_ID_COOKIE,
  COGNITO_REFRESH_COOKIE,
  cognitoCookieOptions,
  verifyCognitoIdToken,
} from "@/lib/cognito-session";
import { ensureCognitoUserProvisioned } from "@/lib/user-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeOAuthState(state: string | null): string {
  if (!state) return "/dashboard";
  try {
    const json = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      returnPath?: string;
    };
    const path = json.returnPath ?? "/dashboard";
    if (!path.startsWith("/") || path.startsWith("//")) return "/dashboard";
    return path;
  } catch {
    return "/dashboard";
  }
}

export async function GET(req: NextRequest) {
  const cfg = cognitoConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Cognito not configured" }, { status: 500 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const returnPath = decodeOAuthState(state);

  if (!code) {
    const err = req.nextUrl.searchParams.get("error_description") ?? "Missing code";
    return NextResponse.redirect(publicSiteUrl(`/sign-in?error=${encodeURIComponent(err)}`));
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: cognitoRedirectUri(cfg),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cfg.clientSecret) {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  const tokenRes = await fetch(cognitoTokenEndpoint(cfg), {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error("[cognito/callback] token exchange failed:", tokenRes.status, detail);
    return NextResponse.redirect(publicSiteUrl(`/sign-in?error=${encodeURIComponent("Sign-in failed")}`));
  }

  const tokens = (await tokenRes.json()) as {
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const idToken = tokens.id_token ?? "";
  const claims = await verifyCognitoIdToken(idToken, cfg);
  if (!claims?.sub) {
    return NextResponse.redirect(publicSiteUrl(`/sign-in?error=${encodeURIComponent("Invalid token")}`));
  }

  await ensureCognitoUserProvisioned(
    claims.sub,
    typeof claims.email === "string" ? claims.email : null,
    typeof claims.given_name === "string" ? claims.given_name : null,
    typeof claims.family_name === "string" ? claims.family_name : null
  );

  const maxAge = tokens.expires_in ?? 3600;
  const res = NextResponse.redirect(publicSiteUrl(returnPath));
  res.cookies.set(COGNITO_ID_COOKIE, idToken, cognitoCookieOptions(maxAge));
  if (tokens.refresh_token) {
    res.cookies.set(COGNITO_REFRESH_COOKIE, tokens.refresh_token, cognitoCookieOptions(30 * 86400));
  }
  return res;
}
