import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyOutcome, type PlayCloseSnapshot } from "./spx-play-outcomes";

const close = (
  exit_action: PlayCloseSnapshot["exit_action"],
  pnl_pts: number,
  was_loss = false
): PlayCloseSnapshot => ({
  exit_price: 0,
  exit_action,
  mfe_pts: 0,
  mae_pts: 0,
  trim_done: false,
  was_loss,
  pnl_pts,
});

describe("classifyOutcome", () => {
  it("grades a profitable THESIS exit as a win (regression: was hard-coded to loss)", () => {
    // was_loss is true because the engine sets it for every thesis break; must NOT override P&L.
    assert.equal(classifyOutcome(close("THESIS", 2.84, true)), "win");
    assert.equal(classifyOutcome(close("THESIS", 7.3, true)), "win");
  });

  it("grades a losing THESIS exit as a loss (any negative P&L)", () => {
    assert.equal(classifyOutcome(close("THESIS", -0.38, true)), "loss");
    assert.equal(classifyOutcome(close("THESIS", -2.6, true)), "loss");
  });

  it("grades a scratch THESIS exit as breakeven", () => {
    assert.equal(classifyOutcome(close("THESIS", 0, false)), "breakeven");
  });

  it("STOP/SESSION grade by P&L; small scratch is breakeven", () => {
    assert.equal(classifyOutcome(close("STOP", -7.15, true)), "loss");
    assert.equal(classifyOutcome(close("SESSION", -0.5)), "breakeven");
    assert.equal(classifyOutcome(close("THETA", 1.2)), "win");
    assert.equal(classifyOutcome(close("SESSION", 0)), "breakeven");
  });

  it("TARGET is a win; TRAIL scratch-or-better is a win, below-entry is a loss", () => {
    assert.equal(classifyOutcome(close("TARGET", 14)), "win");
    assert.equal(classifyOutcome(close("TRAIL", 0)), "breakeven");
    assert.equal(classifyOutcome(close("STOP", 0, false)), "breakeven");
    assert.equal(classifyOutcome(close("TRAIL", -2)), "loss");
  });

  it("UNKNOWN exit still uses was_loss as a loss signal (fallthrough safety net)", () => {
    assert.equal(classifyOutcome(close("UNKNOWN", -0.4, true)), "loss");
    assert.equal(classifyOutcome(close("UNKNOWN", 3, false)), "win");
  });

  it("the 9 captured 2026-06 plays yield 2W/7L, not 0W/9L", () => {
    const plays: Array<[PlayCloseSnapshot["exit_action"], number]> = [
      ["THESIS", -0.38],
      ["THESIS", -2.6],
      ["THESIS", 2.84],
      ["THESIS", -2.23],
      ["THESIS", -1.48],
      ["STOP", -13.62],
      ["THESIS", 7.3],
      ["THESIS", -2.47],
      ["STOP", -7.15],
    ];
    const outcomes = plays.map(([a, p]) => classifyOutcome(close(a, p, p < 0)));
    assert.equal(outcomes.filter((o) => o === "win").length, 2);
    assert.equal(outcomes.filter((o) => o === "loss").length, 7);
    assert.equal(outcomes.filter((o) => o === "breakeven").length, 0);
  });
});
