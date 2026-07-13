import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRenderThrottle,
  linearPriceToY,
  priceScaleMapChanged,
} from "./vector-price-scale-map";

// ── linearPriceToY ──────────────────────────────────────────────────────────

test("linearPriceToY maps range edges and midpoint (price up = y down)", () => {
  const toY = linearPriceToY(6200, 6300, 500);
  assert.equal(toY(6300), 0); // top price → top pixel
  assert.equal(toY(6200), 500); // bottom price → bottom pixel
  assert.equal(toY(6250), 250); // midpoint
  assert.equal(toY(6275), 125);
});

test("linearPriceToY maps out-of-range prices beyond the pane (clipping is the caller's job)", () => {
  const toY = linearPriceToY(6200, 6300, 500);
  assert.equal(toY(6350), -250);
  assert.equal(toY(6100), 1000);
});

test("linearPriceToY degenerate inputs return null, never NaN", () => {
  assert.equal(linearPriceToY(6300, 6300, 500)(6300), null); // zero span
  assert.equal(linearPriceToY(6300, 6200, 500)(6250), null); // inverted range
  assert.equal(linearPriceToY(6200, 6300, 0)(6250), null); // zero height
  assert.equal(linearPriceToY(6200, 6300, 500)(Number.NaN), null); // NaN price
});

// ── priceScaleMapChanged ────────────────────────────────────────────────────

const SNAP = { rangeMin: 6200, rangeMax: 6300, height: 500, paneTop: 120 };

test("priceScaleMapChanged: null prev always emits", () => {
  assert.equal(priceScaleMapChanged(null, SNAP), true);
});

test("priceScaleMapChanged: identical + sub-epsilon jitter suppressed", () => {
  assert.equal(priceScaleMapChanged(SNAP, { ...SNAP }), false);
  assert.equal(
    priceScaleMapChanged(SNAP, { ...SNAP, rangeMin: 6200.005, paneTop: 120.4 }),
    false
  );
});

test("priceScaleMapChanged: any meaningful move on any axis emits", () => {
  assert.equal(priceScaleMapChanged(SNAP, { ...SNAP, rangeMin: 6199 }), true);
  assert.equal(priceScaleMapChanged(SNAP, { ...SNAP, rangeMax: 6301 }), true);
  assert.equal(priceScaleMapChanged(SNAP, { ...SNAP, height: 501 }), true);
  assert.equal(priceScaleMapChanged(SNAP, { ...SNAP, paneTop: 121 }), true);
});

// ── createRenderThrottle ────────────────────────────────────────────────────

type FakeTimer = { cb: () => void; at: number; cancelled: boolean };

function fakeClock() {
  let t = 0;
  const timers: FakeTimer[] = [];
  return {
    now: () => t,
    setTimeout: (cb: () => void, ms: number) => {
      const timer: FakeTimer = { cb, at: t + ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (id: unknown) => {
      (id as FakeTimer).cancelled = true;
    },
    /** Advance the clock, firing due timers in order. */
    tick(ms: number) {
      const target = t + ms;
      // fire timers due within the window, in time order
      for (;;) {
        const due = timers
          .filter((x) => !x.cancelled && x.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        t = due.at;
        due.cb();
      }
      t = target;
    },
  };
}

test("throttle: leading call runs immediately; burst collapses to one trailing run", () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createRenderThrottle(() => runs++, 250, clock);

  th.call();
  assert.equal(runs, 1); // leading edge

  clock.tick(50);
  th.call();
  th.call();
  th.call();
  assert.equal(runs, 1); // inside window — nothing yet

  clock.tick(250);
  assert.equal(runs, 2); // exactly ONE trailing run for the whole burst
});

test("throttle: calls spaced beyond the window all run on the leading edge", () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createRenderThrottle(() => runs++, 250, clock);
  th.call();
  clock.tick(300);
  th.call();
  clock.tick(300);
  th.call();
  assert.equal(runs, 3);
});

test("throttle: trailing run re-opens the window (no double-fire straight after)", () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createRenderThrottle(() => runs++, 250, clock);
  th.call(); // t=0 leading (runs=1)
  clock.tick(100);
  th.call(); // schedules trailing at t=250
  clock.tick(150); // fires trailing (runs=2)
  assert.equal(runs, 2);
  th.call(); // t=250, window just re-opened at 250 → must NOT run leading again
  assert.equal(runs, 2);
  clock.tick(250);
  assert.equal(runs, 3); // its trailing run
});

test("throttle: cancel drops the pending trailing run", () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createRenderThrottle(() => runs++, 250, clock);
  th.call();
  clock.tick(50);
  th.call(); // pending trailing
  th.cancel();
  clock.tick(1000);
  assert.equal(runs, 1);
});
