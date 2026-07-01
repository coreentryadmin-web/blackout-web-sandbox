import { clerkClient } from "@clerk/nextjs/server";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { type Tier } from "@/lib/tiers";
import {
  getWhopClient,
  PREMIUM_MEMBERSHIP_STATUSES,
  resolveTierFromMemberships,
} from "@/lib/whop";
import { isMembershipRevoked } from "@/lib/whop-revocation";
import { publishTierChanged } from "@/lib/tier-cache";

type MembershipMetadata = {
  tier?: Tier;
  whop_user_id?: string;
  whop_membership_id?: string;
};

export async function findClerkUsersByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    emailAddress: [normalized],
    limit: 10,
  });

  return data;
}

export async function updateClerkMembershipMetadata(
  clerkUserId: string,
  metadata: MembershipMetadata
) {
  const client = await clerkClient();
  // Use updateUserMetadata (not updateUser) so Clerk performs a server-side
  // deep-merge of publicMetadata rather than a full overwrite. This eliminates
  // the read-modify-write race where two concurrent calls could each read stale
  // metadata and overwrite each other's changes.
  await client.users.updateUserMetadata(clerkUserId, {
    publicMetadata: metadata,
  });
}

async function findWhopUserIdsByEmail(
  email: string,
  companyId: string
): Promise<string[]> {
  const whop = getWhopClient();
  const normalized = email.trim().toLowerCase();
  const userIds = new Set<string>();

  for await (const member of whop.members.list({
    company_id: companyId,
    query: normalized,
  })) {
    const memberEmail = member.user?.email?.toLowerCase();
    if (memberEmail === normalized && member.user?.id) {
      userIds.add(member.user.id);
    }
  }

  return Array.from(userIds);
}

// Deterministic membership ordering: ACTIVE/TRIALING first, then most-recently-created, so [0] is
// always the "best" membership. (created_at is an ISO string — Date.parse, not a numeric cast.)
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 1,
  completed: 2,
  past_due: 3,
  canceling: 4,
};
function sortMemberships(memberships: MembershipListResponse[]): MembershipListResponse[] {
  return [...memberships].sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] ?? 99;
    const bPriority = STATUS_PRIORITY[b.status] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aTs = Date.parse((a as unknown as { created_at?: string }).created_at ?? "") || 0;
    const bTs = Date.parse((b as unknown as { created_at?: string }).created_at ?? "") || 0;
    return bTs - aTs;
  });
}

/**
 * Resolve premium/free for ONE email's Whop memberships (no Clerk write). Fail-CLOSED on a
 * member:email:read outage (throws, so the caller leaves the existing tier intact). Extracted so a
 * Clerk user can be resolved across ALL their emails (audit launch-path #2 + #7).
 */
async function resolveMembershipTierForEmail(
  normalized: string,
  companyId: string
): Promise<{ tier: Tier; activeMembership?: MembershipListResponse }> {
  const whop = getWhopClient();
  const userIds = await findWhopUserIdsByEmail(normalized, companyId);

  const memberships: MembershipListResponse[] = [];
  // No server-side product_ids/plan_ids filter — resolveTierFromMembership classifies by product OR
  // plan; a product_ids-only filter silently drops plan-identified premium memberships (launch-path #1).
  const membershipParams = {
    company_id: companyId,
    ...(userIds.length ? { user_ids: userIds } : {}),
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };

  let sawAnyMembershipRow = false;
  let sawReadableEmail = false;
  for await (const membership of whop.memberships.list(membershipParams)) {
    sawAnyMembershipRow = true;
    if (!userIds.length) {
      const memberEmail = membership.user?.email?.toLowerCase();
      if (memberEmail) sawReadableEmail = true;
      if (memberEmail !== normalized) continue;
    }
    memberships.push(membership);
  }

  if (!userIds.length && memberships.length === 0 && sawAnyMembershipRow && !sawReadableEmail) {
    throw new Error(
      `Cannot resolve membership for ${normalized}: rows returned but every user.email was null ` +
        "(Whop app likely lacks member:email:read). Refusing to downgrade to 'free'."
    );
  }

  const sorted = sortMemberships(memberships);
  // Exclude refunded / charged-back memberships (audit launch-path #6): a refund/dispute webhook adds
  // the membership id to the revocation denylist, so a still-'completed' refunded purchase no longer
  // grants premium.
  const revoked = new Set<string>();
  for (const m of sorted) {
    if (m.id && (await isMembershipRevoked(m.id))) revoked.add(m.id);
  }
  const tier = resolveTierFromMemberships(sorted, revoked);
  const activeMembership = sorted.find((m) => !revoked.has(m.id)) ?? sorted[0];
  return { tier, activeMembership };
}

