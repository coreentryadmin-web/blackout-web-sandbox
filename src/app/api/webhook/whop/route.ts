import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { syncWhopMembershipForEmail } from "@/lib/membership";

function getWhopWebhookClient() {
  return new Whop({
    apiKey: process.env.WHOP_API_KEY,
    webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? null,
  });
}

// Warn once at module load time so the missing var surfaces in startup logs
// even before the first webhook arrives.
if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
  console.error(
    "[whop webhook] STARTUP WARNING: WHOP_WEBHOOK_SECRET is not set. " +
    "Incoming webhooks will be acknowledged (HTTP 200) but NOT verified or processed. " +
    "Set WHOP_WEBHOOK_SECRET in your environment to enable webhook handling."
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    // Return 200 so Whop does not retry-loop or blacklist this endpoint.
    // The startup warning above already alerts the operator.
    console.error(
      "[whop webhook] REQUEST DROPPED: WHOP_WEBHOOK_SECRET is missing. " +
      "Returning 200 to prevent Whop retry storms. Fix the env var to restore processing."
    );
    return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
  }

  const whop = getWhopWebhookClient();
  const body = await req.text();

  // Guard: reject requests that are missing the HMAC signature header entirely.
  // Without this check, some SDK versions silently skip HMAC verification when
  // the header is absent, allowing unauthenticated callers to trigger membership
  // sync for arbitrary email addresses.
  const signatureHeader = req.headers.get("x-whop-signature");
  if (!signatureHeader) {
    console.error("[whop webhook] Rejected: missing x-whop-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const headers = Object.fromEntries(req.headers);

  let event;
  try {
    event = whop.webhooks.unwrap(body, { headers });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "membership.activated" ||
      event.type === "membership.deactivated"
    ) {
      const email = event.data.user?.email;
      if (email) await syncWhopMembershipForEmail(email);
    }
  } catch (error) {
    console.error("[whop webhook]", event.type, error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
