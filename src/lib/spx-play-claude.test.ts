import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knownPlayLevels } from "./spx-play-claude";
import { checkNumbersGrounded } from "./grounding-guard";
import type { SpxDeskPayload } from "./providers/spx-desk";
import type { SpxConfluence } from "./spx-signals";
import type { PlayTechnicals } from "./spx-play-technicals";

function fakeDesk(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    price: 5900,
    vwap: 5895,
    hod: 5910,
    lod: 5880,
    pdh: 5920,
    pdl: 5870,
    gamma_flip: 5890,
    gex_king: 5900,
    max_pain: 5850,
    levels: [{ label: "S1", value: 5875, kind: "support", distance_pct: -0.4 }],
    gex_walls: [{ strike: 5950, net_gex: 1_000_000, kind: "resistance", distance_pts: 50 }],
    ...overrides,
  } as SpxDeskPayload;
}

function fakeConfluence(overrides: Partial<SpxConfluence> = {}): SpxConfluence {
  return {
    score: 8,
    grade: "A",
    direction: "long",
    levels: { entry: 5900, stop: 5880, target: 5950, invalidation: "" },
    ...overrides,
  } as SpxConfluence;
}

function fakeTechnicals(overrides: Partial<PlayTechnicals> = {}): PlayTechnicals {
  return {
    m3_close: 5901,
    m5_close: 5899,
    m5_ema20: 5893,
    ...overrides,
  } as PlayTechnicals;
}

describe("spx-play-claude: knownPlayLevels", () => {
  it("collects every price level fed into the prompt", () => {
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    for (const expected of [5900, 5895, 5910, 5880, 5920, 5870, 5890, 5850, 5875, 5950, 5901, 5899, 5893]) {
      assert.ok(known.includes(expected), `expected ${expected} in known levels`);
    }
  });

  it("skips null/non-positive levels without crashing", () => {
    const desk = fakeDesk({ vwap: null, hod: null, lod: null, pdh: null, pdl: null, gamma_flip: null, gex_king: null, max_pain: null, levels: [], gex_walls: [] });
    const confluence = fakeConfluence({ levels: { entry: null, stop: null, target: null, invalidation: "" } });
    const technicals = fakeTechnicals({ m3_close: null, m5_close: null, m5_ema20: null });
    const known = knownPlayLevels(desk, confluence, technicals);
    assert.deepEqual(known, [5900]);
  });
});

describe("spx-play-claude: grounding integration", () => {
  it("a thesis citing only real levels passes the shared guard", () => {
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    const thesis = "Price holding above VWAP 5895 with resistance at the gex wall 5950.";
    const result = checkNumbersGrounded(thesis, known);
    assert.equal(result.grounded, true);
  });

  it("a thesis citing a hallucinated level fails the shared guard", () => {
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    const thesis = "Price breaking out toward the next major level at 6120, a level nobody quoted.";
    const result = checkNumbersGrounded(thesis, known);
    assert.equal(result.grounded, false);
    assert.equal(result.ungroundedValue, 6120);
  });
});
