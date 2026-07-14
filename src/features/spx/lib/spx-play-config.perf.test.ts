import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playClaudeGateEnabled, playMemberReadCacheSec } from "./spx-play-config";

describe("playClaudeGateEnabled", () => {
  it("defaults off on non-staging when SPX_CLAUDE_GATE unset", () => {
    delete process.env.SPX_CLAUDE_GATE;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(playClaudeGateEnabled(), false);
  });

  it("defaults on for staging deploy when SPX_CLAUDE_GATE unset", () => {
    delete process.env.SPX_CLAUDE_GATE;
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    assert.equal(playClaudeGateEnabled(), true);
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("explicit SPX_CLAUDE_GATE=0 overrides staging default", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    process.env.SPX_CLAUDE_GATE = "0";
    assert.equal(playClaudeGateEnabled(), false);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SPX_CLAUDE_GATE;
  });
});

describe("playMemberReadCacheSec", () => {
  it("defaults to 2 seconds for member play read collapse", () => {
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
    assert.equal(playMemberReadCacheSec(), 2);
  });

  it("reads SPX_PLAY_MEMBER_READ_CACHE_SEC override", () => {
    process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC = "5";
    assert.equal(playMemberReadCacheSec(), 5);
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
  });
});
