// Pure validation/shaping for the public auth-failure beacon
// (src/app/api/telemetry/auth-failure/route.ts). Kept separate from the route
// so it's unit-testable without spinning up a NextRequest — same split as
// client-error-report.ts.

export const MAX_BODY_BYTES = 2_000;
export const MAX_MESSAGE_LEN = 300;

export type AuthFailureBody = {
  message?: unknown;
  mode?: unknown;
};

export type ValidatedAuthFailure = {
  message: string;
  mode: "signin" | "signup";
};

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Returns null when the body has no usable message/mode — caller responds 400.
 *  `message` is Clerk's own rendered error text (DOM-observed, never a credential
 *  by construction — see AuthFailureObserver.tsx, which reads visible text nodes
 *  from Clerk's error UI, not form values). */
export function validateAuthFailureBody(body: AuthFailureBody): ValidatedAuthFailure | null {
  const message = clampString(body.message, MAX_MESSAGE_LEN);
  if (!message) return null;
  if (body.mode !== "signin" && body.mode !== "signup") return null;
  return { message, mode: body.mode };
}