export async function syncWhopMembershipForEmail(email: string): Promise<{
  tier: Tier;
  updatedUserIds: string[];
}> {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("WHOP_COMPANY_ID is required for membership sync");
  }
  const normalized = email.trim().toLowerCase();

  const clerkUsers = await findClerkUsersByEmail(normalized);

  // No Clerk account yet (e.g. paid before signing up): resolve the triggering email so the caller
  // still gets a tier, but there's nothing to write.
  if (clerkUsers.length === 0) {
    const { tier } = await resolveMembershipTierForEmail(normalized, companyId);
    return { tier, updatedUserIds: [] };
  }

  // Resolve EACH matched Clerk user across ALL their verified emails — premium if ANY of them has a
  // premium membership — and write once. Making the result independent of WHICH email triggered the
  // sync is what stops a single non-purchase address from downgrading a multi-email payer
  // (audit launch-path #7). A member:email:read outage throws out of the inner resolve, aborting the
  // whole sync (caller keeps prior tiers) rather than writing 'free'.
  let bestTier: Tier = "free";
  const updatedUserIds: string[] = [];
  for (const user of clerkUsers) {
    const emails = new Set<string>([normalized]);
    const primaryId = user.primaryEmailAddressId;
    for (const addr of user.emailAddresses ?? []) {
      if (addr.id === primaryId || addr.verification?.status === "verified") {
        const e = addr.emailAddress?.toLowerCase();
        if (e) emails.add(e);
      }
    }

    let userTier: Tier = "free";
    let activeMembership: MembershipListResponse | undefined;
    for (const e of emails) {
      const r = await resolveMembershipTierForEmail(e, companyId);
      if (!activeMembership) activeMembership = r.activeMembership;
      if (r.tier === "premium") {
        userTier = "premium";
        activeMembership = r.activeMembership;
        break; // premium wins — no need to check the rest
      }
    }

    await updateClerkMembershipMetadata(user.id, {
      tier: userTier,
      whop_user_id: activeMembership?.user?.id,
      whop_membership_id: activeMembership?.id,
    });
    updatedUserIds.push(user.id);
    if (userTier === "premium") bestTier = "premium";
  }

  return { tier: bestTier, updatedUserIds };
}

/**
 * Reconcile Whop → Clerk for every relevant user, self-healing dropped/missed webhooks
 * in BOTH directions:
 *  - Emails with an active/grace Whop membership → ensures paid users are `premium`
 *    (fixes the missed-upgrade lockout where a subscriber is stuck on `free`).
 *  - Emails of Clerk users currently marked `premium` → re-checks Whop and downgrades
 *    to `free` once the membership has actually lapsed (fixes the revenue leak where a
 *    churned/refunded user keeps premium because no `deactivated` webhook arrived).
 *
 * Work is bounded to (active subscribers ∪ current premium users), not the full user base.
 * Each email is re-resolved via syncWhopMembershipForEmail, which writes the correct tier.
 */
export async function reconcileAllMemberships(opts?: {
  maxEmails?: number;
  concurrency?: number;
}): Promise<{
  checked: number;
  premium: number;
  free: number;
  errors: number;
  capped: boolean;
}> {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("WHOP_COMPANY_ID is required for membership reconcile");
  }

  const emails = new Set<string>();

  // 1) Emails holding an active/grace Whop membership (catches missed upgrades).
  const whop = getWhopClient();
  // No product_ids/plan_ids server filter (see syncWhopMembershipForEmail): the discovery pass must
  // enumerate ALL active/grace memberships so plan-identified premium subscribers are also found;
  // step 3 re-resolves each (classifying by product OR plan).
  const params = {
    company_id: companyId,
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };
  for await (const membership of whop.memberships.list(params)) {
    const email = membership.user?.email?.toLowerCase();
    if (email) emails.add(email);
  }

  // 2) Emails of Clerk users currently marked premium (catches missed downgrades).
  const client = await clerkClient();
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data } = await client.users.getUserList({ limit: pageSize, offset });
    if (!data.length) break;
    for (const user of data) {
      const tier = String(
        (user.publicMetadata as { tier?: string } | undefined)?.tier ?? ""
      );
      if (tier === "premium") {
        // Use the PRIMARY email, not emailAddresses[0] — Clerk does not guarantee [0] is primary,
        // and re-resolving a premium user against an arbitrary secondary address yields 'free' and
        // downgrades a paying multi-email customer (audit launch-path #7). (A fuller per-user
        // resolution — premium if ANY of the account's emails has a membership — is a tracked follow-up.)
        const primaryId = user.primaryEmailAddressId;
        const primary = user.emailAddresses?.find((e) => e.id === primaryId)?.emailAddress;
        const email = (primary ?? user.emailAddresses?.[0]?.emailAddress)?.toLowerCase();
        if (email) emails.add(email);
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // 3) Re-resolve the truth for each email (in both directions).
  const maxEmails = opts?.maxEmails ?? 5000;
  const concurrency = Math.max(1, Math.min(10, opts?.concurrency ?? Number(process.env.MEMBERSHIP_RECONCILE_CONCURRENCY ?? "5")));
  const targets = Array.from(emails);
  const capped = targets.length > maxEmails;
  const slice = capped ? targets.slice(0, maxEmails) : targets;

  let premium = 0;
  let free = 0;
  let errors = 0;

  async function syncOne(email: string): Promise<"premium" | "free" | "error"> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { tier, updatedUserIds } = await syncWhopMembershipForEmail(email);
        for (const uid of updatedUserIds) publishTierChanged(uid);
        return tier === "premium" ? "premium" : "free";
      } catch (err) {
        const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
        if (status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 2000));
          continue;
        }
        console.warn(`[membership-reconcile] ${email} attempt ${attempt}:`, err);
        return "error";
      }
    }
    return "error";
  }

  let nextIdx = 0;
  async function worker(): Promise<Array<"premium" | "free" | "error">> {
    const out: Array<"premium" | "free" | "error"> = [];
    for (;;) {
      const i = nextIdx++;
      if (i >= slice.length) return out;
      out.push(await syncOne(slice[i]!));
    }
  }
  const batches = await Promise.all(
    Array.from({ length: Math.min(concurrency, slice.length) }, () => worker())
  );
  for (const batch of batches) {
    for (const o of batch) {
      if (o === "premium") premium++;
      else if (o === "free") free++;
      else errors++;
    }
  }

  if (capped) {
    console.warn(
      `[membership-reconcile] capped at ${maxEmails} of ${targets.length} emails — raise maxEmails if the user base has grown`
    );
  }

  return { checked: slice.length, premium, free, errors, capped };
}
