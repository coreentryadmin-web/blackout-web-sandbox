import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expiriesForHorizon,
  normalizeDteHorizon,
  isVectorDteHorizon,
  dteHorizonLabel,
  VECTOR_DTE_HORIZONS,
} from "./vector-dte-horizon";

// Monday 2026-07-13 is an expiry; today is a trading day.
const EXPS = ["2026-07-13", "2026-07-14", "2026-07-17", "2026-07-20", "2026-08-15", "2026-09-18"];

test("expiriesForHorizon: 0dte on a trading day returns only today's expiry", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "0dte", "2026-07-13"), ["2026-07-13"]);
});

test("expiriesForHorizon: weekly is DTE<=7, monthly DTE<=35", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "weekly", "2026-07-13"), [
    "2026-07-13",
    "2026-07-14",
    "2026-07-17",
    "2026-07-20",
  ]);
  assert.deepEqual(expiriesForHorizon(EXPS, "monthly", "2026-07-13"), [
    "2026-07-13",
    "2026-07-14",
    "2026-07-17",
    "2026-07-20",
    "2026-08-15",
  ]);
});

test("expiriesForHorizon: all returns every non-expired expiry, sorted by DTE", () => {
  assert.deepEqual(expiriesForHorizon(EXPS, "all", "2026-07-13"), EXPS);
});

test("expiriesForHorizon: past expiries are always dropped", () => {
  // today after the first two expiries → they must not appear in any horizon.
  assert.deepEqual(expiriesForHorizon(EXPS, "all", "2026-07-18"), [
    "2026-07-20",
    "2026-08-15",
    "2026-09-18",
  ]);
});

test("expiriesForHorizon: HONEST FALLBACK — bounded horizon with no match returns the nearest expiry, never empty", () => {
  // Saturday 2026-07-11: no expiry today → 0dte must fall back to the nearest (Mon 13),
  // not blank the walls.
  assert.deepEqual(expiriesForHorizon(EXPS, "0dte", "2026-07-11"), ["2026-07-13"]);
});

test("expiriesForHorizon: no live expiries → empty (genuinely nothing to show)", () => {
  assert.deepEqual(expiriesForHorizon(["2026-07-01"], "all", "2026-07-13"), []);
});

test("expiriesForHorizon: malformed expiry strings are ignored, valid ones survive", () => {
  assert.deepEqual(expiriesForHorizon(["garbage", "2026-07-20", ""], "all", "2026-07-13"), ["2026-07-20"]);
});

test("normalizeDteHorizon / isVectorDteHorizon: junk falls back to 'all'", () => {
  assert.equal(normalizeDteHorizon("weekly"), "weekly");
  assert.equal(normalizeDteHorizon("0dte"), "0dte");
  assert.equal(normalizeDteHorizon("nonsense"), "all");
  assert.equal(normalizeDteHorizon(undefined), "all");
  assert.equal(isVectorDteHorizon("monthly"), true);
  assert.equal(isVectorDteHorizon("yearly"), false);
});

test("every horizon has a label", () => {
  for (const h of VECTOR_DTE_HORIZONS) assert.ok(dteHorizonLabel(h).length > 0);
});
