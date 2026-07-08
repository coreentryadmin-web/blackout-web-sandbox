/**
 * Clerk redirect allowlist — prod must accept post-auth redirects back to staging.
 */
export function clerkAllowedRedirectOrigins(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  // Primary (prod) build: allow staging subdomain redirects after OAuth.
  if (site && !site.includes("staging.")) {
    return ["https://staging.blackouttrades.com"];
  }
  return undefined;
}

export function clerkFrontendApiHost(): string {
  return "https://clerk.blackouttrades.com";
}
