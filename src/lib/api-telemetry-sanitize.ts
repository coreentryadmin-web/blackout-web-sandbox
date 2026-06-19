/** Client-safe URL/body redaction for API telemetry display and persist. */

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
