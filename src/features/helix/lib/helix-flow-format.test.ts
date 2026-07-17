import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  daysToExpiry,
  flowSignals,
  flowTimeMs,
  fmtExpiryShort,
  fmtFullTimestamp,
  ruleLabel,
  executionRouteKey,
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

test("fmtFullTimestamp renders MM/DD/YYYY - HH:MM in US Eastern (24h)", () => {
  // 2026-07-15T15:45:00Z is 11:45 EDT (UTC-4, mid-July) — well inside one ET calendar day, so
  // there's no midnight/DST-boundary ambiguity in the assertion.
  assert.equal(fmtFullTimestamp("2026-07-15T15:45:00.000Z"), "07/15/2026 - 11:45");
});

test("fmtFullTimestamp zero-pads month, day, hour, and minute", () => {
  // 2026-03-05T13:07:00Z → 08:07 EST (UTC-5; US DST 2026 begins Mar 8, so Mar 5 is still standard).
  assert.equal(fmtFullTimestamp("2026-03-05T13:07:00.000Z"), "03/05/2026 - 08:07");
});

test("fmtFullTimestamp uses 24-hour clock for afternoon prints", () => {
  // 2026-07-15T20:30:00Z → 16:30 EDT (not 4:30 PM).
  assert.equal(fmtFullTimestamp("2026-07-15T20:30:00.000Z"), "07/15/2026 - 16:30");
});

test("fmtFullTimestamp returns em-dash for empty or invalid input", () => {
  assert.equal(fmtFullTimestamp(""), "—");
  assert.equal(fmtFullTimestamp("not-a-date"), "—");
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

test("executionRouteKey reads UW alert_rule, not internal route", () => {
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHitsSweep" }), "SWEEP");
  assert.equal(executionRouteKey({ alert_rule: "BigBlockTrade" }), "BLOCK");
  assert.equal(executionRouteKey({ alert_rule: undefined }), "OTHER");
});

test("flowSignals includes near wall tags", () => {
  const signals = flowSignals(
    flow({ ticker: "SPY", gex_proximity: "near_call_wall" }),
    {}
  );
  assert.ok(signals.some((s) => s.id === "ncwall"));
});
