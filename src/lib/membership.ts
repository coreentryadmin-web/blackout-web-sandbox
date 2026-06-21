import { clerkClient } from "@clerk/nextjs/server";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { type Tier } from "@/lib/tiers";
import {
  getPremiumProductIds,
  getWhopClient,
  PREMIUM_MEMBERSHIP_STATUSES,
  resolveTierFromMemberships,
} from "@/lib/whop";

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

export async function syncWhopMembershipForEmail(email: string): Promise<{
  tier: Tier;
  updatedUserIds: string[];
}> {
  const whop = getWhopClient();
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("WHOP_COMPANY_ID is required for membership sync");
  }
  const normalized = email.trim().toLowerCase();
  const premiumProductIds = getPremiumProductIds();

  const userIds = await findWhopUserIdsByEmail(normalized, companyId);

  const memberships: MembershipListResponse[] = [];
  const membershipParams = {
    company_id: companyId,
    ...(premiumProductIds.length ? { product_ids: premiumProductIds } : {}),
    ...(userIds.length ? { user_ids: userIds } : {}),
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };

  for await (const membership of whop.memberships.list(membershipParams)) {
    if (!userIds.length) {
      const memberEmail = membership.user?.email?.toLowerCase();
      if (memberEmail !== normalized) continue;
    }
    memberships.push(membership);
  }

  // Sort memberships deterministically: prefer ACTIVE/TRIALING status first,
  // then fall back to most-recently-created so [0] is always the "best" membership.
  const STATUS_PRIORITY: Record<string, number> = {
    active: 0,
    trialing: 1,
    completed: 2,
    past_due: 3,
    canceling: 4,
  };
  const sortedMemberships = [...memberships].sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] ?? 99;
    const bPriority = STATUS_PRIORITY[b.status] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    // Within the same priority bucket, prefer the most recently created.
    const aTs = (a as unknown as { created_at?: number }).created_at ?? 0;
    const bTs = (b as unknown as { created_at?: number }).created_at ?? 0;
    return bTs - aTs;
  });

  const tier = resolveTierFromMemberships(sortedMemberships);
  const activeMembership = sortedMemberships[0];

  const clerkUsers = await findClerkUsersByEmail(normalized);
  const updatedUserIds: string[] = [];

  for (const user of clerkUsers) {
    await updateClerkMembershipMetadata(user.id, {
      tier,
      whop_user_id: activeMembership?.user?.id,
      whop_membership_id: activeMembership?.id,
    });
    updatedUserIds.push(user.id);
  }

  return { tier, updatedUserIds };
}
