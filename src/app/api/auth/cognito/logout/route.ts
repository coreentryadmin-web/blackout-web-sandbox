import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cognitoConfig, cognitoLogoutUrl } from "@/lib/cognito-config";
import { COGNITO_ID_COOKIE, COGNITO_REFRESH_COOKIE } from "@/lib/cognito-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = cognitoConfig();
  const jar = await cookies();
  jar.delete(COGNITO_ID_COOKIE);
  jar.delete(COGNITO_REFRESH_COOKIE);

  if (!cfg) {
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  }

  const logoutUri = `${cfg.siteUrl}/`;
  return NextResponse.redirect(cognitoLogoutUrl(cfg, logoutUri));
}
