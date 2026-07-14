import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isRegularTradingHoursNow,
  metricForLevelLabel,
  extractStatedNumbers,
  statedMatchesTruth,
  reconcileStatedNumbers,
  applyCorrectionsToLevels,
  type StatedNumber,
} from "@/lib/bie/rth-numeric-gate";
import type { BieLevel } from "@/lib/bie/answer-envelope";

// Fixed instants (EDT = UTC-4 in July): 14:00Z = 10:00 ET (RTH), 23:30Z = 19:30 ET (off-hours),
// Sat 2026-07-18 14:00Z = 10:00 ET weekend (off-hours).
const RTH = Date.parse("2026-07-14T14:00:00Z"); // Tue 10:00 ET
const OFFHOURS = Date.parse("2026-07-14T23:30:00Z"); // Tue 19:30 ET
const WEEKEND = Date.parse("2026-07-18T14:00:00Z"); // Sat 10:00 ET

describe("rth-numeric-gate: isRegularTradingHoursNow", () => {
  test("weekday 10:00 ET is RTH; 19:30 ET and Saturday are not", () => {
    assert.equal(isRegularTradingHoursNow(RTH), true);
    assert.equal(isRegularTradingHoursNow(OFFHOURS), false);
    assert.equal(isRegularTradingHoursNow(WEEKEND), false);
  });
});

describe("rth-numeric-gate: label→metric + extraction", () => {
  test("level labels map to the reconciled metric keys", () => {
    assert.equal(metricForLevelLabel("gamma flip"), "flip");
    assert.equal(metricForLevelLabel("call wall"), "call_wall");
    assert.equal(metricForLevelLabel("put wall"), "put_wall");
    assert.equal(metricForLevelLabel("max pain"), "max_pain");
    assert.equal(metricForLevelLabel("spot (now)"), "spot");
    assert.equal(metricForLevelLabel("VWAP"), null);
  });

  test("extractStatedNumbers pulls only reconcilable price levels", () => {
    const levels: BieLevel[] = [
      { label: "gamma flip", price: 7480 },
      { label: "call wall", price: 7550 },
      { label: "VWAP", price: 7510 },
    ];
    const s = extractStatedNumbers({ levels });
    assert.deepEqual(s.map((x) => x.metric).sort(), ["call_wall", "flip"]);
  });
});

describe("rth-numeric-gate: statedMatchesTruth (display-precision equality)", () => {
  test("integer-displayed number matches truth within half a unit", () => {
    const stated: StatedNumber = { metric: "flip", value: 7480, decimals: 0 };
    assert.equal(statedMatchesTruth(stated, 7480.3), true); // within ±0.5+0.01
    assert.equal(statedMatchesTruth(stated, 7481.2), false); // wrong number
    assert.equal(statedMatchesTruth(stated, null), false);
  });
});

describe("rth-numeric-gate: reconcileStatedNumbers", () => {
  const stated: StatedNumber[] = [
    { metric: "flip", value: 7480, decimals: 0 },
    { metric: "call_wall", value: 7550, decimals: 0 },
  ];

  test("all match → clean (no corrections, no mismatches)", () => {
    const r = reconcileStatedNumbers(stated, { flip: 7480, call_wall: 7550 }, RTH);
    assert.equal(r.action, "clean");
    assert.equal(r.mismatches.length, 0);
  });

  test("RTH + a divergent stated number → corrected to the served value", () => {
    const r = reconcileStatedNumbers(stated, { flip: 7495, call_wall: 7550 }, RTH);
    assert.equal(r.rth, true);
    assert.equal(r.action, "corrected");
    assert.deepEqual(r.mismatches, [{ metric: "flip", stated: 7480, served: 7495 }]);
    assert.equal(r.corrections.flip, 7495);
  });

  test("off-hours + a divergent stated number → stale-marked, NOT corrected", () => {
    const r = reconcileStatedNumbers(stated, { flip: 7495, call_wall: 7550 }, OFFHOURS);
    assert.equal(r.rth, false);
    assert.equal(r.action, "stale-marked");
    assert.equal(r.mismatches.length, 1);
    assert.deepEqual(r.corrections, {}); // off-hours never rewrites the number
  });

  test("a metric the truth snapshot doesn't carry is skipped, not failed", () => {
    const r = reconcileStatedNumbers(stated, { flip: 7480 }, RTH); // no call_wall served
    assert.equal(r.action, "clean");
  });
});

describe("rth-numeric-gate: applyCorrectionsToLevels", () => {
  test("swaps the stale price for the served value and notes the re-sync", () => {
    const levels: BieLevel[] = [
      { label: "gamma flip", price: 7480 },
      { label: "call wall", price: 7550 },
    ];
    const out = applyCorrectionsToLevels(levels, { flip: 7495 });
    assert.equal(out[0]!.price, 7495);
    assert.match(out[0]!.note ?? "", /re-synced to live 7,495/);
    assert.equal(out[1]!.price, 7550); // untouched
  });
});
