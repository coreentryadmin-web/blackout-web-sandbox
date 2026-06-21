/** Client-safe URL/body/header redaction for API telemetry display and persist. */

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["apiKey", "token", "apikey", "key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return url
      .replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]")
      .replace(/token=[^&]+/gi, "token=[REDACTED]")
      .replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
  }
}

/**
 * Header names that carry credentials and must not be persisted in telemetry.
 * The names are matched case-insensitively.
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-blackout-key",
  "x-engine-secret",
  "x-api-key",
  "cookie",
  "set-cookie",
]);

/**
 * Returns only the header *names* that are safe to log, stripping any header
 * whose name appears in SENSITIVE_HEADERS.
 */
export function sanitizeHeaderNames(headers: string[]): string[] {
  return headers.filter((h) => !SENSITIVE_HEADERS.has(h.toLowerCase()));
}

export function sanitizeTelemetryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return sanitizeUrl(url);
}

export function sanitizeTelemetryBody(body: string | null | undefined): string | null {
  if (!body) return null;
  return body
    .replace(/apiKey=[^&\s"']+/gi, "apiKey=[REDACTED]")
    .replace(/token=[^&\s"']+/gi, "token=[REDACTED]")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]");
}

export function sanitizeUrlForTelemetry(url: string): string {
  return sanitizeUrl(url);
}

export const sanitizeTrackedFetchUrl = sanitizeUrlForTelemetry;
