const legacyCheckout = process.env.NEXT_PUBLIC_WHOP_CHECKOUT_PRO ?? "";

export const WHOP_CHECKOUT = {
  monthly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY ?? legacyCheckout,
  yearly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY ?? "",
  lifetime: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME ?? "",
  store: process.env.NEXT_PUBLIC_WHOP_STORE_URL ?? legacyCheckout,
};

export const WHOP_PREMIUM_CHECKOUT_OPTIONS = [
  { label: "Monthly — $79.99", href: WHOP_CHECKOUT.monthly },
  { label: "Yearly — $699", href: WHOP_CHECKOUT.yearly },
  { label: "Lifetime — $1,500", href: WHOP_CHECKOUT.lifetime },
].filter((option) => option.href);
