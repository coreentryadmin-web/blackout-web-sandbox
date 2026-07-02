export type VixTermSnapshot = {
  vix9d: number | null;
  vix3m: number | null;
  structure: "contango" | "backwardation" | "flat" | "unknown";
  detail: string;
  /** True when only one leg of the curve (VIX9D or VIX3M) was available. */
  partial?: boolean;
};

// Term-structure labels are defined by the SLOPE of the curve (near vs far),
// not by where either leg sits relative to spot:
//   contango       = 9d < 3M (upward-sloping — the calm baseline)
//   backwardation  = 9d > 3M (inverted front — near-term fear)
// Spot VIX is the ~30d point BETWEEN them, so in textbook contango the front
// leg sits BELOW spot (9d < 30d < 3M). The old implementation compared
// near-vs-spot and labeled that normal shape "backwardation — front below
// spot" — mislabeling every calm session (live capture 2026-07-01: 9d 13.73 <
// spot 17.17 < 3M 19.0, a clean contango curve, served as "backwardation"
// while spx-signals.ts's engine correctly called the same data contango).
// Thresholds mirror spx-signals.ts's ±1.0pt so the label and the signal
// engine can never disagree about the same curve.
const SLOPE_THRESHOLD = 1.0;
// One-leg fallbacks compare that leg against spot (the 30d point) — a shorter
// span, so the noise floor is tighter.
const SPOT_THRESHOLD = 0.5;

export function computeVixTermStructure(
  spot: number | null,
  near: number | null,
  far: number | null
): VixTermSnapshot {
  // Both legs present: label from the actual curve slope. Spot not required.
  if (near != null && far != null) {
    const slope = far - near;
    if (slope > SLOPE_THRESHOLD) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "contango",
        detail: `Contango — 9d ${near.toFixed(2)} < 3M ${far.toFixed(2)} (+${slope.toFixed(2)})`,
      };
    }
    if (slope < -SLOPE_THRESHOLD) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "backwardation",
        detail: `Backwardation — 9d ${near.toFixed(2)} > 3M ${far.toFixed(2)} (${slope.toFixed(2)})`,
      };
    }
    return { vix9d: near, vix3m: far, structure: "flat", detail: `Flat term (Δ ${slope.toFixed(2)})` };
  }

  if (spot == null || (near == null && far == null)) {
    return { vix9d: near, vix3m: far, structure: "unknown", detail: "Insufficient VIX term data" };
  }

  // 3M only: far vs spot(30d) proxies the back half of the curve.
  // far above spot = upward slope beyond 30d = contango.
  if (far != null) {
    const spreadFar = far - spot;
    if (spreadFar > SPOT_THRESHOLD) {
      return {
        vix9d: null,
        vix3m: far,
        structure: "contango",
        detail: `Contango (3M only) +${spreadFar.toFixed(2)}`,
        partial: true,
      };
    }
    if (spreadFar < -SPOT_THRESHOLD) {
      return {
        vix9d: null,
        vix3m: far,
        structure: "backwardation",
        detail: `Backwardation (3M only) ${spreadFar.toFixed(2)}`,
        partial: true,
      };
    }
    return { vix9d: null, vix3m: far, structure: "flat", detail: "Flat term (3M only)", partial: true };
  }

  // 9d only: near vs spot(30d) proxies the front of the curve. In contango the
  // front sits BELOW the 30d point, so near-below-spot = contango and
  // near-above-spot = inverted front = backwardation. (The old code had these
  // two labels swapped.)
  const spreadNear = near! - spot;
  if (spreadNear < -SPOT_THRESHOLD) {
    return {
      vix9d: near,
      vix3m: null,
      structure: "contango",
      detail: `Contango (9d only) — front ${spreadNear.toFixed(2)} below spot`,
      partial: true,
    };
  }
  if (spreadNear > SPOT_THRESHOLD) {
    return {
      vix9d: near,
      vix3m: null,
      structure: "backwardation",
      detail: `Backwardation (9d only) — front +${spreadNear.toFixed(2)} above spot`,
      partial: true,
    };
  }
  return { vix9d: near, vix3m: null, structure: "flat", detail: "Flat term (9d only)", partial: true };
}
