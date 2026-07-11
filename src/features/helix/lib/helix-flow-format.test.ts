import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  daysToExpiry,
  flowSignals,
  flowTimeMs,
  fmtExpiryShort,
  ruleLabel,
  sortFlows,
} from "./helix-flow-format";

function flow(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker">): FlowAlert {
  return {
    option_type: "CALL",
    strike: 100,
    expiry: "2026-07-11",
    premium: 500_000,
    alerted_at: "2026-07-11T14:30:00.000Z",
    score: 0,
    ...partial,
  } as FlowAlert;
}

test("flowTimeMs returns null for missing alerted_at", () => {
  assert.equal(flowTimeMs(flow({ ticker: "SPY", alerted_at: "" })), null);
});

test("fmtExpiryShort formats YYYY-MM-DD", () => {
  assert.equal(fmtExpiryShort("2026-07-11"), "07/11/26");
});

test("ruleLabel maps sweep and repeat", () => {
  assert.equal(ruleLabel("sweep_block"), "SWEEP");
  assert.equal(ruleLabel("repeated_hits"), "REPEAT");
});

test("sortFlows orders premium descending", () => {
  const rows = [
    flow({ ticker: "A", premium: 200_000 }),
    flow({ ticker: "B", premium: 900_000 }),
    flow({ ticker: "C", premium: 400_000 }),
  ];
  const sorted = sortFlows(rows, "premium", "desc");
  assert.deepEqual(sorted.map((r) => r.ticker), ["B", "C", "A"]);
});

test("flowSignals includes whale and 0dte tags", () => {
  const signals = flowSignals(flow({ ticker: "SPX", premium: 2_000_000 }), {
    isWhale: true,
    is0dte: true,
  });
  assert.ok(signals.some((s) => s.id === "whale"));
  assert.ok(signals.some((s) => s.id === "0dte"));
});

test("daysToExpiry floors at zero for same-day expiry", () => {
  const today = new Date("2026-07-11T18:00:00Z");
  assert.equal(daysToExpiry("2026-07-11", today), 0);
});
