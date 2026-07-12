import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_OVERLAYS,
  isVectorOverlayId,
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
