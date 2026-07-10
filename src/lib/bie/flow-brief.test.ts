import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { composeFlowBrief } from "@/lib/bie/flow-brief";
import type { FlowAlert } from "@/lib/api";

describe("composeFlowBrief", () => {
  test("builds a deterministic memo from flow stats", () => {
    const alerts = [
      {
        ticker: "SPX",
        option_type: "CALL",
        premium: 18_000_000,
        route: "SWEEP",
        strike: 6000,
        expiry: "2026-07-10",
        score: 90,
      },
      {
        ticker: "AAPL",
        option_type: "PUT",
        premium: 500_000,
        route: "BLOCK",
        strike: 200,
        expiry: "2026-07-10",
        score: 40,
      },
    ] as FlowAlert[];

    const brief = composeFlowBrief(alerts, []);
    assert.ok(brief);
    assert.match(brief!, /SPX/);
    assert.match(brief!, /call-led|put-led|mixed/);
  });
});
