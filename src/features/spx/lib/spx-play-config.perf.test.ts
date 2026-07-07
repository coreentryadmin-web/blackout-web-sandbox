import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playMemberReadCacheSec } from "./spx-play-config";

describe("playMemberReadCacheSec", () => {
  it("defaults to 3 seconds for member play read collapse", () => {
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
    assert.equal(playMemberReadCacheSec(), 3);
  });

  it("reads SPX_PLAY_MEMBER_READ_CACHE_SEC override", () => {
    process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC = "5";
    assert.equal(playMemberReadCacheSec(), 5);
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
  });
});
