import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cognitoAuthorizeUrl, cognitoConfig } from "@/lib/cognito-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeOAuthState(returnPath: string): string {
  const safe = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/dashboard";
  return Buffer.from(JSON.stringify({ returnPath: safe }), "utf8").toString("base64url");
}

export async function GET(req: NextRequest) {
  const cfg = cognitoConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Cognito not configured" }, { status: 500 });
  }

  const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard";
  const signup = req.nextUrl.searchParams.get("mode") === "signup";
  const state = encodeOAuthState(returnPath);
  const url = cognitoAuthorizeUrl(cfg, { signup, state });
  return NextResponse.redirect(url);
}
