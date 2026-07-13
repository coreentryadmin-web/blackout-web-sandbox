/**
 * Market-condition buckets for promotion — sessions/trades are not IID for 0DTE.
 * Five CPI-day triggers ≠ five independent samples.
 */

export type MarketConditionInputs = {
  vix?: number | null;
  gamma_regime?: string | null;
  regime?: string | null;
};

export function vixQuartileBucket(vix: number | null | undefined): string {
  if (vix == null || !Number.isFinite(vix)) return "vix_unknown";
  if (vix < 14) return "vix_low";
  if (vix < 18) return "vix_mid";
  if (vix < 24) return "vix_elevated";
  return "vix_high";
}

export function marketConditionBucket(input: MarketConditionInputs): string {
  const vix = vixQuartileBucket(input.vix);
  const gamma = (input.gamma_regime ?? "unknown").trim() || "unknown";
  const regime = (input.regime ?? "unknown").trim() || "unknown";
  return `${vix}|γ:${gamma}|r:${regime}`;
}

export function uniqueMarketConditionCount(buckets: readonly string[]): number {
  return new Set(buckets.filter(Boolean)).size;
}
