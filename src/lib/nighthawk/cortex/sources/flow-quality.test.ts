// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/flow-quality.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexFlowPrint } from "../types";
import {
  deriveFlowQualityEvidence,
  findFlowCluster,
  FLOW_SUPPORT_WEIGHT,
  OPPOSING_CLUSTER_VETO_PREMIUM,
} from "./flow-quality";

const NOW_MS = Date.parse(TEST_NOW);

function at(minAgo: number): string {
  return new Date(NOW_MS - minAgo * 60_000).toISOString();
}

function print(over: Partial<CortexFlowPrint>): CortexFlowPrint {
  return { premium: 500_000, direction: "bearish", kind: "sweep", at: at(5), ...over };
}

describe("flow-quality: opposing-cluster veto (design $1M / 15 min)", () => {
  test("bearish sweep+block cluster >= $1M vetoes a long", () => {
    const input = baseInputs({
      direction: "long",
      flow: {
        asOf: TEST_NOW,
        prints: [print({ premium: 600_000 }), print({ premium: 550_000, kind: "block", at: at(9) })],
      },
    });
    const items = deriveFlowQualityEvidence(input);
    assert.equal(items.filter((i) => i.stance === "veto").length, 1);
    assert.match(items[0].detail, /\$1\.1M/); // fmtMillions renders 1 decimal
    assert.match(items[0].detail, /2 prints/);
  });

  test("a single loud print is NOT a cluster (the single-print trap)", () => {
    const input = baseInputs({
      direction: "long",
      flow: { asOf: TEST_NOW, prints: [print({ premium: 1_400_000 })] },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("sub-$1M opposing cluster does not veto", () => {
    const input = baseInputs({
      direction: "long",
      flow: { asOf: TEST_NOW, prints: [print({ premium: 400_000 }), print({ premium: 450_000 })] },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("prints outside the 15-min window do not count", () => {
    const input = baseInputs({
      direction: "long",
      flow: {
        asOf: TEST_NOW,
        prints: [print({ premium: 600_000, at: at(20) }), print({ premium: 550_000, at: at(25) })],
      },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("unstamped prints ('' honesty sentinel) are excluded, never assumed fresh", () => {
    const input = baseInputs({
      direction: "long",
      flow: {
        asOf: TEST_NOW,
        prints: [print({ premium: 600_000, at: "" }), print({ premium: 550_000, at: "" })],
      },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("unknown-side prints never count toward either side (TRUTH MANDATE)", () => {
    const input = baseInputs({
      direction: "long",
      flow: {
        asOf: TEST_NOW,
        prints: [print({ direction: "unknown", premium: 900_000 }), print({ direction: "unknown", premium: 800_000 })],
      },
    });
    const items = deriveFlowQualityEvidence(input);
    assert.equal(items.length, 1);
    assert.equal(items[0].stance, "absent");
  });

  test("veto weight scales with cluster size relative to the $1M floor", () => {
    const cluster = findFlowCluster(
      [print({ premium: 1_500_000 }), print({ premium: 500_000, kind: "block" })],
      "bearish",
      NOW_MS
    );
    assert.ok(cluster);
    assert.equal(cluster.totalPremium / OPPOSING_CLUSTER_VETO_PREMIUM, 2);
  });
});

describe("flow-quality: aligned sweep-cluster support", () => {
  const alignedPrints = [
    print({ direction: "bullish", premium: 300_000, at: at(2) }),
    print({ direction: "bullish", premium: 280_000, at: at(6) }),
    print({ direction: "bullish", premium: 250_000, at: at(11) }),
  ];

  test(">= $750k across >= 3 prints with a sweep supports a long", () => {
    const input = baseInputs({ direction: "long", flow: { asOf: TEST_NOW, prints: alignedPrints } });
    const support = deriveFlowQualityEvidence(input).find((i) => i.stance === "supports");
    assert.ok(support);
    assert.equal(support.weight, FLOW_SUPPORT_WEIGHT);
    assert.match(support.detail, /\$0\.8M/);
    // asOf = the NEWEST print in the cluster, so decay runs off real tape time.
    assert.equal(support.asOf, at(2));
  });

  test("two prints are not enough for support (harder to earn than the veto)", () => {
    const input = baseInputs({
      direction: "long",
      flow: { asOf: TEST_NOW, prints: alignedPrints.slice(0, 2).map((p) => ({ ...p, premium: 500_000 })) },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "supports"), false);
  });

  test("a pure block stack (zero sweeps) earns no urgency support", () => {
    const input = baseInputs({
      direction: "long",
      flow: { asOf: TEST_NOW, prints: alignedPrints.map((p) => ({ ...p, kind: "block" as const })) },
    });
    assert.equal(deriveFlowQualityEvidence(input).some((i) => i.stance === "supports"), false);
  });

  test("'other' texture (RepeatedHits etc.) counts toward neither cluster", () => {
    const input = baseInputs({
      direction: "long",
      flow: { asOf: TEST_NOW, prints: alignedPrints.map((p) => ({ ...p, kind: "other" as const })) },
    });
    const items = deriveFlowQualityEvidence(input);
    assert.equal(items.length, 1);
    assert.equal(items[0].stance, "absent");
  });
});

describe("flow-quality: honesty", () => {
  test("absent without the slice; error class surfaces", () => {
    assert.equal(deriveFlowQualityEvidence(baseInputs())[0].stance, "absent");
    const failed = baseInputs({ errors: { "flow-quality": "CortexSourceTimeout" } });
    assert.match(deriveFlowQualityEvidence(failed)[0].detail, /CortexSourceTimeout/);
  });
});
