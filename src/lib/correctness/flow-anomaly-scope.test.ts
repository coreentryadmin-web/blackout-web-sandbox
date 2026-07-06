import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyFlowAnomalies,
  classificationDiffIsClean,
  describeClassificationDiff,
  diffClassifiedLists,
  type ClassifiedFlowItem,
  type FlowPrintInput,
} from "./flow-anomaly-scope";
import {
  LARGE_PRINT_THRESHOLD,
  SKEW_RATIO_THRESHOLD,
} from "@/app/api/cron/market-regime-detector/flow-anomaly-detection";

// Pure module — no DB, no mock.module() needed (mirrors gex-odte-scope.test.ts).
// This file proves classifyFlowAnomalies' OWN math independently of
// detectFlowAnomalies; flows-verifier.test.ts separately proves the two agree
// (and disagree on a deliberately-injected mismatch) when wired together.

function row(overrides: Partial<FlowPrintInput> = {}): FlowPrintInput {
  return { ticker: "NVDA", premium: 300_000, option_type: "call", ...overrides };
}

test("classifyFlowAnomalies: a $2.5M single print classifies as a LARGE_PREMIUM_PRINT anomaly, not a near-miss", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "TSLA", premium: 2_500_000, option_type: "call" }),
    row({ ticker: "TSLA", premium: 700_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 1);
  assert.deepEqual(anomalies[0], { anomaly_type: "LARGE_PREMIUM_PRINT", ticker: "TSLA", direction: "bullish", metric_value: 2_500_000 });
  assert.equal(nearMisses.length, 0);
});

test("classifyFlowAnomalies: a $1.8M single print (near-miss band) — no anomaly, one BELOW-band near-miss", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "TSLA", premium: 1_800_000, option_type: "put" }),
    row({ ticker: "TSLA", premium: 500_000, option_type: "call" }),
  ]);
  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 1);
  assert.deepEqual(nearMisses[0], { anomaly_type: "LARGE_PREMIUM_PRINT", ticker: "TSLA", direction: "bearish", metric_value: 1_800_000 });
});

test("classifyFlowAnomalies: a $600k single print (well under the near-miss floor) — silent", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "AAPL", premium: 600_000, option_type: "call" }),
    row({ ticker: "AAPL", premium: 200_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 0);
});

test("classifyFlowAnomalies: 12:1 call skew on $900k total clears the real skew threshold", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "AMD", premium: 830_000, option_type: "call" }),
    row({ ticker: "AMD", premium: 70_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.anomaly_type, "DIRECTIONAL_FLOW_SKEW");
  assert.equal(anomalies[0]!.direction, "bullish");
  assert.equal(anomalies[0]!.metric_value, Math.round((830_000 / 70_000) * 100) / 100);
  assert.equal(nearMisses.length, 0);
});

test("classifyFlowAnomalies: 8:1 put skew on $900k total (near-miss band, gate cleared)", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "META", premium: 100_000, option_type: "call" }),
    row({ ticker: "META", premium: 800_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 1);
  assert.deepEqual(nearMisses[0], { anomaly_type: "DIRECTIONAL_FLOW_SKEW", ticker: "META", direction: "bearish", metric_value: 8 });
});

test("classifyFlowAnomalies: skew ratio would be extreme but total never clears the $500k volume gate — silent", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "SOFI", premium: 90_000, option_type: "call" }),
    row({ ticker: "SOFI", premium: 10_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 0);
});

test("classifyFlowAnomalies: a ticker with premium on only one side hits the 99 sentinel ratio and clears skew", () => {
  const { anomalies } = classifyFlowAnomalies([row({ ticker: "ONE_SIDE", premium: 600_000, option_type: "call" })]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.anomaly_type, "DIRECTIONAL_FLOW_SKEW");
  assert.equal(anomalies[0]!.metric_value, 99);
});

test("classifyFlowAnomalies: multiple tickers are independently classified in one pass", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "NVDA", premium: 3_000_000, option_type: "call" }),
    row({ ticker: "NVDA", premium: 800_000, option_type: "put" }),
    row({ ticker: "TSLA", premium: 1_500_000, option_type: "put" }),
    row({ ticker: "TSLA", premium: 400_000, option_type: "call" }),
    row({ ticker: "AAPL", premium: 250_000, option_type: "call" }),
  ]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.ticker, "NVDA");
  assert.equal(nearMisses.length, 1);
  assert.equal(nearMisses[0]!.ticker, "TSLA");
});

test("classifyFlowAnomalies: no rows — empty everything", () => {
  const { anomalies, nearMisses } = classifyFlowAnomalies([]);
  assert.deepEqual(anomalies, []);
  assert.deepEqual(nearMisses, []);
});

