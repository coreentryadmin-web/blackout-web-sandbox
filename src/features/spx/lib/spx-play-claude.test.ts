// Hermetic: evaluateClaudePlayApproval touches Postgres (verdict cache / daily budget /
// audit log) whenever a DATABASE_URL is present, and calls the real Anthropic API when
// configured. Blank the DB env BEFORE any import so dbConfigured() reads false at call time
// (the audit sandbox has DATABASE_URL set but Postgres TCP blocked -> hangs otherwise,
// matching the pattern in nighthawk/discovery-quality.test.ts), and mock.module the
// Anthropic provider so the Claude-gate path below is deterministic and network-free
// (matching nighthawk/play-critic.test.ts, which tests the same grounding-guard bug class).
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { checkNumbersGrounded } from "@/lib/grounding-guard";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxConfluence } from "./spx-signals";
import type { PlayTechnicals } from "./spx-play-technicals";
import type { PlayGateResult } from "./spx-play-gates";
import type { PlayConfirmationResult } from "./spx-play-confirmations";

// mock.module must run before spx-play-claude.ts (or anything that imports it) is first
// loaded in this process, so every import of the module under test below is a dynamic
// `await import("./spx-play-claude")` inside a `before()` hook rather than a static
// top-level import — a static import here would resolve/instantiate the real
// providers/anthropic.ts ahead of this call and the mock would never take effect.
let mockRaw: string | null = null;
mock.module("../../../lib/providers/anthropic", {
  namedExports: {
    anthropicConfigured: () => true,
    anthropicText: async () => mockRaw,
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
  return { passed: true, blocks: [], warnings: [], entry_mode: "full", play_idea: null, ...overrides };
}

function fakeConfirmations(overrides: Partial<PlayConfirmationResult> = {}): PlayConfirmationResult {
  return { passed: true, passed_count: 5, total: 5, checks: [], ...overrides };
}

describe("spx-play-claude: knownPlayLevels", () => {
  let knownPlayLevels: typeof import("./spx-play-claude").knownPlayLevels;

  before(async () => {
    ({ knownPlayLevels } = await import("./spx-play-claude"));
  });

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
  let knownPlayLevels: typeof import("./spx-play-claude").knownPlayLevels;

  before(async () => {
    ({ knownPlayLevels } = await import("./spx-play-claude"));
  });

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

  it("a headline citing only real levels (joined with a grounded thesis) passes the shared guard", () => {
    // Mirrors exactly what evaluateClaudePlayApproval now runs: `${headline} ${thesis}`.
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    const headline = "Break above VWAP 5895 targets the 5950 gex wall";
    const thesis = "Price holding above VWAP 5895 with resistance at the gex wall 5950.";
    const result = checkNumbersGrounded(`${headline} ${thesis}`, known);
    assert.equal(result.grounded, true);
  });

  it("a headline citing a hallucinated level fails the shared guard even though the thesis alone is fully grounded", () => {
    // Regression for the bug this branch fixes: previously only `result.thesis` was passed
    // to checkNumbersGrounded, so a fabricated number confined to the headline (never
    // repeated in the thesis) would have sailed through ungrounded. Checking the joined
    // string catches it.
    const known = knownPlayLevels(fakeDesk(), fakeConfluence(), fakeTechnicals());
    const headline = "Breakout toward the next major level at 6120";
    const thesis = "Price holding above VWAP 5895 with resistance at the gex wall 5950.";
    const thesisOnly = checkNumbersGrounded(thesis, known);
    assert.equal(thesisOnly.grounded, true, "sanity: the thesis alone must NOT catch the bad headline number");
    const joined = checkNumbersGrounded(`${headline} ${thesis}`, known);
    assert.equal(joined.grounded, false);
    assert.equal(joined.ungroundedValue, 6120);
  });
});

describe("spx-play-claude: evaluateClaudePlayApproval headline grounding (integration)", () => {
  let evaluateClaudePlayApproval: typeof import("./spx-play-claude").evaluateClaudePlayApproval;

  before(async () => {
    ({ evaluateClaudePlayApproval } = await import("./spx-play-claude"));
  });

  it("a Claude verdict with a grounded headline and thesis is approved as-is", async () => {
    mockRaw = JSON.stringify({
      verdict: "APPROVE_BUY",
      direction: "long",
      headline: "Break above VWAP 5895 targets 5950",
      thesis: "Price holding above VWAP 5895 with resistance at the gex wall 5950.",
    });
    const result = await evaluateClaudePlayApproval(
      fakeDesk(),
      fakeConfluence({ score: 11 }), // distinct cache key from the fallback test below
      fakeGates(),
      fakeConfirmations(),
      fakeTechnicals(),
      { forceClaude: true }
    );
    assert.equal(result.source, "claude");
    assert.equal(result.approved, true);
    assert.equal(result.headline, "Break above VWAP 5895 targets 5950");
  });

  it("a headline with a fabricated level is caught and the whole verdict falls back to mechanical, even with a grounded thesis", async () => {
    mockRaw = JSON.stringify({
      verdict: "APPROVE_BUY",
      direction: "long",
      headline: "Breakout toward next major level 6120", // fabricated — not in knownPlayLevels
      thesis: "Price holding above VWAP 5895 with resistance at the gex wall 5950.", // fully grounded
    });
    const result = await evaluateClaudePlayApproval(
      fakeDesk(),
      fakeConfluence({ score: 12 }), // distinct cache key from the pass-through test above
      fakeGates(),
      fakeConfirmations(),
      fakeTechnicals(),
      { forceClaude: true }
    );
    // The fabricated headline never reached the member: the whole verdict (not just the
    // ungrounded prose) fell back to the deterministic mechanical gate.
    assert.equal(result.source, "mechanical");
    assert.notEqual(result.headline, "Breakout toward next major level 6120");
    assert.match(result.thesis, /unverified level/);
  });
});
