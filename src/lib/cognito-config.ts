/** Cognito pool IDs are `{region}_{suffix}` — derive region when AWS_REGION is unset. */
export function cognitoRegionFromPoolId(userPoolId: string): string | null {
  const idx = userPoolId.indexOf("_");
  if (idx <= 0) return null;
  return userPoolId.slice(0, idx);
}

export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
  domain: string;
  siteUrl: string;
};

export function cognitoConfig(): CognitoConfig | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const clientId = process.env.COGNITO_CLIENT_ID?.trim();
  const domain = process.env.COGNITO_DOMAIN?.trim();
  if (!userPoolId || !clientId || !domain) return null;

  const region = cognitoRegionFromPoolId(userPoolId) || process.env.AWS_REGION?.trim() || "";
  if (!region) return null;
  const siteUrl = resolvePublicSiteUrl();

  return {
    region,
    userPoolId,
    clientId,
    clientSecret: process.env.COGNITO_CLIENT_SECRET?.trim() ?? "",
    domain,
    siteUrl,
  };
}

/** Public origin for OAuth redirects — never use container bind address (0.0.0.0). */
export function resolvePublicSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (raw && !/0\.0\.0\.0|127\.0\.0\.1|localhost/i.test(raw)) return raw;
  if ((process.env.SENTRY_ENVIRONMENT ?? "") === "staging") {
    return "https://staging.blackouttrades.com";
  }
  return "https://blackouttrades.com";
}

export function publicSiteUrl(path = ""): URL {
  const base = resolvePublicSiteUrl();
  return new URL(path.startsWith("/") ? path : `/${path}`, base);
}

export function cognitoIssuer(cfg: CognitoConfig): string {
  return `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`;
}

export function cognitoHostedUiBase(cfg: CognitoConfig): string {
  return `https://${cfg.domain}.auth.${cfg.region}.amazoncognito.com`;
}

export function cognitoRedirectUri(cfg: CognitoConfig): string {
  return `${cfg.siteUrl}/api/auth/cognito/callback`;
}

export function cognitoAuthorizeUrl(cfg: CognitoConfig, opts?: { signup?: boolean; state?: string }): string {
  const base = cognitoHostedUiBase(cfg);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: cognitoRedirectUri(cfg),
  });
  if (opts?.state) params.set("state", opts.state);
  if (opts?.signup) params.set("screen_hint", "signup");
  return `${base}/oauth2/authorize?${params.toString()}`;
}

export function cognitoLogoutUrl(cfg: CognitoConfig, logoutUri?: string): string {
  const base = cognitoHostedUiBase(cfg);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    logout_uri: logoutUri ?? cfg.siteUrl,
  });
  return `${base}/logout?${params.toString()}`;
}

export function cognitoTokenEndpoint(cfg: CognitoConfig): string {
  return `${cognitoHostedUiBase(cfg)}/oauth2/token`;
}
