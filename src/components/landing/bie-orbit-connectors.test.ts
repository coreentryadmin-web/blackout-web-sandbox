import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advancePulseT,
  connectorPulseOpacity,
  connectorPulsePosition,
  pulsePeriodSecForIndex,
  pulsePhaseForIndex,
} from "./bie-orbit-connectors";

describe("pulsePeriodSecForIndex", () => {
  it("increases with index so instruments don't pulse in lockstep", () => {
    const periods = [0, 1, 2, 3, 4, 5].map(pulsePeriodSecForIndex);
    for (let i = 1; i < periods.length; i++) {
      assert.ok(periods[i] > periods[i - 1]);
    }
  });
});

describe("pulsePhaseForIndex", () => {
  it("spreads six tools evenly across the 0..1 loop", () => {
    const phases = [0, 1, 2, 3, 4, 5].map((i) => pulsePhaseForIndex(i, 6));
    assert.deepEqual(phases, [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]);
  });

  it("returns 0 when count is 0 (avoids division by zero)", () => {
    assert.equal(pulsePhaseForIndex(0, 0), 0);
  });
});

describe("advancePulseT", () => {
  it("loops back to 0 after a full period", () => {
    assert.equal(advancePulseT(0.9, 1, 10), 1 % 1);
  });

  it("wraps around past 1", () => {
    const t = advancePulseT(0.95, 1, 10);
    assert.ok(t < 0.95, "should have wrapped, not kept increasing past 1");
  });

  it("is a no-op for non-positive period or dt", () => {
    assert.equal(advancePulseT(0.4, 1, 0), 0.4);
    assert.equal(advancePulseT(0.4, 0, 10), 0.4);
  });
});

describe("connectorPulsePosition", () => {
  const core = { x: 100, y: 100 };
  const tool = { x: 0, y: 0 };

  it("is at the tool when t=0", () => {
    assert.deepEqual(connectorPulsePosition(core, tool, 0), tool);
  });

  it("is at the core when t=1", () => {
    assert.deepEqual(connectorPulsePosition(core, tool, 1), core);
  });

  it("is the midpoint at t=0.5", () => {
    assert.deepEqual(connectorPulsePosition(core, tool, 0.5), { x: 50, y: 50 });
  });
});

describe("connectorPulseOpacity", () => {
  it("is 0 at both endpoints (t=0 and t=1)", () => {
    assert.equal(connectorPulseOpacity(0), 0);
    assert.equal(connectorPulseOpacity(1), 0);
  });

  it("is fully opaque in the middle of the travel", () => {
    assert.equal(connectorPulseOpacity(0.5), 1);
  });

  it("ramps smoothly within the fade window", () => {
    const early = connectorPulseOpacity(0.05, 0.18);
    const late = connectorPulseOpacity(0.95, 0.18);
    assert.ok(early > 0 && early < 1);
    assert.ok(late > 0 && late < 1);
  });
});
