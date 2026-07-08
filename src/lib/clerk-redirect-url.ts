/**
 * Post-auth return URLs for primary → staging satellite handoff.
 */

const STAGING_ORIGIN = "https://staging.blackouttrades.com";

/** Strip failed-sync noise; only allow returns to staging. */
export function clerkSanitizeStagingReturnUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return `${STAGING_ORIGIN}${trimmed}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.origin !== STAGING_ORIGIN) return null;
    url.searchParams.delete("__clerk_synced");
    url.searchParams.delete("__clerk_db_jwt");
    return url.toString();
  } catch {
    return null;
  }
}

/** Path on staging for satellite redirect helper (must start with /). */
export function clerkStagingReturnPath(raw: string | undefined | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "/dashboard";
  if (trimmed.startsWith("/")) {
    try {
      const u = new URL(trimmed, STAGING_ORIGIN);
      u.searchParams.delete("__clerk_synced");
      return `${u.pathname}${u.search}`;
    } catch {
      return trimmed;
    }
  }
  const full = clerkSanitizeStagingReturnUrl(trimmed);
  if (!full) return "/dashboard";
  const u = new URL(full);
  return `${u.pathname}${u.search}`;
}

export function clerkIsClerkSyncFailed(url: URL): boolean {
  return url.searchParams.get("__clerk_synced") === "false";
}
