/**
 * Clerk redirect allowlist — production Clerk on staging needs explicit self-origin.
 * NEXT_PUBLIC_* is inlined at Docker build time; runtime ECS env does not reach client bundles.
 */
export function clerkAllowedRedirectOrigins(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!site) return undefined;
  // Staging build: must allow OAuth/session return to staging (was undefined → sign-in broken).
  if (site.includes("staging.")) {
    return [site];
  }
  // Production build: also allow post-auth redirects back to staging for cross-env testing.
  return ["https://staging.blackouttrades.com"];
}

export function clerkFrontendApiHost(): string {
  return "https://clerk.blackouttrades.com";
}
