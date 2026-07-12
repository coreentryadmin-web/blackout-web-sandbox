import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_OVERLAYS,
  VECTOR_OVERLAY_FAMILIES,
  VECTOR_LEVELS,
  VECTOR_INDICATOR_GROUPS,
  isVectorOverlayId,
  isVectorOverlayFamilyId,
  isVectorLevelId,
} from "./vector-indicators-config";

test("VECTOR_OVERLAYS: unique ids, ema/sma carry a positive period, vwap does not need one", () => {
  const ids = VECTOR_OVERLAYS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const o of VECTOR_OVERLAYS) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(o.color), `${o.id} has a hex colour`);
    if (o.kind === "ema" || o.kind === "sma") {
      assert.ok(typeof o.period === "number" && o.period > 0, `${o.id} has a positive period`);
    }
  }
});

test("isVectorOverlayId: accepts registry ids, rejects anything else", () => {
  assert.ok(isVectorOverlayId("vwap"));
  assert.ok(isVectorOverlayId("ema21"));
  assert.ok(!isVectorOverlayId("rsi"));
  assert.ok(!isVectorOverlayId(""));
  assert.ok(!isVectorOverlayId(null));
});

test("VECTOR_OVERLAY_FAMILIES: partition the overlays, one type per toggle, hex dot colours", () => {
  const famIds = VECTOR_OVERLAY_FAMILIES.map((f) => f.id);
  assert.equal(new Set(famIds).size, famIds.length, "family ids unique");

  // Every family's members are valid overlay ids that actually declare that family.
  const seen: string[] = [];
  for (const fam of VECTOR_OVERLAY_FAMILIES) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(fam.color), `${fam.id} has a hex dot colour`);
    assert.ok(fam.memberIds.length > 0, `${fam.id} has at least one member line`);
    for (const id of fam.memberIds) {
      assert.ok(isVectorOverlayId(id), `${id} is a real overlay id`);
      const def = VECTOR_OVERLAYS.find((o) => o.id === id)!;
      assert.equal(def.family, fam.id, `${id} declares family ${fam.id}`);
      seen.push(id);
    }
  }
  // The families cover EVERY overlay exactly once (no line orphaned, none double-toggled).
  assert.deepEqual(seen.sort(), VECTOR_OVERLAYS.map((o) => o.id).sort());
});

test("isVectorOverlayFamilyId: accepts family ids, rejects individual line ids + junk", () => {
  assert.ok(isVectorOverlayFamilyId("ema"));
  assert.ok(isVectorOverlayFamilyId("vwap"));
  assert.ok(!isVectorOverlayFamilyId("ema9"), "an individual line id is not a family id");
  assert.ok(!isVectorOverlayFamilyId("rsi"));
  assert.ok(!isVectorOverlayFamilyId(null));
});

test("VECTOR_LEVELS + isVectorLevelId: hex colours, unique ids, disjoint from families", () => {
  const ids = VECTOR_LEVELS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "level ids unique");
  for (const l of VECTOR_LEVELS) assert.ok(/^#[0-9a-f]{6}$/i.test(l.color), `${l.id} hex colour`);
  assert.ok(isVectorLevelId("fib") && isVectorLevelId("hod-lod"));
  assert.ok(!isVectorLevelId("vwap"), "overlay family id is not a level id");
  assert.ok(!isVectorLevelId(null));
  // family/level id spaces don't collide (the enabled Set holds both).
  for (const id of ids) assert.ok(!isVectorOverlayFamilyId(id), `${id} not also a family id`);
});

test("VECTOR_INDICATOR_GROUPS: covers every family + level id exactly once (the toggle space)", () => {
  const grouped = VECTOR_INDICATOR_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  const expected = [
    ...VECTOR_OVERLAY_FAMILIES.map((f) => f.id),
    ...VECTOR_LEVELS.map((l) => l.id),
  ];
  assert.deepEqual([...grouped].sort(), [...expected].sort());
});
