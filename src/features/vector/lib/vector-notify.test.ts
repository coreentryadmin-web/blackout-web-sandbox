import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationForFire, shouldSystemNotify } from "./vector-notify";
import type { FiredAlert } from "./vector-alerts";

function fire(over: Partial<FiredAlert> = {}): FiredAlert {
  return {
    ruleId: "SPX:wall-touch:1",
    ticker: "SPX",
    kind: "wall-touch",
    level: 7600.4,
    direction: "up",
    spot: 7598.9,
    at: 1_000,
    message: "SPX testing call wall 7,600 (spot 7,598.90)",
    ...over,
  };
}

test("notificationForFire: title carries ticker+verb, body reuses engine message, tag is level-scoped", () => {
  const p = notificationForFire(fire());
  assert.equal(p.title, "SPX — wall touch");
  assert.equal(p.body, "SPX testing call wall 7,600 (spot 7,598.90)");
  // Level rounded into the tag so jitter around one strike collapses to a single banner.
  assert.equal(p.tag, "vector:SPX:wall-touch:7600");
  assert.equal(p.url, "/vector?ticker=SPX");

  const flip = notificationForFire(fire({ kind: "flip-cross", level: 7496, message: "crossed flip" }));
  assert.equal(flip.title, "SPX — gamma flip cross");
  assert.equal(flip.tag, "vector:SPX:flip-cross:7496");
});

test("notificationForFire: same wall at jittering spot → identical tag (dedup); different wall → new tag", () => {
  const a = notificationForFire(fire({ level: 7600.1 }));
  const b = notificationForFire(fire({ level: 7599.8 })); // rounds to 7600 → same banner
  const c = notificationForFire(fire({ level: 7625.0 })); // different wall → its own banner
  assert.equal(a.tag, b.tag, "micro-jitter around one strike must not mint a new banner");
  assert.notEqual(a.tag, c.tag, "a genuinely different wall gets its own banner");
});

test("notificationForFire: non-finite level degrades to a stable 'na' tag (never NaN in the key)", () => {
  const p = notificationForFire(fire({ level: Number.NaN }));
  assert.equal(p.tag, "vector:SPX:wall-touch:na");
});

test("shouldSystemNotify: only when enabled AND granted AND the tab is hidden", () => {
  // The happy path — member tabbed away, opted in, permission granted.
  assert.equal(shouldSystemNotify({ enabled: true, permission: "granted", hidden: true }), true);

  // Visible tab: in-page toast + terminal already cover it → no duplicate OS banner.
  assert.equal(shouldSystemNotify({ enabled: true, permission: "granted", hidden: false }), false);

  // Not opted in / not granted → never.
  assert.equal(shouldSystemNotify({ enabled: false, permission: "granted", hidden: true }), false);
  assert.equal(shouldSystemNotify({ enabled: true, permission: "denied", hidden: true }), false);
  assert.equal(shouldSystemNotify({ enabled: true, permission: "default", hidden: true }), false);
});
