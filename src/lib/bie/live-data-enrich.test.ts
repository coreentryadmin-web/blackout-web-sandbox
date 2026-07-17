import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsLiveEnrichment } from "./live-data-enrich-detect";

describe("needsLiveEnrichment", () => {
  it("flags missing context", () => {
    assert.equal(
      needsLiveEnrichment(
        { intent: "technical_read", ticker: "SPX" },
        { answer: "No data", context: { missing: true } }
      ),
      true
    );
  });

  it("flags cold copy on data-heavy intents", () => {
    assert.equal(
      needsLiveEnrichment(
        { intent: "wall_dynamics_read", ticker: "SPX" },
        { answer: "Desk feed is cold; retry later.", context: {} }
      ),
      true
    );
  });

  it("skips rich answers with numbers", () => {
    assert.equal(
      needsLiveEnrichment(
        { intent: "technical_read", ticker: "SPX" },
        {
          answer:
            "Spot **5842.50** (+0.42%) · RSI **58.2** · ATR **42.10** · EMA20 **5820** with full trend stack.",
          context: { tech: { price: 5842.5 } },
        }
      ),
      false
    );
  });
});
