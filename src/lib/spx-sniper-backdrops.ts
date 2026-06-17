import type { SpxPlayAction } from "@/lib/spx-play-engine";

/** Public paths under /public/spx-sniper — swap or add files anytime. */
export const SPX_SNIPER_BACKDROPS = [
  "/spx-sniper/spx-sniper-vivid-sunset.webp",
  "/spx-sniper/spx-sniper-vivid-combat.webp",
  "/spx-sniper/spx-sniper-vivid-neon.webp",
] as const;

export function sniperBackdropIntervalMs(): number {
  return Number(process.env.NEXT_PUBLIC_SPX_SNIPER_BG_INTERVAL_MS ?? 28_000);
}

/** Optional action-tint overlay class for hero card. */
export function sniperActionTint(action: SpxPlayAction | undefined): string {
  switch (action) {
    case "BUY":
      return "spx-sniper-tint-buy";
    case "SELL":
      return "spx-sniper-tint-sell";
    case "WATCHING":
      return "spx-sniper-tint-watch";
    case "HOLD":
    case "TRIM":
      return "spx-sniper-tint-hold";
    default:
      return "spx-sniper-tint-scan";
  }
}
