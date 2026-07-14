import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";
import { composeVectorDeskBrief } from "@/lib/bie/vector-desk-brief";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

describe("composeVectorDeskBrief", () => {
  test("returns a structured brief with every surface label + the play sections", () => {
    const result = composeVectorDeskBrief(VECTOR_FULL_STATE_FIXTURE);

    // Headline carries the ticker, a grounded {{spot}}, and a play verb.
    assert.match(result.headline, /SPX/);
    assert.match(result.headline, /\{\{[\d,.\-+ ]+\}\}/);

    // Every Vector surface + the play breakdown appears in the body.
    for (const label of [
      "REGIME",
      "WALLS",
      "WALL DYNAMICS",
      "MAGNET",
      "MAX PAIN",
      "EXPECTED MOVE",
      "TECHNICALS",
      "LADDER",
      "VEX",
      "DARK POOL",
      "FLOW",
      "PLAY",
      "THESIS",
      "SETUP",
      "RISK",
      "NEXT",
    ]) {
      assert.ok(result.body.includes(label), `body missing ${label}`);
    }

    // Bias maps from the play bias: fixture play is "short" → bearish.
    assert.equal(result.bias, "bearish");
    assert.ok(["bullish", "bearish", "neutral"].includes(result.bias));

    // watch mirrors the play's starred set (headline first).
    assert.deepEqual(result.watch, VECTOR_FULL_STATE_FIXTURE.play!.starred);
    assert.ok(result.watch.length >= 1);

    // as_of passes through the state's assembly time.
    assert.equal(result.as_of, VECTOR_FULL_STATE_FIXTURE.asOf);
  });

  test("range/neutral play bias maps to a neutral desk bias", () => {
    const ranged: VectorFullState = {
      ...VECTOR_FULL_STATE_FIXTURE,
      play: { ...VECTOR_FULL_STATE_FIXTURE.play!, bias: "range" },
    };
    assert.equal(composeVectorDeskBrief(ranged).bias, "neutral");
  });

  test("degrades cleanly when there is no play (no structure)", () => {
    const noPlay: VectorFullState = { ...VECTOR_FULL_STATE_FIXTURE, play: null };
    const result = composeVectorDeskBrief(noPlay);
    assert.equal(result.bias, "neutral");
    assert.ok(result.body.includes("No clean play"));
    // Still surfaces the live reads even without a play.
    assert.ok(result.body.includes("REGIME"));
    assert.ok(result.watch.length >= 1);
  });
});
