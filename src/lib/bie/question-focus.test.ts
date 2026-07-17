import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isNonsenseQuestion,
  wantsBrevity,
  wantsHelixPrintList,
  wantsPutWallOnly,
} from "./question-focus.ts";
import { classifyBieIntent, classifyBieStagingFallback } from "./router.ts";

describe("question-focus", () => {
  it("flags gibberish", () => {
    assert.equal(isNonsenseQuestion("asdfghjkl"), true);
    assert.equal(isNonsenseQuestion("1"), true);
    assert.equal(isNonsenseQuestion("What's SPX gamma flip"), false);
  });
  it("detects narrow asks", () => {
    assert.equal(wantsPutWallOnly("just the SPX put wall"), true);
    assert.equal(wantsBrevity("only answer in one sentence: SPX direction"), true);
    assert.equal(wantsBrevity("one line SPX bias"), true);
    assert.equal(wantsHelixPrintList("list only the top 3 HELIX prints by premium"), true);
  });
});

describe("router focused fallback", () => {
  it("unknown → clarify not market dump", () => {
    assert.equal(classifyBieStagingFallback("asdfghjkl").intent, "clarify_read");
    assert.equal(classifyBieStagingFallback("tell me something").intent, "clarify_read");
  });
  it("grid scanner rejections → grid_rejections_read", () => {
    assert.equal(classifyBieStagingFallback("grid scanner rejections last hour").intent, "grid_rejections_read");
  });
  it("play engine → play_engine_read", () => {
    assert.equal(classifyBieStagingFallback("is the play engine long or short right now").intent, "play_engine_read");
  });
  it("helix print list → helix_read", () => {
    assert.equal(classifyBieIntent("list only the top 3 HELIX prints by premium", new Set()).intent, "helix_read");
  });
  it("17 historically-BAD cases route correctly", () => {
    const ledger = new Set();
    const cases = [
      ["SPX call wall only", "spx_structure"],
      ["what's the king node on SPX right now", "spx_structure"],
      ["only answer in one sentence: SPX direction", "spx_desk_read"],
      ["one line SPX bias", "spx_desk_read"],
      ["what's charm doing on SPX 0DTE", "thermal_read"],
      ["compare SPX matrix GEX vs VEX at 7550", "thermal_read"],
      ["does thermal agree with the desk on SPX", "thermal_read"],
      ["what changed in the matrix in the last 5 minutes", "thermal_read"],
      ["list only the top 3 HELIX prints by premium", "helix_read"],
      ["grid scanner rejections last hour", "grid_rejections_read"],
      ["SPX lotto engine state", "play_engine_read"],
      ["is the play engine long or short right now", "play_engine_read"],
      ["why did you say bearish and bullish in the same breath", "spx_desk_read"],
      ["what's VIX doing and does it matter for today's SPX read", "market_context"],
      ["asdfghjkl", "clarify_read"],
      ["1", "clarify_read"],
      ["tell me something you don't know", "clarify_read"],
    ];
    for (const [q, intent] of cases) {
      assert.equal(classifyBieIntent(q, ledger)?.intent, intent, q);
    }
  });
});
