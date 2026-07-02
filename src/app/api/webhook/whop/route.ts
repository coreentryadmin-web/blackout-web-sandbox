import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { markMembershipRevoked } from "@/lib/whop-revocation";
import {
  clearMembershipDunningGrace,
  markMembershipDunningGrace,
} from "@/lib/whop-dunning";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { recordApiCall } from "@/lib/api-telemetry";
import { makeRedis } from "@/lib/make-redis";
import { publishTierChanged } from "@/lib/tier-cache";

/**
 * Idempotency CLAIM: atomically mark a Whop event as "being processed" (Redis SET NX,
 * 24h TTL). Returns true if this delivery is the first to claim it — the caller MUST then
 * either leave the key in place on success, or call `releaseWhopEventClaim` on failure.
 *
 * The claim happens BEFORE processing (not after) so two genuinely-concurrent duplicate
 * deliveries of the same event can't both pass the check and double-process. The tradeoff
 * this used to create — a failed (500) attempt left the key claimed forever, so Whop's
 * retry of the SAME event silently ack'd as "duplicate" and the side effect (tier sync,
 * revocation, dunning grace) never actually ran — is fixed by releasing the claim in the
 * route's catch block on failure, so a genuine retry after an error gets reprocessed
 * instead of permanently swallowed. See docs/audit/FINDINGS.md for the live-traced bug.
 */
async function claimWhopEvent(eventId: string): Promise<boolean> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return true; // no Redis → can't deduplicate, always proceed
  try {
    const redis = await makeRedis("whop-idempotency", url, { maxRetriesPerRequest: 1, connectTimeoutMs: 1_500 });
    const key = `whop:event:${eventId}`;
    const result = await redis.set(key, "1", "EX", 86_400, "NX");
    await redis.quit().catch(() => undefined);
    return result === "OK"; // OK → first (unclaimed) delivery; null → already claimed
  } catch (err) {
    console.warn("[whop webhook] idempotency claim failed (Redis unavailable) — proceeding:", err);
    return true; // fail-open: if Redis is down, process anyway
  }
}

/**
 * Release a Whop event's idempotency claim after its processing FAILED, so the next retry
 * (Whop retries on 5xx) can reclaim and actually reprocess it instead of being silently
 * ack'd as a duplicate of an attempt that never succeeded.
 */
async function releaseWhopEventClaim(eventId: string): Promise<void> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return;
  try {
    const redis = await makeRedis("whop-idempotency", url, { maxRetriesPerRequest: 1, connectTimeoutMs: 1_500 });
    await redis.del(`whop:event:${eventId}`);
    await redis.quit().catch(() => undefined);
  } catch (err) {
    console.warn("[whop webhook] failed to release idempotency claim (Redis unavailable) — a retry of this event may be dropped as a false duplicate until the 24h TTL expires:", err);
  }
}

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

function extractMembershipAndEmail(data: unknown): {
  membershipId: string | null;
  email: string | null;
} {
  const d = data as {
    membership?: { id?: string } | string;
    payment?: { membership?: { id?: string } | string; member?: { email?: string | null } };
    user?: { email?: string | null };
    member?: { email?: string | null };
  };
  const mRaw = d?.membership ?? d?.payment?.membership;
  const membershipId = typeof mRaw === "string" ? mRaw : (mRaw?.id ?? null);
  const email = d?.user?.email ?? d?.member?.email ?? d?.payment?.member?.email ?? null;
  return { membershipId, email };
}

