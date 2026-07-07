import type { SpxPlayAction } from "@/features/spx/lib/spx-play-engine";

/** Single hero backdrop for SPX Sniper trade alerts panel. */
export const SPX_SNIPER_BACKDROP = "/spx-sniper/spx-sniper-vivid-neon.webp" as const;

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
