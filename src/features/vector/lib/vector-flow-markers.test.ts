import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterLargeFlowPrints,
  capFlowMarkers,
  flowMarkerSize,
  flowMarkerText,
  buildFlowMarkers,
  FLOW_CALL_COLOR,
  FLOW_PUT_COLOR,
  DEFAULT_FLOW_MIN_PREMIUM,
  type FlowPrint,
} from "./vector-flow-markers";

function print(over: Partial<FlowPrint> = {}): FlowPrint {
  return { strike: 6750, side: "call", premium: 1_000_000, size: 100, tsMs: 1_700_000_000_000, ...over };
}

test("filterLargeFlowPrints: drops prints below the premium floor", () => {
  const prints = [
    print({ premium: 300_000 }),
    print({ premium: 100_000 }), // below floor → dropped
    print({ premium: 250_000 }), // exactly at floor → kept
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000 });
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.premium >= 250_000));
});

test("filterLargeFlowPrints: bands to spot when spot + bandPct given", () => {
  const spot = 6750;
  const prints = [
    print({ strike: 6760 }), // within 5% → kept
    print({ strike: 7200 }), // ~6.7% away → dropped
    print({ strike: 6400 }), // ~5.2% away → dropped
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000, spot, bandPct: 0.05 });
  assert.deepEqual(
    out.map((p) => p.strike),
    [6760]
  );
});

test("filterLargeFlowPrints: rejects malformed premium/strike (no NaN leaks)", () => {
  const prints = [
    print({ premium: Number.NaN }),
    print({ strike: 0 }),
    print({ strike: Number.NaN }),
    print({ premium: 500_000, strike: 6750 }), // the only valid one
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000 });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.strike, 6750);
});

test("capFlowMarkers: keeps top-N by premium and reports the truncation", () => {
  const prints = [
    print({ premium: 1_000_000 }),
    print({ premium: 5_000_000 }),
    print({ premium: 2_000_000 }),
    print({ premium: 800_000 }),
  ];
  const { shown, truncated } = capFlowMarkers(prints, 2);
  assert.equal(truncated, 2);
  assert.deepEqual(
    shown.map((p) => p.premium),
    [5_000_000, 2_000_000] // largest first
  );
});

test("capFlowMarkers: maxN ≤ 0 means no cap; sorted desc, truncated 0", () => {
  const prints = [print({ premium: 300_000 }), print({ premium: 900_000 })];
  const { shown, truncated } = capFlowMarkers(prints, 0);
  assert.equal(truncated, 0);
  assert.deepEqual(
    shown.map((p) => p.premium),
    [900_000, 300_000]
  );
});

test("flowMarkerSize: monotone in premium, floored at 1, clamped at 2.4", () => {
  const floor = DEFAULT_FLOW_MIN_PREMIUM;
  assert.equal(flowMarkerSize(floor, floor), 1); // at floor → base size
  const s10x = flowMarkerSize(floor * 10, floor);
  const s100x = flowMarkerSize(floor * 100, floor);
  assert.ok(s10x > 1 && s10x < s100x); // bigger premium → bigger marker
  assert.ok(flowMarkerSize(floor * 100_000, floor) <= 2.4); // clamp holds for a whale print
});

test("flowMarkerText: side initial + compact premium", () => {
  assert.equal(flowMarkerText(print({ side: "call", premium: 1_200_000 })), "C $1.2M");
  assert.equal(flowMarkerText(print({ side: "put", premium: 780_000 })), "P $780K");
});

test("buildFlowMarkers: calls green ↑ / puts red ↓, at strike, ascending by time (seconds)", () => {
  const prints = [
    print({ side: "put", strike: 6700, premium: 900_000, tsMs: 1_700_000_020_000 }),
    print({ side: "call", strike: 6800, premium: 1_500_000, tsMs: 1_700_000_010_000 }),
  ];
  const markers = buildFlowMarkers(prints, DEFAULT_FLOW_MIN_PREMIUM);
  // ascending by time even though the call was passed second
  assert.deepEqual(
    markers.map((m) => m.time),
    [1_700_000_010, 1_700_000_020]
  );
  const call = markers.find((m) => m.price === 6800)!;
  const put = markers.find((m) => m.price === 6700)!;
  assert.equal(call.color, FLOW_CALL_COLOR);
  assert.equal(call.shape, "arrowUp");
  assert.equal(call.position, "atPriceMiddle");
  assert.equal(put.color, FLOW_PUT_COLOR);
  assert.equal(put.shape, "arrowDown");
});
