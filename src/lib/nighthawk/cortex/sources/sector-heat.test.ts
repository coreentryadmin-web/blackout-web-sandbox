// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/sector-heat.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexSectorSlice } from "../types";
import { deriveSectorHeatEvidence, SECTOR_HEAT_WEIGHT } from "./sector-heat";

function sector(over: Partial<CortexSectorSlice> = {}): CortexSectorSlice {
  return {
    asOf: TEST_NOW,
    sectorName: "Technology",
    sectorChangePct: -1.2,
    breadthTone: null,
    tickerChangePct: -0.8,
    ...over,
  };
}

describe("sector-heat: single-name sector alignment", () => {
  test("red sector opposes a long; supports a short", () => {
    const long = baseInputs({ direction: "long", sector: sector() });
    const oppose = deriveSectorHeatEvidence(long)[0];
    assert.equal(oppose.stance, "opposes");
    assert.equal(oppose.weight, SECTOR_HEAT_WEIGHT);
    assert.match(oppose.detail, /-1\.2%/);

    const short = baseInputs({ direction: "short", sector: sector() });
    assert.equal(deriveSectorHeatEvidence(short)[0].stance, "supports");
  });

  test("a flat sector (<0.5%) is absent, not a fabricated lean", () => {
    const input = baseInputs({ direction: "long", sector: sector({ sectorChangePct: 0.3 }) });
    const item = deriveSectorHeatEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /flat/);
  });

  test("catalyst exemption: a same-day catalyst suppresses the OPPOSITION, visibly", () => {
    const input = baseInputs({
      direction: "long",
      sector: sector(),
      news: {
        asOf: TEST_NOW,
        items: [
          {
            headline: "FDA grants approval",
            channels: ["fda"],
            publishedAt: new Date(Date.parse(TEST_NOW) - 3600_000).toISOString(),
            tickers: ["TEST"],
          },
        ],
        earningsToday: null,
      },
    });
    const item = deriveSectorHeatEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /catalyst/);
    assert.match(item.detail, /decoupling is the thesis/);
  });

  test("catalyst exemption never suppresses SUPPORT (alignment still counts)", () => {
    const input = baseInputs({
      direction: "short",
      sector: sector(),
      news: {
        asOf: TEST_NOW,
        items: [
          {
            headline: "FDA grants approval",
            channels: ["fda"],
            publishedAt: new Date(Date.parse(TEST_NOW) - 3600_000).toISOString(),
            tickers: ["TEST"],
          },
        ],
        earningsToday: null,
      },
    });
    assert.equal(deriveSectorHeatEvidence(input)[0].stance, "supports");
  });
});

describe("sector-heat: index breadth branch", () => {
  test("negative breadth supports a short, opposes a long", () => {
    const slice = sector({ sectorName: null, sectorChangePct: null, breadthTone: "negative" });
    assert.equal(deriveSectorHeatEvidence(baseInputs({ direction: "short", sector: slice }))[0].stance, "supports");
    assert.equal(deriveSectorHeatEvidence(baseInputs({ direction: "long", sector: slice }))[0].stance, "opposes");
  });

  test("mixed/unknown breadth is absent (no directional room)", () => {
    for (const tone of ["mixed", "unknown"] as const) {
      const slice = sector({ sectorName: null, sectorChangePct: null, breadthTone: tone });
      assert.equal(deriveSectorHeatEvidence(baseInputs({ sector: slice }))[0].stance, "absent");
    }
  });
});

describe("sector-heat: honesty", () => {
  test("absent without the slice / without a sector row", () => {
    assert.equal(deriveSectorHeatEvidence(baseInputs())[0].stance, "absent");
    const noRow = baseInputs({ sector: sector({ sectorName: null, sectorChangePct: null }) });
    assert.equal(deriveSectorHeatEvidence(noRow)[0].stance, "absent");
  });
});
