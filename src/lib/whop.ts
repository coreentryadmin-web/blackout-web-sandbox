import Whop from "@whop/sdk";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import type { Tier } from "@/lib/tiers";

type WhopMembershipLike = Pick<MembershipListResponse, "status" | "plan" | "product">;

export const PREMIUM_MEMBERSHIP_STATUSES: WhopMembershipLike["status"][] = [
  "active",
  "trialing",
  "completed", // one-time / lifetime purchases
  // Grace statuses — extend premium during billing retry / cancel window (ops policy)
  "past_due",
  "canceling",
];

const ACTIVE_STATUSES = new Set(PREMIUM_MEMBERSHIP_STATUSES);

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

export function getPremiumProductIds(): string[] {
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

// Startup guard: warn loudly if all product/plan ID env vars are missing.
// A missing config causes every membership check to return 'free', silently
// downgrading all paying users — so this must surface immediately at boot.
if (
  !process.env.WHOP_PREMIUM_PRODUCT_IDS?.trim() &&
  !process.env.WHOP_PRO_PRODUCT_IDS?.trim() &&
  !process.env.WHOP_ELITE_PRODUCT_IDS?.trim() &&
  !process.env.WHOP_PREMIUM_PLAN_IDS?.trim() &&
  !process.env.WHOP_PRO_PLAN_IDS?.trim() &&
  !process.env.WHOP_ELITE_PLAN_IDS?.trim()
) {
  console.error(
    "[whop] CRITICAL: All WHOP_*_PRODUCT_IDS and WHOP_*_PLAN_IDS env vars are empty/undefined. " +
    "Every membership check will resolve as 'free', silently downgrading all paying users. " +
    "Set at least one of WHOP_PREMIUM_PRODUCT_IDS, WHOP_PRO_PRODUCT_IDS, or WHOP_ELITE_PRODUCT_IDS."
  );
}

export function resolveTierFromMembership(membership: WhopMembershipLike): Tier | null {
  if (!ACTIVE_STATUSES.has(membership.status)) return null;

  const planId = membership.plan.id;
  const productId = membership.product.id;

  const premiumProducts = getPremiumProductIds();
  const premiumPlans = getPremiumPlanIds();

  // Guard: if both lists are empty, the comparison always fails and every
  // membership silently resolves to 'free'. Throw instead of lying.
  if (premiumProducts.length === 0 && premiumPlans.length === 0) {
    throw new Error(
      "[whop] Cannot resolve tier: all WHOP_*_PRODUCT_IDS and WHOP_*_PLAN_IDS are empty. " +
      "Set at least one product/plan ID env var."
    );
  }

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
