import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inferAnswerShape } from "@/lib/bie/response-shape";
import type { BieRoute } from "@/lib/bie/router";

const route = (intent: BieRoute["intent"], ticker?: string): BieRoute => ({
  intent,
  ticker: ticker ?? null,
  ticker_b: null,
  horizon: null,
});

describe("inferAnswerShape", () => {
  test("brevity → sentence", () => {
    assert.equal(inferAnswerShape(route("spx_desk_read"), "SPX direction in one sentence"), "sentence");
  });

  test("helix top-N → table", () => {
    assert.equal(
      inferAnswerShape(route("helix_read"), "top 3 helix prints by premium"),
      "table"
    );
  });

  test("narrow structure → levels", () => {
    assert.equal(inferAnswerShape(route("spx_structure"), "where is the put wall"), "levels");
    assert.equal(inferAnswerShape(route("spx_structure"), "king node on SPX"), "levels");
  });

  test("play engine → table", () => {
    assert.equal(inferAnswerShape(route("play_engine_read"), "play engine state"), "table");
  });

  test("clarify → bullets", () => {
    assert.equal(inferAnswerShape(route("clarify_read"), "asdfghjkl"), "bullets");
  });

  test("full desk ask → sections", () => {
    assert.equal(inferAnswerShape(route("spx_desk_read"), "full SPX setup read"), "sections");
  });
});
