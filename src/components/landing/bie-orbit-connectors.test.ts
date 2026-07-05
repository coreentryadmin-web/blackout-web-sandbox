import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advancePulseT,
  buildMeshEdges,
  connectorPulseOpacity,
  connectorPulsePosition,
  ECOSYSTEM_LOOP_PERIOD_SEC,
  loopSegmentIndex,
  loopSegmentLocalT,
  outboundPulsePhaseForIndex,
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

describe("outboundPulsePhaseForIndex", () => {
  it("is offset half a cycle from the inbound phase", () => {
    for (const i of [0, 1, 2, 3, 4, 5]) {
      const inbound = pulsePhaseForIndex(i, 6);
      const outbound = outboundPulsePhaseForIndex(i, 6);
      const diff = Math.abs(outbound - inbound);
      assert.ok(Math.abs(diff - 0.5) < 1e-9, `expected 0.5 offset, got ${diff}`);
    }
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
  const a = { x: 100, y: 100 };
  const b = { x: 0, y: 0 };

  it("is at `from` when t=0", () => {
    assert.deepEqual(connectorPulsePosition(a, b, 0), a);
  });

  it("is at `to` when t=1", () => {
    assert.deepEqual(connectorPulsePosition(a, b, 1), b);
  });

  it("is the midpoint at t=0.5", () => {
    assert.deepEqual(connectorPulsePosition(a, b, 0.5), { x: 50, y: 50 });
  });

  it("reversing the arguments reverses the direction of travel — this is how inbound vs outbound share one function", () => {
    const core = { x: 640, y: 360 };
    const tool = { x: 100, y: 50 };
    const inbound = connectorPulsePosition(tool, core, 0.3); // tool -> core
    const outbound = connectorPulsePosition(core, tool, 0.7); // core -> tool
    assert.deepEqual(inbound, outbound, "0.3 toward core == 0.7 toward tool, same point on the same line");
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

describe("buildMeshEdges", () => {
  it("connects six tools into one closed loop", () => {
    assert.deepEqual(buildMeshEdges(6), [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
    ]);
  });

  it("returns no edges for 0 or 1 tools", () => {
    assert.deepEqual(buildMeshEdges(0), []);
    assert.deepEqual(buildMeshEdges(1), []);
  });
});

describe("loopSegmentIndex / loopSegmentLocalT", () => {
  it("starts on segment 0 at loopT=0", () => {
    assert.equal(loopSegmentIndex(0, 6), 0);
    assert.equal(loopSegmentLocalT(0, 6), 0);
  });

  it("moves to the next segment after 1/segmentCount of the loop", () => {
    assert.equal(loopSegmentIndex(1 / 6, 6), 1);
  });

  it("visits every segment exactly once across a full loop", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 6; i++) seen.add(loopSegmentIndex(i / 6 + 0.001, 6));
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5]);
  });

  it("local t resets to ~0 at the start of each segment and approaches 1 at its end", () => {
    // 2/6 + epsilon (not exactly 2/6) — avoids a floating-point boundary
    // artifact where 2/6 * 6 can land a hair under 2.0 instead of exactly 2.0.
    assert.ok(loopSegmentLocalT(2.001 / 6, 6) < 0.01);
    assert.ok(loopSegmentLocalT(2.999 / 6, 6) > 0.99);
  });

  it("wraps loopT outside 0..1 the same as inside", () => {
    assert.equal(loopSegmentIndex(1.5 / 6, 6), loopSegmentIndex(1.5 / 6 + 3, 6));
  });
});

describe("ECOSYSTEM_LOOP_PERIOD_SEC", () => {
  it("is a positive, sane duration", () => {
    assert.ok(ECOSYSTEM_LOOP_PERIOD_SEC > 0);
  });
});
