import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { markMembershipRevoked } from "@/lib/whop-revocation";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { recordApiCall } from "@/lib/api-telemetry";

// Telemetry endpoint label for the API ops dashboard. Recorded under the
// `blackout_engine` provider (same convention as recordAdminRouteError) so the
// Whop webhook stops being a blind spot in /admin api health.
const WHOP_WEBHOOK_ENDPOINT = "webhook/whop";

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
  const startedAt = Date.now();
  if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    // Return 200 so Whop does not retry-loop or blacklist this endpoint.
    // The startup warning above already alerts the operator.
    console.error(
      "[whop webhook] CRITICAL: REQUEST DROPPED — WHOP_WEBHOOK_SECRET is missing. " +
      "Returning 200 to prevent Whop retry storms. Fix the env var to restore processing."
    );
    // Emit a LOUD, alertable signal so this does not stay silent at 200. Fire-and-forget
    // (matches cron-run.ts) so we still return fast and never block/throw on the webhook
    // path; notifyOpsDiscord self-guards on a missing URL.
    void notifyOpsDiscord({
      title: "Whop webhook DROPPED — WHOP_WEBHOOK_SECRET unset",
      body: "Incoming Whop webhooks are being acknowledged (HTTP 200) but NOT verified or processed. Membership changes are being silently lost. Set WHOP_WEBHOOK_SECRET to restore processing.",
      severity: "critical",
    }).catch(() => undefined);
    // Telemetry only (the critical Discord alert above is intentionally NOT duplicated).
    // Record as a failure even though we return HTTP 200: the delivery is dropped/lost.
    recordApiCall({
      provider: "blackout_engine",
      endpoint: WHOP_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 200,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "webhook_secret_not_configured",
      phase: "failure",
    });
    return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
  }

  const whop = getWhopWebhookClient();
  const body = await req.text();

  // Signature verification is performed by whop.webhooks.unwrap() below. The Whop SDK
  // uses the Standard Webhooks scheme (webhook-id / webhook-timestamp / webhook-signature,
  // NOT x-whop-signature): unwrap() throws when any of those headers is missing or the
  // HMAC doesn't match, and the catch returns 400. There is no silent-skip path, so a
  // pre-check on x-whop-signature would be wrong (that header plays no role here) and
  // would 401 legitimate signed deliveries.

  const headers = Object.fromEntries(req.headers);

  let event;
  try {
    event = whop.webhooks.unwrap(body, { headers });
  } catch {
    recordApiCall({
      provider: "blackout_engine",
      endpoint: WHOP_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 400,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "invalid_webhook_signature",
      phase: "failure",
    });
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "membership.activated" ||
      event.type === "membership.deactivated"
    ) {
      const email = event.data.user?.email;
      if (email) {
        await syncWhopMembershipForEmail(email);
      } else {
        // Whop returns user.email === null when this app lacks the `member:email:read`
        // permission (or the user was deleted). syncWhopMembershipForEmail AND the
        // reconcile cron both key ONLY on email, so with no email we can neither sync
        // nor self-heal — the membership change is silently lost. Log a WARNING so the
        // missing permission surfaces (there is no id-based heal path today). Grant
        // member:email:read on the Whop app to populate user.email.
        console.warn(
          "[whop webhook] " + event.type + ": user.email is missing (null). This app likely " +
            "lacks the `member:email:read` permission, so the membership change cannot be synced " +
            "and the reconcile cron cannot heal it (both key on email). whop_user_id=" +
            (event.data.user?.id ?? "unknown") + ". Grant member:email:read on the Whop app to fix."
        );
        // Same loud-signal pattern as the missing-secret path: this membership change is
        // silently lost (no id-based heal exists), so surface it via ops alerts.
        void notifyOpsDiscord({
          title: "Whop webhook: membership change LOST — user.email is null",
          body:
            event.type +
            " could not be synced because user.email is null (app likely lacks member:email:read; reconcile cron keys on email so it cannot heal). whop_user_id=" +
            (event.data.user?.id ?? "unknown") +
            ". Grant member:email:read on the Whop app.",
          severity: "warning",
        }).catch(() => undefined);
      }
    } else if (
      event.type === "refund.created" ||
      event.type === "refund.updated" ||
      event.type === "dispute.created" ||
      event.type === "dispute.updated"
    ) {
      // Refund / chargeback (audit launch-path #6): revoke the affected membership so it stops granting
      // premium even if Whop leaves a one-time ("completed") purchase in 'completed'. The reconcile cron
      // re-resolves the owner within the hour (now excluding the revoked id) → downgrade; we also attempt
      // an immediate re-sync if the owner's email is reachable in the payload.
      const data = event.data as unknown as {
        membership?: { id?: string } | string;
        payment?: { membership?: { id?: string } | string; member?: { email?: string | null } };
        user?: { email?: string | null };
        member?: { email?: string | null };
      };
      const mRaw = data?.membership ?? data?.payment?.membership;
      const membershipId = typeof mRaw === "string" ? mRaw : mRaw?.id;
      const email = data?.user?.email ?? data?.member?.email ?? data?.payment?.member?.email ?? null;
      if (membershipId) await markMembershipRevoked(membershipId);
      if (email) await syncWhopMembershipForEmail(email);
      void notifyOpsDiscord({
        title: "Whop refund/dispute — entitlement revoked",
        body:
          event.type +
          ": membership=" +
          (membershipId ?? "unknown") +
          " added to the revocation denylist (premium revoked). Owner " +
          (email ? "re-synced now" : "will be downgraded by the reconcile cron") +
          ". Verify in Whop.",
        severity: "warning",
      }).catch(() => undefined);
    }
  } catch (error) {
    console.error("[whop webhook]", event.type, error);
    recordApiCall({
      provider: "blackout_engine",
      endpoint: WHOP_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 500,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: `handler_failed: ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
      phase: "failure",
    });
    // Surface billing-state handler failures in ops. Fire-and-forget (void + .catch,
    // matching the alerts above) so it never blocks/throws on the response path;
    // notifyOpsDiscord self-guards on a missing webhook URL.
    void notifyOpsDiscord({
      title: "Whop webhook handler FAILED (500)",
      body:
        "Processing of a Whop webhook threw — membership state may be stale. event.type=" +
        event.type +
        ". error=" +
        (error instanceof Error ? error.message : String(error)),
      severity: "critical",
    }).catch(() => undefined);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  recordApiCall({
    provider: "blackout_engine",
    endpoint: WHOP_WEBHOOK_ENDPOINT,
    method: "POST",
    status: 200,
    ok: true,
    latency_ms: Date.now() - startedAt,
  });
  return NextResponse.json({ ok: true });
}