async function syncEmailTier(email: string | null): Promise<void> {
  if (!email) return;
  const { updatedUserIds } = await syncWhopMembershipForEmail(email);
  for (const uid of updatedUserIds) publishTierChanged(uid);
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
    // In PRODUCTION a dropped delivery is unrecoverable (a refund/dispute that never replays
    // leaks premium or strands a lockout), so we must NOT 200-ACK and discard. Return a 5xx
    // instead: Whop treats it as a transient failure and RETRIES with backoff until the secret
    // is configured, so no billing event is permanently lost. Outside production (local/preview)
    // keep the old 200-ACK so a missing secret never blocks dev work.
    const isProd = process.env.NODE_ENV === "production";
    console.error(
      "[whop webhook] CRITICAL: WHOP_WEBHOOK_SECRET is missing. " +
      (isProd
        ? "Returning 503 so Whop RETRIES (no billing event is dropped) until the secret is set."
        : "Non-production: acknowledging with 200 (dev convenience). Fix the env var to enable processing.")
    );
    // Emit a LOUD, alertable signal so this does not stay silent. Fire-and-forget
    // (matches cron-run.ts) so we still return fast and never block/throw on the webhook
    // path; notifyOpsDiscord self-guards on a missing URL.
    void notifyOpsDiscord({
      title: "Whop webhook UNVERIFIED — WHOP_WEBHOOK_SECRET unset",
      body: isProd
        ? "Incoming Whop webhooks cannot be verified (WHOP_WEBHOOK_SECRET unset). Returning 503 so Whop RETRIES until the secret is configured — no membership/refund event is dropped, but processing is stalled. Set WHOP_WEBHOOK_SECRET now."
        : "Non-production: Whop webhooks are being acknowledged (HTTP 200) but NOT verified or processed. Set WHOP_WEBHOOK_SECRET to enable handling.",
      severity: "critical",
    }).catch(() => undefined);
    // Telemetry only (the critical Discord alert above is intentionally NOT duplicated).
    // Record as a failure — in prod the delivery is deferred (retryable), in dev it is dropped.
    recordApiCall({
      provider: "blackout_engine",
      endpoint: WHOP_WEBHOOK_ENDPOINT,
      method: "POST",
      status: isProd ? 503 : 200,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "webhook_secret_not_configured",
      phase: "failure",
    });
    if (isProd) {
      // 503 (not 4xx): Whop only retries on 5xx; a 4xx would be treated as a permanent reject
      // and the event would be dropped — exactly what we are fixing.
      return NextResponse.json(
        { error: "webhook_secret_not_configured", retryable: true },
        { status: 503 }
      );
    }
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

  // Idempotency: if this event is already claimed by another delivery, ack and skip.
  // The Redis key `whop:event:{id}` is SET NX with 24h TTL; a null result means already claimed.
  // On failure below, the claim is released so a genuine Whop retry (on 5xx) is reprocessed
  // rather than permanently swallowed as a duplicate of an attempt that never succeeded.
  const eventId = (event as unknown as { id?: string }).id;
  if (eventId) {
    const isFirst = await claimWhopEvent(eventId);
    if (!isFirst) {
      console.log("[whop webhook] duplicate event", eventId, event.type, "— already processed, acking");
      recordApiCall({
        provider: "blackout_engine",
        endpoint: WHOP_WEBHOOK_ENDPOINT,
        method: "POST",
        status: 200,
        ok: true,
        latency_ms: Date.now() - startedAt,
      });
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Defense-in-depth: the signature already proves the payload was signed with OUR webhook secret,
  // but if that secret were ever reused across companies, assert the event targets our company so a
  // foreign delivery can't drive entitlement changes. Unknown/absent company_id is allowed (ack-drop
  // only on a definite mismatch) so we never reject a legitimately-signed event over a missing field.
  const expectedCompanyId = process.env.WHOP_COMPANY_ID?.trim();
  if (expectedCompanyId && event.company_id && event.company_id !== expectedCompanyId) {
    console.warn(
      "[whop webhook] dropping event for foreign company_id=" +
        event.company_id +
        " (expected " +
        expectedCompanyId +
        "), type=" +
        event.type
    );
    return NextResponse.json({ ok: true, dropped: "company_mismatch" }, { status: 200 });
  }

  try {
    if (
      event.type === "membership.activated" ||
      event.type === "membership.deactivated" ||
      // A user toggling "cancel at period end" — re-sync so the grace/canceling status is reflected
      // in real time instead of waiting for the hourly reconcile to observe the eventual deactivation.
      event.type === "membership.cancel_at_period_end_changed"
    ) {
      const email = event.data.user?.email;
      if (email) {
        const { updatedUserIds } = await syncWhopMembershipForEmail(email);
        // Evict tier cache on all replicas immediately so premium/downgrade is visible
        // within the next request rather than waiting up to 60s for TTL expiry.
        for (const uid of updatedUserIds) publishTierChanged(uid);
        if (event.type === "membership.deactivated" && event.data.id) {
          await clearMembershipDunningGrace(event.data.id);
        }
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
      if (email) {
        const { updatedUserIds } = await syncWhopMembershipForEmail(email);
        for (const uid of updatedUserIds) publishTierChanged(uid);
      }
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
    } else if (
      event.type === "payment.failed" ||
      event.type === "invoice.past_due"
    ) {
      const { membershipId, email } = extractMembershipAndEmail(event.data);
      if (membershipId) await markMembershipDunningGrace(membershipId);
      await syncEmailTier(email);
      void notifyOpsDiscord({
        title: "Whop payment failed — dunning grace started",
        body:
          event.type +
          ": membership=" +
          (membershipId ?? "unknown") +
          " entered billing-retry grace. Owner " +
          (email ? "re-synced now" : "will be reconciled on the hourly cron") +
          ".",
        severity: "warning",
      }).catch(() => undefined);
    } else if (
      event.type === "invoice.marked_uncollectible" ||
      event.type === "invoice.voided"
    ) {
      const { membershipId, email } = extractMembershipAndEmail(event.data);
      if (membershipId) {
        await markMembershipRevoked(membershipId);
        await clearMembershipDunningGrace(membershipId);
      }
      await syncEmailTier(email);
      void notifyOpsDiscord({
        title: "Whop invoice uncollectible/voided — premium revoked",
        body:
          event.type +
          ": membership=" +
          (membershipId ?? "unknown") +
          " revoked. Owner " +
          (email ? "re-synced now" : "will be downgraded by the reconcile cron") +
          ".",
        severity: "warning",
      }).catch(() => undefined);
    } else if (event.type === "invoice.paid" || event.type === "payment.succeeded") {
      const { membershipId, email } = extractMembershipAndEmail(event.data);
      if (membershipId) await clearMembershipDunningGrace(membershipId);
      await syncEmailTier(email);
    }
  } catch (error) {
    console.error("[whop webhook]", event.type, error);
    // Release the idempotency claim BEFORE returning the 500 — otherwise Whop's retry of
    // this exact event finds the key still claimed, silently acks as "duplicate", and the
    // side effect that actually failed (tier sync / revocation / dunning grace) never runs.
    if (eventId) await releaseWhopEventClaim(eventId);
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
