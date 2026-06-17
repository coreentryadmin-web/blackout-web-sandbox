export type Tier = "free" | "premium";

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  premium: 1,
};

export function parseTier(value: unknown): Tier {
  if (value === "premium" || value === "pro" || value === "elite") return "premium";
  return "free";
}

export function tierAtLeast(have: Tier, need: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  premium: "Premium",
};
