import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlertRule } from "./vector-alerts-store";
import type { AlertRule } from "./vector-alerts";

test("buildAlertRule: collision-free monotonic id per ticker+kind; carries tolerance only for wall-touch", () => {
  const r1 = buildAlertRule([], "spx", "wall-touch", 0.001);
  assert.equal(r1.id, "SPX:wall-touch:1");
  assert.equal(r1.ticker, "SPX", "ticker upper-cased");
  assert.equal(r1.enabled, true);
  assert.equal(r1.tolerancePct, 0.001);

  // Next same-kind rule seeds off the max existing suffix → :2 (never reuses :1).
  const r2 = buildAlertRule([r1], "SPX", "wall-touch", 0.002);
  assert.equal(r2.id, "SPX:wall-touch:2");

  // A different kind has its own sequence.
  const flip = buildAlertRule([r1, r2], "SPX", "flip-cross");
  assert.equal(flip.id, "SPX:flip-cross:1");
  assert.equal("tolerancePct" in flip, false, "flip-cross carries no tolerance");

  // Removing r1 then adding must NOT reuse :2 (max suffix among remaining is 2 → next is 3).
  const afterRemove: AlertRule[] = [r2];
  const r3 = buildAlertRule(afterRemove, "SPX", "wall-touch", 0.001);
  assert.equal(r3.id, "SPX:wall-touch:3", "seed is 1+max-suffix, so a live id is never reused");
});
