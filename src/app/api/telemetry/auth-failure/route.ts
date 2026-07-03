// POST /api/telemetry/auth-failure — public, unauthenticated beacon for
// failed Clerk sign-in/sign-up attempts. Same shape as client-error/route.ts.
//
// WHY THIS EXISTS (BIE Stage 3, "security warnings / auth failure monitoring"):
// Clerk has no webhook event or Backend API endpoint for a failed auth attempt
// (confirmed against their actual docs, not assumed) — the only place this data
// exists is a Dashboard-only "Application Logs" UI with no programmatic access.
// Rather than replace the prebuilt <SignIn>/<SignUp> components with a custom
// useSignIn()-based flow (a large, hard-to-verify rewrite of a revenue-critical
// page with no browser available in this sandbox to test it), AuthFailureObserver
// mounts as a SIBLING to the untouched prebuilt component and watches Clerk's own
// rendered DOM (via MutationObserver) for the error text Clerk already displays
// on a failed attempt. This endpoint never sees a credential — only the visible
// error message text and which page it happened on.
import { NextRequest, NextResponse } from "next/server";
import { captureError } from "@/lib/error-sink";
import { checkIpRateLimit, getClientIp, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { MAX_BODY_BYTES, validateAuthFailureBody, type AuthFailureBody } from "@/lib/auth-failure-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 20/min per IP: generous for a real user fumbling a password a few times,
  // bounded against a scripted flood. Fails open on Redis outage, same
  // documented trade-off as every other public rate limit in this app.
  const rl = await checkIpRateLimit(ip, "public:auth-failure", 20, 60);
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let body: AuthFailureBody;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(raw) as AuthFailureBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const validated = validateAuthFailureBody(body);
  if (!validated) return NextResponse.json({ ok: false }, { status: 400 });

  // Reuses the existing error_events sink (source: "auth_failure") rather than a
  // new table — same admin visibility, same BIE discovery grouping, same prune
  // policy, for free.
  const err = new Error(validated.message);
  err.name = "ClerkAuthFailure";
  void captureError(err, { source: "auth_failure", scope: validated.mode, meta: { ip } });

  return new NextResponse(null, { status: 204, headers: rateLimitHeaders(rl) });
}
