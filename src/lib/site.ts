export const SITE = {
  name: "BlackOut Trades",
  legalName: "BlackOut Trading",
  domain: "blackouttrades.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com",
  tagline: "Trade. Execute. Dominate.",
  description:
    "Institutional-grade options flow, AI market intelligence, live SPX analysis, and Night Hawk swing scanner.",
} as const;
