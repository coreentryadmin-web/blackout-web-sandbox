// BIE cross-surface cross-check tests (PR-L4e-4) — hermetic. The IO seams (desk platform cache,
// Vector full-state reader, DTE-horizon normalizer) are mocked with mock.module BEFORE the module
// under test loads; cross-check-read.ts's own dynamic imports use RELATIVE specifiers, so the same
// relative specifiers registered here (this file lives in the same dir) resolve to the same URLs.

import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mutable mock state (reset per test) ─────────────────────────────────────────────
let desk: Record<string, unknown> | null = null;
let vectorState: Record<string, unknown> | null = null;

mock.module("./platform-cache", {
  namedExports: {
    getCachedBiePlatformContext: async () => ({ desk }),
    // cross-check-read imports ONLY getCachedBiePlatformContext from here, but the real module has
    // more named exports; a partial mock is fine because nothing else is referenced.
  },
});

mock.module("./vector-full-state", {
  namedExports: {
    fetchVectorFullState: async () => vectorState,
  },
});

mock.module("../../features/vector/lib/vector-dte-horizon", {
  namedExports: {
    normalizeDteHorizon: (h: string) => h,
  },
});

let mod: typeof import("./cross-check-read");
before(async () => {
  mod = await import("./cross-check-read");
});

beforeEach(() => {
  desk = { max_pain: 7525, gamma_flip: 7496, gamma_regime: "amplification", as_of: "2026-07-14T15:00:00Z" };
  vectorState = { maxPain: 7400, gammaFlip: 7496, regime: { posture: "negative-gamma" } };
});

// ── Pure helpers ────────────────────────────────────────────────────────────────────
test("metricsMateriallyDiffer: material vs immaterial vs incomparable", () => {
  assert.equal(mod.metricsMateriallyDiffer(7525, 7400), true); // 1.7% — material
  assert.equal(mod.metricsMateriallyDiffer(7500, 7501), false); // 0.013% — noise
  assert.equal(mod.metricsMateriallyDiffer(7500, null), false); // one side missing
  assert.equal(mod.metricsMateriallyDiffer(null, null), false);
});

test("coarsePosture maps both surfaces' vocabularies (or null when neither)", () => {
  assert.equal(mod.coarsePosture("amplification"), "negative-γ");
  assert.equal(mod.coarsePosture("negative-gamma"), "negative-γ");
  assert.equal(mod.coarsePosture("mean_revert"), "positive-γ");
  assert.equal(mod.coarsePosture("positive-gamma"), "positive-γ");
  assert.equal(mod.coarsePosture("something else"), null);
  assert.equal(mod.coarsePosture(null), null);
});

// ── Divergence flagging (the gauntlet bug) ───────────────────────────────────────────
test("FLAGS a material max-pain divergence explicitly (desk 7525 vs Vector 7400)", async () => {
  const r = await mod.composeCrossCheck("SPX", "all");
  assert.match(r.answer, /DISAGREE on max pain/i);
  assert.match(r.answer, /Max pain — desk 7,525 vs Vector 7,400 → \*\*DISAGREE\*\*/);
  // Agreeing metrics are shown as agreeing, not silently dropped.
  assert.match(r.answer, /Gamma flip — desk 7,496 vs Vector 7,496 → agree/);
  assert.match(r.answer, /Regime — desk negative-γ vs Vector negative-γ → agree/);
  const ctx = r.context as { disagreements: string[] };
  assert.deepEqual(ctx.disagreements, ["max pain"]);
});

test("when the surfaces AGREE, says so (no false alarm)", async () => {
  vectorState = { maxPain: 7524, gammaFlip: 7496, regime: { posture: "negative-gamma" } };
  const r = await mod.composeCrossCheck("SPX", "all");
  assert.match(r.answer, /agree\b/i);
  assert.doesNotMatch(r.answer, /DISAGREE/);
  const ctx = r.context as { disagreements: string[] };
  assert.deepEqual(ctx.disagreements, []);
});

test("flags a regime divergence too", async () => {
  desk = { max_pain: 7500, gamma_flip: 7496, gamma_regime: "mean_revert", as_of: null };
  vectorState = { maxPain: 7500, gammaFlip: 7496, regime: { posture: "negative-gamma" } };
  const r = await mod.composeCrossCheck("SPX", "all");
  assert.match(r.answer, /DISAGREE on regime/i);
  assert.match(r.answer, /Regime — desk positive-γ vs Vector negative-γ → \*\*DISAGREE\*\*/);
});

test("a missing surface → honest 'can't cross-check', never one side dressed as both", async () => {
  vectorState = null;
  const r = await mod.composeCrossCheck("SPX", "all");
  assert.match(r.answer, /can't cross-check/i);
  assert.match(r.answer, /Vector returned no live read/i);
  assert.doesNotMatch(r.answer, /DISAGREE/);
});
