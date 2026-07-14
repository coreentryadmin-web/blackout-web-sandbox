import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  cognitoConfig,
  cognitoIssuer,
  type CognitoConfig,
} from "@/lib/cognito-config";

export const COGNITO_ID_COOKIE = "bo_cognito_id";
export const COGNITO_REFRESH_COOKIE = "bo_cognito_refresh";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(cfg: CognitoConfig) {
  const issuer = cognitoIssuer(cfg);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

export type CognitoSessionClaims = JWTPayload & {
  sub?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  "custom:role"?: string;
  "custom:tier"?: string;
};

export async function verifyCognitoIdToken(
  token: string,
  cfg?: CognitoConfig | null
): Promise<CognitoSessionClaims | null> {
  const config = cfg ?? cognitoConfig();
  if (!config || !token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(config), {
      issuer: cognitoIssuer(config),
      audience: config.clientId,
    });
    return payload as CognitoSessionClaims;
  } catch (err) {
    console.warn("[cognito-session] JWT verify failed:", err);
    return null;
  }
}

export async function getCognitoIdTokenFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COGNITO_ID_COOKIE)?.value ?? null;
}

export async function getCognitoSession(): Promise<{
  userId: string;
  claims: CognitoSessionClaims;
} | null> {
  const token = await getCognitoIdTokenFromCookies();
  if (!token) return null;
  const claims = await verifyCognitoIdToken(token);
  if (!claims?.sub) return null;
  return { userId: claims.sub, claims };
}

export function getCognitoIdTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(COGNITO_ID_COOKIE)?.value ?? null;
}

export async function getCognitoSessionFromRequest(
  req: NextRequest
): Promise<{ userId: string; claims: CognitoSessionClaims } | null> {
  const token = getCognitoIdTokenFromRequest(req);
  if (!token) return null;
  const claims = await verifyCognitoIdToken(token);
  if (!claims?.sub) return null;
  return { userId: claims.sub, claims };
}

export function cognitoHasSessionCookie(req: NextRequest): boolean {
  return req.cookies.has(COGNITO_ID_COOKIE);
}

export function cognitoCookieOptions(maxAgeSec: number) {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}