test("classifyFlowAnomalies: thresholds imported from flow-anomaly-detection.ts are the ones actually applied", () => {
  // A single print exactly AT the real threshold must classify as the anomaly, not the near-miss.
  // Offsetting put keeps the skew ratio (2.86) under the 5:1 near-miss floor too, isolating the print check.
  const { anomalies, nearMisses } = classifyFlowAnomalies([
    row({ ticker: "EDGE", premium: LARGE_PRINT_THRESHOLD, option_type: "call" }),
    row({ ticker: "EDGE", premium: 700_000, option_type: "put" }),
  ]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.anomaly_type, "LARGE_PREMIUM_PRINT");
  assert.equal(nearMisses.length, 0);
});

// ── diffClassifiedLists / classificationDiffIsClean ────────────────────────────
// This is the "recompute-and-compare fires correctly" contract flows-verifier.ts
// relies on — proven here directly against synthetic expected/actual lists, both
// for a clean match and a deliberately-injected mismatch (per the task's evidence
// requirement), independent of any live detectFlowAnomalies call.

const NVDA_PRINT: ClassifiedFlowItem = { anomaly_type: "LARGE_PREMIUM_PRINT", ticker: "NVDA", direction: "bullish", metric_value: 3_000_000 };
const TSLA_SKEW: ClassifiedFlowItem = { anomaly_type: "DIRECTIONAL_FLOW_SKEW", ticker: "TSLA", direction: "bearish", metric_value: 12.5 };

test("diffClassifiedLists: identical lists (any order) diff clean", () => {
  const diff = diffClassifiedLists([NVDA_PRINT, TSLA_SKEW], [TSLA_SKEW, NVDA_PRINT]);
  assert.equal(classificationDiffIsClean(diff), true);
  assert.equal(describeClassificationDiff(diff), "");
});

test("diffClassifiedLists: tiny fp noise within tolerance is still clean", () => {
  const actual = { ...TSLA_SKEW, metric_value: TSLA_SKEW.metric_value + 0.0000001 };
  const diff = diffClassifiedLists([TSLA_SKEW], [actual]);
  assert.equal(classificationDiffIsClean(diff), true);
});

test("diffClassifiedLists: a deliberately-injected MISSING anomaly (expected fired, actual silent) is caught", () => {
  const diff = diffClassifiedLists([NVDA_PRINT, TSLA_SKEW], [NVDA_PRINT]);
  assert.equal(classificationDiffIsClean(diff), false);
  assert.equal(diff.onlyExpected.length, 1);
  assert.equal(diff.onlyExpected[0]!.ticker, "TSLA");
  assert.equal(diff.onlyActual.length, 0);
  assert.match(describeClassificationDiff(diff), /MISSING from the actual output/);
  assert.match(describeClassificationDiff(diff), /TSLA\/DIRECTIONAL_FLOW_SKEW\/bearish/);
});

test("diffClassifiedLists: a deliberately-injected EXTRA anomaly (actual fired, recompute says it shouldn't have) is caught", () => {
  const diff = diffClassifiedLists([NVDA_PRINT], [NVDA_PRINT, TSLA_SKEW]);
  assert.equal(classificationDiffIsClean(diff), false);
  assert.equal(diff.onlyActual.length, 1);
  assert.equal(diff.onlyActual[0]!.ticker, "TSLA");
  assert.match(describeClassificationDiff(diff), /UNEXPECTED in the actual output/);
});

test("diffClassifiedLists: a deliberately-injected VALUE mismatch (same ticker/type/direction, different metric_value) is caught", () => {
  // Simulates e.g. a skew-ratio math bug: same ticker/type/direction fires, but the
  // reported ratio is wrong (as if callRatio and putRatio were swapped upstream).
  const wrongValue: ClassifiedFlowItem = { ...TSLA_SKEW, metric_value: SKEW_RATIO_THRESHOLD };
  const diff = diffClassifiedLists([TSLA_SKEW], [wrongValue]);
  assert.equal(classificationDiffIsClean(diff), false);
  assert.equal(diff.valueMismatches.length, 1);
  assert.equal(diff.valueMismatches[0]!.expected, TSLA_SKEW.metric_value);
  assert.equal(diff.valueMismatches[0]!.actual, SKEW_RATIO_THRESHOLD);
  assert.match(describeClassificationDiff(diff), /value mismatch/);
});

test("diffClassifiedLists: a direction flip on the same ticker+type is a MISSING+EXTRA pair, not a value mismatch", () => {
  // direction is part of the key — a bullish/bearish flip is a structurally
  // different classification, not a "the ratio drifted" value disagreement.
  const flipped: ClassifiedFlowItem = { ...TSLA_SKEW, direction: "bullish" };
  const diff = diffClassifiedLists([TSLA_SKEW], [flipped]);
  assert.equal(classificationDiffIsClean(diff), false);
  assert.equal(diff.onlyExpected.length, 1);
  assert.equal(diff.onlyActual.length, 1);
  assert.equal(diff.valueMismatches.length, 0);
});

test("diffClassifiedLists: empty vs empty is clean", () => {
  assert.equal(classificationDiffIsClean(diffClassifiedLists([], [])), true);
});
