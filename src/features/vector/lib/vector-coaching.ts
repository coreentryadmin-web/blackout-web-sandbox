import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";

export type CoachingAlertDraft = {
  trigger: string;
  alert: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  for_longs?: boolean;
  for_shorts?: boolean;
};

export type CoachingPayload = {
  alerts: CoachingAlertDraft[];
  spxPrice: number | null;
  callWall: number | null;
  putWall: number | null;
  vwap: number | null;
};

/** Derive SPX coaching alerts from live desk + GEX positioning (cache-readers). */
export async function buildCoachingAlerts(): Promise<CoachingPayload> {
  if (!isSpxEngineCronWindow()) {
    return { alerts: [], spxPrice: null, callWall: null, putWall: null, vwap: null };
  }

  const [{ merged }, gex] = await Promise.all([
    loadMergedSpxDesk().catch(() => ({ merged: { market_open: false, price: null, vwap: null } })),
    getGexPositioning("SPX").catch(() => null),
  ]);

  const price = merged.price ?? null;
  const vwap = merged.vwap ?? null;
  const callWall = gex?.call_wall ?? null;
  const putWall = gex?.put_wall ?? null;
  const alerts: CoachingAlertDraft[] = [];

  if (price != null && vwap != null) {
    const below = price < vwap - 2;
    const above = price > vwap + 2;
    if (below) {
      alerts.push({
        trigger: "below_vwap",
        alert: `SPX ${price.toFixed(2)} below VWAP ${vwap.toFixed(2)} — fade longs / favor shorts below mean.`,
        urgency: "HIGH",
        for_longs: false,
        for_shorts: true,
      });
    } else if (above) {
      alerts.push({
        trigger: "above_vwap",
        alert: `SPX ${price.toFixed(2)} above VWAP ${vwap.toFixed(2)} — hold longs above mean; shorts need reclaim failure.`,
        urgency: "MEDIUM",
        for_longs: true,
        for_shorts: false,
      });
    }
  }

  if (price != null && callWall != null && price >= callWall - 3) {
    alerts.push({
      trigger: "near_call_wall",
      alert: `SPX pressing call wall ${callWall.toFixed(0)} — expect dealer resistance / mean-reversion risk.`,
      urgency: "HIGH",
      for_longs: false,
      for_shorts: true,
    });
  }

  if (price != null && putWall != null && price <= putWall + 3) {
    alerts.push({
      trigger: "near_put_wall",
      alert: `SPX at put wall ${putWall.toFixed(0)} — watch for gamma support / bounce setup.`,
      urgency: "MEDIUM",
      for_longs: true,
      for_shorts: false,
    });
  }

  if (gex?.gamma_posture === "short" && gex.distance_to_flip_pct != null && gex.distance_to_flip_pct < -0.5) {
    alerts.push({
      trigger: "short_gamma",
      alert: `Dealer short gamma below flip — expect amplified moves; reduce size until flip reclaimed.`,
      urgency: "CRITICAL",
      for_longs: false,
      for_shorts: true,
    });
  }

  return { alerts, spxPrice: price, callWall, putWall, vwap };
}
