/** Shared query-param validation for admin playbook routes. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAdminSessionDate(
  raw: string | null | undefined,
  fallback: string
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw ?? fallback;
  if (!ISO_DATE.test(value)) {
    return { ok: false, error: "session must be YYYY-MM-DD" };
  }
  return { ok: true, value };
}

export function parseAdminSinceDate(
  raw: string | null | undefined
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  if (!ISO_DATE.test(raw)) {
    return { ok: false, error: "since must be YYYY-MM-DD" };
  }
  return { ok: true, value: raw };
}
