import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyBieIntent } from "./router";
import { questionWantsVectorPulse } from "./live-data-enrich-detect";

describe("vector_pulse_read routing", () => {
  it("routes pulse questions to vector_pulse_read", () => {
    const route = classifyBieIntent("What just changed on NVDA?", new Set());
    assert.equal(route?.intent, "vector_pulse_read");
    assert.equal(route?.ticker, "NVDA");
  });

  it("routes vector pulse feed asks", () => {
    const route = classifyBieIntent("Show me the Vector Pulse on SPY", new Set());
    assert.equal(route?.intent, "vector_pulse_read");
    assert.equal(route?.ticker, "SPY");
  });

  it("questionWantsVectorPulse detects pulse append on vector_read", () => {
    assert.equal(questionWantsVectorPulse("NVDA vector setup with pulse"), true);
    assert.equal(questionWantsVectorPulse("full desk read"), false);
  });
});
