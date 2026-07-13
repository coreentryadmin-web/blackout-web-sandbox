/**
 * SHARED PRICE AXIS seam (SPX Slayer desk, 2026-07-13).
 *
 * Pure math + throttle helpers behind VectorChart's optional `onPriceScaleRender` callback:
 * the chart reports its price pane's live y-mapping (visible price range, pane height,
 * viewport top and the chart-native price→pixel function) so a host desk can render
 * sibling panels — the SPX strike ladder — on the SAME y-scale as the candles, with one
 * spot line cutting across both at the same pixel height.
 *
 * Everything here is dependency-free and injectable-clock so it is unit-testable via
 * `tsx --test` without booting a chart or a browser.
 */

export type VectorPriceScaleMap = {
  /**
   * Chart-native mapping (series.priceToCoordinate): price → pixel y, relative to the TOP
   * of the price pane. Null when the price can't be mapped (chart mid-teardown, or the
   * scale has no data yet). Consumers should fall back to linearPriceToY(rangeMin,
   * rangeMax, height) when this returns null — the chart's default price scale is linear,
   * so the fallback is exact in practice.
   */
  priceToY: (price: number) => number | null;
  /** Price at the BOTTOM edge of the pane (the smaller price). */
  rangeMin: number;
  /** Price at the TOP edge of the pane (the larger price). */
  rangeMax: number;
  /** Price-pane height in px (pane 0 only — volume/oscillator sub-panes excluded). */
  height: number;
  /**
   * Viewport-Y of the price pane's top edge (getBoundingClientRect().top of the canvas
   * container — pane 0 starts at the container top; the time axis and sub-panes are below).
   * A host rendering in a DIFFERENT grid column aligns by offsetting its own rect top:
   * yInHost = priceToY(price) + (paneTop - hostTop). Not in the original seam spec, but
   * without it cross-column pixel alignment is impossible — the whole point of the seam.
   */
  paneTop: number;
};

/** The comparable (non-function) fields of a map — what change-detection diffs. */
export type PriceScaleSnapshot = Pick<
  VectorPriceScaleMap,
  "rangeMin" | "rangeMax" | "height" | "paneTop"
>;

/**
 * Linear price→y mapping over [rangeMin, rangeMax] onto [height, 0] (price up = y down).
 * Exact for the chart's default linear price scale; used as the consumer-side fallback
 * when the chart-native priceToY returns null. Degenerate ranges map to null (never NaN).
 */
export function linearPriceToY(
  rangeMin: number,
  rangeMax: number,
  height: number
): (price: number) => number | null {
  const span = rangeMax - rangeMin;
  if (!Number.isFinite(span) || !(span > 0) || !(height > 0)) return () => null;
  return (price: number) => {
    if (!Number.isFinite(price)) return null;
    return ((rangeMax - price) / span) * height;
  };
}

/**
 * Change gate for emissions: true when the scale meaningfully moved. Price epsilon is
 * loose-ish (0.01pt) because SPX autoscale jitters sub-cent on every tick; pixel epsilon
 * (0.5px) catches container resize/scroll. Emitting only on change keeps the host's
 * React state (and therefore its re-renders) quiet while the tape is quiet.
 */
export function priceScaleMapChanged(
  prev: PriceScaleSnapshot | null,
  next: PriceScaleSnapshot,
  epsPrice = 0.01,
  epsPx = 0.5
): boolean {
  if (!prev) return true;
  return (
    Math.abs(prev.rangeMin - next.rangeMin) > epsPrice ||
    Math.abs(prev.rangeMax - next.rangeMax) > epsPrice ||
    Math.abs(prev.height - next.height) > epsPx ||
    Math.abs(prev.paneTop - next.paneTop) > epsPx
  );
}

type ThrottleTimers = {
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
};

export type RenderThrottle = {
  /** Request a run. Executes immediately when outside the window, else schedules ONE
   *  trailing run at the window edge (so the final paint after a burst is never dropped). */
  call: () => void;
  /** Cancel any pending trailing run (component unmount). */
  cancel: () => void;
};

/**
 * Leading+trailing throttle for the paint callback (~250ms). Leading edge keeps pan/zoom
 * feeling live; the trailing run guarantees the LAST scale state of a burst is emitted
 * (a pure leading throttle would leave the ladder one frame stale after a fast zoom).
 * Timers/clock are injectable so tests drive it deterministically.
 */
export function createRenderThrottle(
  fn: () => void,
  waitMs: number,
  timers: ThrottleTimers = {}
): RenderThrottle {
  const now = timers.now ?? (() => Date.now());
  const schedule =
    timers.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const unschedule =
    timers.clearTimeout ??
    ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let lastRun = Number.NEGATIVE_INFINITY;
  let pending: unknown = null;

  const run = () => {
    pending = null;
    lastRun = now();
    fn();
  };

  return {
    call() {
      if (pending != null) return; // trailing run already scheduled — it will pick up the latest state
      const elapsed = now() - lastRun;
      if (elapsed >= waitMs) {
        run();
        return;
      }
      pending = schedule(run, waitMs - elapsed);
    },
    cancel() {
      if (pending != null) {
        unschedule(pending);
        pending = null;
      }
    },
  };
}
