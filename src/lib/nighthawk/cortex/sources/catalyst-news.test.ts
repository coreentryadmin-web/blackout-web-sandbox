// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/catalyst-news.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexFlowPrint, CortexNewsItem } from "../types";
import {
  catalystTag,
  deriveCatalystNewsEvidence,
  freshCatalystItem,
  isCatalystItem,
  CATALYST_CONFIRMED_FLOW_WEIGHT,
  EARNINGS_TODAY_OPPOSE_WEIGHT,
} from "./catalyst-news";

const NOW_MS = Date.parse(TEST_NOW);

function newsItem(over: Partial<CortexNewsItem> = {}): CortexNewsItem {
  return {
    headline: "Company update",
    channels: [],
    publishedAt: new Date(NOW_MS - 2 * 3600_000).toISOString(),
    tickers: ["TEST"],
    ...over,
  };
}

function alignedCluster(): CortexFlowPrint[] {
  return [1, 2, 3].map((i) => ({
    premium: 300_000,
    direction: "bullish" as const,
    kind: "sweep" as const,
    at: new Date(NOW_MS - i * 3 * 60_000).toISOString(),
  }));
}

describe("catalyst-news: deterministic tagging (no LLM, no sentiment)", () => {
  test("channel tagging", () => {
    assert.equal(isCatalystItem(newsItem({ channels: ["FDA"] })), true);
    assert.equal(isCatalystItem(newsItem({ channels: ["markets"] })), false);
  });

  test("keyword fallback on the headline", () => {
    assert.equal(isCatalystItem(newsItem({ headline: "XYZ receives FDA approval" })), true);
    assert.equal(isCatalystItem(newsItem({ headline: "Broker raises guidance outlook" })), true);
    assert.equal(isCatalystItem(newsItem({ headline: "Shares moved today" })), false);
  });

  test("catalystTag prefers the channel, falls back to the matched keyword", () => {
    assert.equal(catalystTag(newsItem({ channels: ["m&a"], headline: "acquires rival" })), "m&a");
    assert.equal(catalystTag(newsItem({ headline: "XYZ acquires rival" })), "acquires");
  });

  test("stale (>24h) or unstamped items are never catalysts", () => {
    const stale = baseInputs({
      news: {
        asOf: TEST_NOW,
        items: [newsItem({ channels: ["fda"], publishedAt: new Date(NOW_MS - 30 * 3600_000).toISOString() })],
        earningsToday: null,
      },
    });
    assert.equal(freshCatalystItem(stale), null);
    const unstamped = baseInputs({
      news: { asOf: TEST_NOW, items: [newsItem({ channels: ["fda"], publishedAt: "" })], earningsToday: null },
    });
    assert.equal(freshCatalystItem(unstamped), null);
  });
});

describe("catalyst-news: catalyst-confirmed flow (the upgrade signal)", () => {
  test("catalyst + aligned cluster => support (both legs required)", () => {
    const both = baseInputs({
      direction: "long",
      news: { asOf: TEST_NOW, items: [newsItem({ channels: ["guidance"] })], earningsToday: null },
      flow: { asOf: TEST_NOW, prints: alignedCluster() },
    });
    const support = deriveCatalystNewsEvidence(both).find((i) => i.stance === "supports");
    assert.ok(support);
    assert.equal(support.weight, CATALYST_CONFIRMED_FLOW_WEIGHT);
    assert.match(support.detail, /guidance/);
    assert.match(support.detail, /informed flow/);

    const noFlow = baseInputs({
      direction: "long",
      news: { asOf: TEST_NOW, items: [newsItem({ channels: ["guidance"] })], earningsToday: null },
      flow: { asOf: TEST_NOW, prints: [] },
    });
    assert.equal(deriveCatalystNewsEvidence(noFlow).some((i) => i.stance === "supports"), false);

    const noCatalyst = baseInputs({
      direction: "long",
      news: { asOf: TEST_NOW, items: [newsItem()], earningsToday: null },
      flow: { asOf: TEST_NOW, prints: alignedCluster() },
    });
    assert.equal(deriveCatalystNewsEvidence(noCatalyst).some((i) => i.stance === "supports"), false);
  });

  test("the support decays from the catalyst's PUBLISH time, not fetch time", () => {
    const publishedAt = new Date(NOW_MS - 2 * 3600_000).toISOString();
    const input = baseInputs({
      direction: "long",
      news: { asOf: TEST_NOW, items: [newsItem({ channels: ["fda"], publishedAt })], earningsToday: null },
      flow: { asOf: TEST_NOW, prints: alignedCluster() },
    });
    const support = deriveCatalystNewsEvidence(input).find((i) => i.stance === "supports");
    assert.equal(support?.asOf, publishedAt);
  });
});

describe("catalyst-news: earnings-today opposition", () => {
  test("AMC earnings oppose new premium (either direction — 0DTE commits BUY premium)", () => {
    for (const direction of ["long", "short"] as const) {
      const input = baseInputs({
        direction,
        news: { asOf: TEST_NOW, items: [], earningsToday: "afterhours" },
      });
      const oppose = deriveCatalystNewsEvidence(input).find((i) => i.stance === "opposes");
      assert.ok(oppose, direction);
      assert.equal(oppose.weight, EARNINGS_TODAY_OPPOSE_WEIGHT);
      assert.match(oppose.detail, /earnings today/);
    }
  });

  test("unknown report time is treated like AMC (risk exists, timing unverified)", () => {
    const input = baseInputs({ news: { asOf: TEST_NOW, items: [], earningsToday: "unknown" } });
    assert.equal(deriveCatalystNewsEvidence(input).some((i) => i.stance === "opposes"), true);
  });

  test("premarket earnings (already reported by the open) do not oppose", () => {
    const input = baseInputs({ news: { asOf: TEST_NOW, items: [], earningsToday: "premarket" } });
    assert.equal(deriveCatalystNewsEvidence(input).some((i) => i.stance === "opposes"), false);
  });
});

describe("catalyst-news: honesty", () => {
  test("no catalyst + no earnings => absent with the hedge-noise disclosure", () => {
    const input = baseInputs({ news: { asOf: TEST_NOW, items: [newsItem()], earningsToday: null } });
    const item = deriveCatalystNewsEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /uncatalyzed/);
  });

  test("absent without the slice; reader error class surfaces", () => {
    assert.equal(deriveCatalystNewsEvidence(baseInputs())[0].stance, "absent");
    const failed = baseInputs({ errors: { "catalyst-news": "unavailable: http 502" } });
    assert.match(deriveCatalystNewsEvidence(failed)[0].detail, /reader failed/);
  });
});
