import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtPct, formatAge, profitFactorTone } from "@/components/track-record/format";

describe("track-record format", () => {
  it("fmtPct formats percentages and null", () => {
    assert.equal(fmtPct(62.5), "62.5%");
    assert.equal(fmtPct(null), "—");
  });

  it("formatAge formats seconds and minutes", () => {
    const now = Date.now();
    assert.equal(formatAge(new Date(now - 5_000), now), "5s");
    assert.equal(formatAge(new Date(now - 125_000), now), "2m");
  });

  it("profitFactorTone maps thresholds", () => {
    assert.match(profitFactorTone(2.1), /cyan/);
    assert.match(profitFactorTone(1.2), /sky/);
    assert.match(profitFactorTone(0.8), /bear-text/);
    assert.equal(profitFactorTone(null), "text-mute");
  });
});
