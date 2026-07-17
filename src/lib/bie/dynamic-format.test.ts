import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyDynamicFormat } from "@/lib/bie/dynamic-format";
import { isRichBieEnvelope } from "@/lib/bie/envelope-richness";
import type { BieRoute } from "@/lib/bie/router";

const route = (intent: BieRoute["intent"]): BieRoute => ({
  intent,
  ticker: null,
  ticker_b: null,
  horizon: null,
});

describe("applyDynamicFormat", () => {
  test("play engine state → markdown table + structured table field", () => {
    const out = applyDynamicFormat(route("play_engine_read"), "play engine state", {
      answer: "**SPX play engine state**\n- Slayer flat",
      context: {
        openPlay: null,
        lotto: { phase: "NONE" },
        powerHour: { phase: "NONE" },
      },
    });
    assert.match(out.answer, /\| Engine \| Phase \|/);
    assert.equal(out.envelope?.sections[0]?.table?.headers[0], "Engine");
    assert.equal(isRichBieEnvelope(out.envelope), true);
  });

  test("put wall only → focused level line", () => {
    const out = applyDynamicFormat(route("spx_structure"), "where is the put wall", {
      answer: "Long gamma read with walls...",
      context: {
        narrow: "put_wall",
        raw: { put_wall: 7480, price: 7520 },
      },
    });
    assert.match(out.answer, /put wall.*7,480/i);
    assert.match(out.answer, /7,520/);
    assert.equal(isRichBieEnvelope(out.envelope), true);
  });

  test("one sentence → truncated prose", () => {
    const long =
      "SPX is pinned above the flip. Dealers are long gamma. Range is tight. Watch the call wall.";
    const out = applyDynamicFormat(route("spx_desk_read"), "SPX direction in one sentence", {
      answer: long,
      context: {},
    });
    assert.ok(out.answer.length < long.length + 200);
    assert.match(out.answer, /SPX is pinned/);
  });

  test("prose shape leaves answer unchanged", () => {
    const composed = {
      answer: "**Command board**\n- Play A",
      context: {},
    };
    const out = applyDynamicFormat(route("zerodte_plays"), "how are plays doing", composed);
    assert.equal(out.answer, composed.answer);
    assert.equal(out.envelope, undefined);
  });

  test("skips already-rich envelopes", () => {
    const rich = {
      answer: "rich",
      context: {},
      envelope: {
        version: 1 as const,
        headline: "Verdict",
        bias: "mixed" as const,
        sections: [
          { title: "A", body: "a", evidence: [{ kind: "fact" as const, text: "x" }] },
          { title: "B", body: "b" },
        ],
        evidence: [],
        confidence: { level: "high" as const, why: "test" },
        asOf: new Date().toISOString(),
        markdown: "rich",
      },
    };
    const out = applyDynamicFormat(route("verdict"), "is SPX good", rich);
    assert.equal(out.envelope?.sections.length, 2);
  });
});
