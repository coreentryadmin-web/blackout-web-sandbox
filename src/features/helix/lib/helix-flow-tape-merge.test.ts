import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  appendFlowTapePage,
  flowDedupeKey,
  flowPageCursor,
  mergeFlowTapeHead,
} from "./helix-flow-tape-merge";

function row(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker">): FlowAlert {
  return {
    premium: 500_000,
    option_type: "CALL",
    strike: 100,
    expiry: "2026-07-20",
    alerted_at: "2026-07-17T15:00:00.000Z",
    score: 0,
    direction: "bullish",
    route: "stock",
    ...partial,
  } as FlowAlert;
}

test("flowDedupeKey prefers alert_id", () => {
  assert.equal(flowDedupeKey({ alert_id: "uw:1", ticker: "SPY", strike: 1, option_type: "CALL" }), "id:uw:1");
});

test("mergeFlowTapeHead keeps older pages when refreshing head", () => {
  const older = row({ ticker: "AAPL", alerted_at: "2026-07-16T12:00:00.000Z" });
  const head = row({ ticker: "NVDA", alerted_at: "2026-07-17T16:00:00.000Z" });
  const merged = mergeFlowTapeHead([older], [head]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.ticker, "NVDA");
  assert.equal(merged[1]?.ticker, "AAPL");
});

test("appendFlowTapePage dedupes and sorts newest first", () => {
  const existing = [row({ ticker: "SPY", alerted_at: "2026-07-17T14:00:00.000Z" })];
  const page = [
    row({ ticker: "QQQ", alerted_at: "2026-07-17T13:00:00.000Z" }),
    row({ ticker: "SPY", alerted_at: "2026-07-17T14:00:00.000Z" }),
  ];
  const out = appendFlowTapePage(existing, page);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.ticker, "SPY");
  assert.equal(out[1]?.ticker, "QQQ");
});

test("flowPageCursor returns oldest timestamp in page", () => {
  const page = [
    row({ alerted_at: "2026-07-17T16:00:00.000Z" }),
    row({ alerted_at: "2026-07-17T10:00:00.000Z" }),
  ];
  assert.equal(flowPageCursor(page), "2026-07-17T10:00:00.000Z");
});
