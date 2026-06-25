import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

// Refund / chargeback revocation denylist (audit launch-path #6). A one-time ("completed") Whop
// purchase that is refunded or disputed can stay 'completed' forever, so status alone keeps granting
// premium. The refund.*/dispute.* webhooks add the membership id here; resolveMembershipTierForEmail
// skips any membership on this list, and the hourly reconcile cron then re-resolves the owner to free.
//
// Storage: shared Redis (cross-replica) via shared-cache, with a long TTL — a refund is permanent for
// practical purposes. Caveat: if Redis is wiped the denylist is lost and the membership would re-grant
// premium on the next reconcile; a durable DB table is the future hardening for a rare-event guardrail.

const REVOKED_PREFIX = "whop:revoked:";
const REVOKED_TTL_SEC = 400 * 24 * 60 * 60; // ~400 days — well beyond any reconcile window

/** Mark a membership id as revoked (refunded / charged back). No-op on an empty id. */
export async function markMembershipRevoked(membershipId: string): Promise<void> {
  if (!membershipId) return;
  await sharedCacheSet(REVOKED_PREFIX + membershipId, 1, REVOKED_TTL_SEC);
}

/** True if this membership id has been revoked. Fail-open (false) on a Redis miss/outage. */
export async function isMembershipRevoked(membershipId: string | null | undefined): Promise<boolean> {
  if (!membershipId) return false;
  return (await sharedCacheGet<number>(REVOKED_PREFIX + membershipId)) === 1;
}
