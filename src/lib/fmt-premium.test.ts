import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtPremium } from "./api";

// fmtPremium feeds GEX Net, 0DTE Net, wall net_gex, the HELIX tape and tide
// premiums — all routinely negative — so the sign MUST sit outside the $ glyph
// and sub-$10K resolution must survive. Run: npx tsx --test src/lib/fmt-premium.test.ts

test("null renders the em-dash placeholder", () => {
  assert.equal(fmtPremium(null), "—");
});

test("negative millions sign outside the glyph (-$1.2M, not $-1.2M)", () => {
  assert.equal(fmtPremium(-1_200_000), "-$1.2M");
  assert.equal(fmtPremium(-12_400_000), "-$12.4M");
});

test("positive millions unchanged", () => {
  assert.equal(fmtPremium(1_200_000), "$1.2M");
  assert.equal(fmtPremium(2_000_000), "$2.0M");
});

test("negative thousands sign outside the glyph (-$340K, not $-340K)", () => {
  assert.equal(fmtPremium(-340_000), "-$340K");
});

test("sub-$10K keeps 1 decimal so $1.4K vs $1.5K don't collapse", () => {
  assert.equal(fmtPremium(1_400), "$1.4K");
  assert.equal(fmtPremium(1_500), "$1.5K");
  assert.equal(fmtPremium(-1_400), "-$1.4K");
  assert.equal(fmtPremium(9_900), "$9.9K");
});

test("$10K and above stays whole-K", () => {
  assert.equal(fmtPremium(10_000), "$10K");
  assert.equal(fmtPremium(340_000), "$340K");
  assert.equal(fmtPremium(-10_000), "-$10K");
});

test("sub-$1K renders whole dollars with sign outside", () => {
  assert.equal(fmtPremium(900), "$900");
  assert.equal(fmtPremium(-900), "-$900");
  assert.equal(fmtPremium(0), "$0");
});
