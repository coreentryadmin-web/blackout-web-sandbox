/**
 * Clerk env helpers — staging shares production keys on a satellite hostname.
 * NEXT_PUBLIC_* is inlined at Docker build time; runtime ECS env does not reach client bundles.
 */

const PRIMARY_ORIGIN = "https://blackouttrades.com";

export function isStagingDeploy(): boolean {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").includes("staging.");
}

/** Production Clerk on staging.blackouttrades.com runs as a satellite of blackouttrades.com. */
export function clerkIsSatellite(): boolean {
  if (process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true") return true;
  if (process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "false") return false;
  return isStagingDeploy();
}

/** Proxy replaces domain when clerk.staging CNAME is unavailable — see Clerk satellite proxy docs. */
export function clerkProxyUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (raw) return raw;
  if (clerkIsSatellite() && isStagingDeploy()) {
    return "https://staging.blackouttrades.com/__clerk";
  }
  return undefined;
}

export function clerkSatelliteDomain(): string | undefined {
  if (!clerkIsSatellite() || clerkProxyUrl()) return undefined;
  const raw = process.env.NEXT_PUBLIC_CLERK_DOMAIN?.trim();
  if (raw) return raw;
  if (isStagingDeploy()) return "staging.blackouttrades.com";
  return undefined;
}

export function clerkPrimarySignInUrl(): string {
  const raw = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL?.trim();
  if (raw?.startsWith("http")) return raw;
  if (clerkIsSatellite()) return `${PRIMARY_ORIGIN}/sign-in`;
  return raw || "/sign-in";
}

export function clerkPrimarySignUpUrl(): string {
  const raw = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL?.trim();
  if (raw?.startsWith("http")) return raw;
  if (clerkIsSatellite()) return `${PRIMARY_ORIGIN}/sign-up`;
  return raw || "/sign-up";
}

/** Where to send the user after auth on primary when they started on staging. */
export function clerkStagingReturnOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://staging.blackouttrades.com").replace(/\/+$/, "");
}

/**
 * Satellite staging cannot run embedded SignIn/OAuth — Clerk blocks "operation on satellite domain".
 * Redirect to primary sign-in/sign-up with redirect_url back to staging.
 */
export function clerkSatelliteAuthRedirect(
  mode: "sign-in" | "sign-up",
  returnPath = "/dashboard"
): string | null {
  if (!clerkIsSatellite() || !isStagingDeploy()) return null;
  const base = mode === "sign-in" ? clerkPrimarySignInUrl() : clerkPrimarySignUpUrl();
  const returnTo = `${clerkStagingReturnOrigin()}${returnPath.startsWith("/") ? returnPath : `/${returnPath}`}`;
  return `${base}?redirect_url=${encodeURIComponent(returnTo)}`;
}

export function clerkAllowedRedirectOrigins(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!site) return undefined;
  if (site.includes("staging.")) {
    return [site];
  }
  return ["https://staging.blackouttrades.com"];
}

export function clerkFrontendApiHost(): string {
  if (clerkProxyUrl()) return clerkProxyUrl()!;
  if (clerkIsSatellite() && isStagingDeploy()) {
    return "https://clerk.staging.blackouttrades.com";
  }
  return "https://clerk.blackouttrades.com";
}

export type ClerkSatelliteProviderProps = {
  isSatellite?: true;
  domain?: string;
  proxyUrl?: string;
  signInUrl?: string;
  signUpUrl?: string;
};

/** Props for ClerkProvider on satellite (staging) builds. */
export function clerkSatelliteProviderProps(): ClerkSatelliteProviderProps {
  if (!clerkIsSatellite()) return {};
  const proxyUrl = clerkProxyUrl();
  const domain = clerkSatelliteDomain();
  return {
    isSatellite: true,
    signInUrl: clerkPrimarySignInUrl(),
    signUpUrl: clerkPrimarySignUpUrl(),
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(domain ? { domain } : {}),
  };
}

export type ClerkMiddlewareAuthOptions = {
  clockSkewInMs: number;
  isSatellite?: boolean;
  domain?: string;
  proxyUrl?: string;
  signInUrl?: string;
  signUpUrl?: string;
  frontendApiProxy?: { enabled: boolean; path?: string };
};

/** Second argument to clerkMiddleware() — satellite + FAPI proxy on staging. */
export function clerkMiddlewareAuthOptions(): ClerkMiddlewareAuthOptions {
  const base: ClerkMiddlewareAuthOptions = { clockSkewInMs: 10_000 };
  if (!clerkIsSatellite()) return base;

  const proxyUrl = clerkProxyUrl();
  const domain = clerkSatelliteDomain();

  return {
    ...base,
    isSatellite: true,
    signInUrl: clerkPrimarySignInUrl(),
    signUpUrl: clerkPrimarySignUpUrl(),
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(domain ? { domain } : {}),
    ...(proxyUrl ? { frontendApiProxy: { enabled: true } } : {}),
  };
}
