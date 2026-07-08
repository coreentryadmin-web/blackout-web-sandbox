export const IMAGES = {
  heroBanner: "/images/hero-banner.png",
  heroCommand: "/images/hero-command-desk.jpg",
  nighthawkOperator: "/images/nighthawk-operator.jpg",
  dashboardBg: "/images/dashboard-bg.png",
  ogImage: "/opengraph-image",
  authBg: "/images/hero-banner.png",
} as const;

/** Live desk screenshots for marketing module showcase (webp, ~1200px wide). */
export const MARKETING_MODULE_IMAGES = {
  spx: "/images/marketing/spx.webp",
  helix: "/images/marketing/helix.webp",
  thermal: "/images/marketing/thermal.webp",
  largo: "/images/marketing/largo.webp",
  hawk: "/images/marketing/hawk.webp",
  vector: "/images/marketing/vector.webp",
} as const;

export type MarketingModuleId = keyof typeof MARKETING_MODULE_IMAGES;

export const IMAGE_FILES = [
  { path: "public/images/hero-banner.png", label: "BlackOut Trading Community (hero)" },
  { path: "public/images/hero-command-desk.jpg", label: "Landing hero — operator command desk (cinematic background)" },
  { path: "public/images/nighthawk-operator.jpg", label: "Night Hawk screen — night-vision operator (cinematic background)" },
  { path: "public/images/dashboard-bg.png", label: "Dashboard ambient background" },
  { path: "public/images/og-image.png", label: "Social share preview" },
] as const;
