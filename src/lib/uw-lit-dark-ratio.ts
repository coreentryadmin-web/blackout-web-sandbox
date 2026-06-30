import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";
import { darkPoolStore, litTradesStore } from "@/lib/ws/uw-socket";

export type LitDarkRatio = {
  lit_premium: number;
  dark_premium: number;
  lit_share: number | null;
  updated_at: number;
};

const LIT_DARK_MAX_AGE_MS = 120_000;

/** Lit vs dark premium share from UW WS stores (SPY lit tape + dark pool snapshot). */
export function computeLitDarkRatio(): LitDarkRatio | null {
  const now = Date.now();
  const litFresh = litTradesStore.updatedAt > 0 && now - litTradesStore.updatedAt <= LIT_DARK_MAX_AGE_MS;
  const darkFresh =
    darkPoolStore.updatedAt > 0 && now - darkPoolStore.updatedAt <= LIT_DARK_MAX_AGE_MS;
  if (!litFresh && !darkFresh) return null;

  let litPremium = 0;
  if (litFresh) {
    for (const row of litTradesStore.rows) {
      if (row.symbol === "SPY" || row.symbol === "SPX") litPremium += row.premium;
    }
  }
  let darkPremium = 0;
  const darkPool: DarkPoolSnapshot | null = darkPoolStore.data;
  if (darkFresh && darkPool) {
    darkPremium = Number.isFinite(darkPool.total_premium) ? darkPool.total_premium : 0;
    if (darkPremium <= 0 && darkPool.prints?.length) {
      for (const p of darkPool.prints) {
        darkPremium += Number(p.premium ?? 0);
      }
    }
  }
  const total = litPremium + darkPremium;
  return {
    lit_premium: litPremium,
    dark_premium: darkPremium,
    lit_share: total > 0 ? litPremium / total : null,
    updated_at: Math.max(litTradesStore.updatedAt, darkPoolStore.updatedAt),
  };
}
