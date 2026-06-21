const legacyCheckout = process.env.NEXT_PUBLIC_WHOP_CHECKOUT_PRO ?? "";

// Runtime guard: warn loudly when checkout env vars are missing so the
// missing-config issue is visible in logs rather than silently producing an
// empty upgrade page.
const requiredVars: Record<string, string | undefined> = {
  NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY,
  NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY,
  NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME,
  NEXT_PUBLIC_WHOP_STORE_URL: process.env.NEXT_PUBLIC_WHOP_STORE_URL,
};
const missingVars = Object.entries(requiredVars)
  .filter(([, v]) => !v && !legacyCheckout)
  .map(([k]) => k);
if (missingVars.length > 0) {
  console.warn(
    "[whop-checkout] Missing required env vars — upgrade page will show fallback message. " +
      "Set the following variables: " +
      missingVars.join(", ")
  );
}

export const WHOP_CHECKOUT = {
  monthly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY ?? legacyCheckout,
  yearly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY ?? "",
  lifetime: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME ?? "",
  store: process.env.NEXT_PUBLIC_WHOP_STORE_URL ?? legacyCheckout,
};

/**
 * User-facing fallback shown on the upgrade page when no checkout URLs are
 * configured. Prevents the page from rendering an empty options list.
 */
export const WHOP_CHECKOUT_UNAVAILABLE_MESSAGE =
  "Upgrade options temporarily unavailable — please contact support.";

export const WHOP_PREMIUM_CHECKOUT_OPTIONS = [
  { label: "Monthly — $79.99", href: WHOP_CHECKOUT.monthly },
  { label: "Yearly — $699", href: WHOP_CHECKOUT.yearly },
  { label: "Lifetime — $1,500", href: WHOP_CHECKOUT.lifetime },
].filter((option) => option.href);
