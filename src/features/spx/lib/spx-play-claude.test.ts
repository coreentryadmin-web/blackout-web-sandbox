// Hermetic: evaluateClaudePlayApproval uses BIE/Voyage precedent search (no Anthropic).
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";
process.env.VOYAGE_API_KEY = "";

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { checkNumbersGrounded } from "@/lib/grounding-guard";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxConfluence } from "./spx-signals";
import type { PlayTechnicals } from "./spx-play-technicals";
import type { PlayGateResult } from "./spx-play-gates";
import { emptyCategorizedGateBlocks } from "./playbook-gate-categories";
import type { PlayConfirmationResult } from "./spx-play-confirmations";

let mockPrecedentChunks: { chunk: string; similarity: number }[] = [];

mock.module("../../../lib/bie/precedent-search", {
  namedExports: {
    findSimilarPrecedents: async () => mockPrecedentChunks,
  },
});

mock.module("../../../lib/bie/embeddings", {
  namedExports: {
    bieEmbeddingsConfigured: () => false,
  },
});

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
    conflicts: [],
    agreeing: [],
    factors: [],
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

function fakeGates(overrides: Partial<PlayGateResult> = {}): PlayGateResult {
  return {
    passed: true,
    blocks: [],
    blocks_by_category: emptyCategorizedGateBlocks(),
    warnings: [],
    entry_mode: "full",
    play_idea: null,
    ...overrides,
  };
}

function fakeConfirmations(overrides: Partial<PlayConfirmationResult> = {}): PlayConfirmationResult {
  return { passed: true, passed_count: 5, total: 5, checks: [], ...overrides };
}

describe("spx-play-claude: knownPlayLevels", () => {
  let knownPlayLevels: typeof import("./spx-play-claude").knownPlayLevels;

  before(async () => {
    ({ knownPlayLevels } = await import("./spx-play-claude"));
  });

  it("collects desk + confluence + technical price levels", () => {
    const levels = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    assert.ok(levels.includes(5900));
    assert.ok(levels.includes(5875));
    assert.ok(levels.includes(5901));
  });
});

describe("spx-play-claude: grounding integration", () => {
  let knownPlayLevels: typeof import("./spx-play-claude").knownPlayLevels;

  before(async () => {
    ({ knownPlayLevels } = await import("./spx-play-claude"));
  });

  it("flags fabricated levels in combined headline+thesis", () => {
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    const bad = checkNumbersGrounded("Breakout above 6123.45 on thin tape", known);
    assert.equal(bad.grounded, false);
  });
});

describe("spx-play-claude: evaluateClaudePlayApproval mechanical path", () => {
  let evaluateClaudePlayApproval: typeof import("./spx-play-claude").evaluateClaudePlayApproval;

  before(async () => {
    ({ evaluateClaudePlayApproval } = await import("./spx-play-claude"));
  });

  it("returns mechanical verdict when BIE is not configured", async () => {
    const verdict = await evaluateClaudePlayApproval(
      fakeDesk(),
      fakeConfluence(),
      fakeGates(),
      fakeConfirmations(),
      fakeTechnicals()
    );
    assert.equal(verdict.source, "mechanical");
    assert.equal(verdict.approved, true);
    assert.match(verdict.headline, /CALL/);
  });

  it("vetoes when gates fail without calling BIE", async () => {
    const verdict = await evaluateClaudePlayApproval(
      fakeDesk(),
      fakeConfluence(),
      fakeGates({ passed: false, blocks: ["halt"] }),
      fakeConfirmations(),
      fakeTechnicals()
    );
    assert.equal(verdict.approved, false);
    assert.equal(verdict.verdict, "VETO");
  });
});
