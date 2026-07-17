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
});
