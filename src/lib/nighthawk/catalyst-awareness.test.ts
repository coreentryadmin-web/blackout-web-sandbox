import { test } from "node:test";
import assert from "node:assert/strict";
import type { BenzingaCatalyst } from "@/lib/providers/polygon";
import { scoreCatalystAwareness, CATALYST_CAP } from "./scorer";

function cat(over: Partial<BenzingaCatalyst>): BenzingaCatalyst {
  return {
    channel: "",
    type: "other",
    title: "headline",
    published: "2026-06-25T20:00:00Z",
    ...over,
  };
}

test("catalyst: no catalysts → 0, no flags", () => {
  const r = scoreCatalystAwareness([], "long");
  assert.equal(r.score, 0);
  assert.deepEqual(r.flags, []);
  const r2 = scoreCatalystAwareness(null, "long");
  assert.equal(r2.score, 0);
});

test("catalyst: a binary (FDA) event PENALIZES a long directional play", () => {
  const r = scoreCatalystAwareness([cat({ type: "binary", title: "FDA PDUFA date set for June 30" })], "long");
  assert.ok(r.score < 0, "binary should shade the score down");
  assert.ok(r.flags.some((f) => f.toLowerCase().includes("binary")));
});

test("catalyst: a binary (FDA) event penalizes a SHORT too (direction-agnostic coin-flip)", () => {
  const r = scoreCatalystAwareness([cat({ type: "binary" })], "short");
  assert.ok(r.score < 0, "binary risk applies regardless of direction");
});

test("catalyst: binary counted ONCE even with multiple FDA headlines", () => {
  const single = scoreCatalystAwareness([cat({ type: "binary" })], "long").score;
  const triple = scoreCatalystAwareness(
    [cat({ type: "binary" }), cat({ type: "binary" }), cat({ type: "binary" })],
    "long"
  ).score;
  assert.equal(single, triple, "binary penalty must not stack");
});

test("catalyst: buyback is a tailwind for a long, headwind for a short", () => {
  const long = scoreCatalystAwareness([cat({ type: "buyback" })], "long");
  const short = scoreCatalystAwareness([cat({ type: "buyback" })], "short");
  assert.ok(long.score > 0);
  assert.ok(short.score < 0);
  assert.ok(long.flags.some((f) => f.toLowerCase().includes("buyback")));
});

test("catalyst: dilutive offering is a headwind for a long, tailwind for a short", () => {
  const long = scoreCatalystAwareness([cat({ type: "offering" })], "long");
  const short = scoreCatalystAwareness([cat({ type: "offering" })], "short");
  assert.ok(long.score < 0);
  assert.ok(short.score > 0);
});

test("catalyst: nudge is bounded by ±CATALYST_CAP and stays minor", () => {
  // Pile on every positive catalyst; the cap must hold and stay small (never override flow).
  const r = scoreCatalystAwareness(
    [cat({ type: "buyback" }), cat({ type: "m&a" }), cat({ type: "guidance" })],
    "long"
  );
  assert.ok(r.score <= CATALYST_CAP && r.score >= -CATALYST_CAP);
  assert.ok(CATALYST_CAP <= 8, "catalyst nudge must remain a minor modifier");
});

test("catalyst: guidance/insider/short are awareness-only flags (no score weight)", () => {
  const r = scoreCatalystAwareness(
    [cat({ type: "guidance" }), cat({ type: "insider" }), cat({ type: "short" })],
    "long"
  );
  assert.equal(r.score, 0);
  assert.ok(r.flags.length >= 3);
});
