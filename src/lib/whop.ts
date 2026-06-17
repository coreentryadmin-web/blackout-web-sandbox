import Whop from "@whop/sdk";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import type { Tier } from "@/lib/tiers";

type WhopMembershipLike = Pick<MembershipListResponse, "status" | "plan" | "product">;

const ACTIVE_STATUSES = new Set<WhopMembershipLike["status"]>([
  "active",
  "trialing",
  "past_due",
  "canceling",
]);

let client: Whop | null = null;

export function getWhopClient(): Whop {
  if (!client) {
    const apiKey = process.env.WHOP_API_KEY;
    if (!apiKey) throw new Error("Missing WHOP_API_KEY");
    client = new Whop({ apiKey });
  }
  return client;
}

function parseIdList(...values: Array<string | undefined>): string[] {
  return values
    .flatMap((value) => (value ? value.split(",") : []))
    .map((id) => id.trim())
    .filter(Boolean);
}

function getPremiumProductIds(): string[] {
  return parseIdList(
    process.env.WHOP_PREMIUM_PRODUCT_IDS,
    process.env.WHOP_PRO_PRODUCT_IDS,
    process.env.WHOP_ELITE_PRODUCT_IDS
  );
}

function getPremiumPlanIds(): string[] {
  return parseIdList(
    process.env.WHOP_PREMIUM_PLAN_IDS,
    process.env.WHOP_PRO_PLAN_IDS,
    process.env.WHOP_ELITE_PLAN_IDS
  );
}

export function resolveTierFromMembership(membership: WhopMembershipLike): Tier | null {
  if (!ACTIVE_STATUSES.has(membership.status)) return null;

  const planId = membership.plan.id;
  const productId = membership.product.id;

  const premiumProducts = getPremiumProductIds();
  const premiumPlans = getPremiumPlanIds();

  if (premiumProducts.includes(productId) || premiumPlans.includes(planId)) {
    return "premium";
  }

  return null;
}

export function resolveTierFromMemberships(memberships: WhopMembershipLike[]): Tier {
  for (const membership of memberships) {
    if (resolveTierFromMembership(membership) === "premium") return "premium";
  }
  return "free";
}
