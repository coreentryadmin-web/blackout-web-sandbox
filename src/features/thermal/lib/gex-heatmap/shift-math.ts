/**
 * Percent change implied by a $-delta over the shift window, expressed relative to the
 * MAGNITUDE of the value before that delta was applied (baseline = current - delta).
 * Dividing by |baseline| (not baseline) keeps the sign of the result tied to the sign of
 * delta itself — a strike that melted from -$1.0M to -$0.5M (delta=+$0.5M, "building" back
 * toward zero) reads +50%, matching the green "built" convention the Shift view already
 * uses (`built = delta > 0`), instead of the confusing negative a bare delta/baseline would
 * produce when baseline is negative.
 *
 * Returns null (never NaN/Infinity) when there's no delta to work with or the baseline is
 * ~zero — a percent change from ~zero is undefined, and this pipeline never fabricates a
 * shift (mirrors GexShift's own `available` gate).
 */
export function shiftPercentForStrike(
  currentValue: number,
  delta: number | null | undefined
): number | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  return (delta / Math.abs(baseline)) * 100;
}
