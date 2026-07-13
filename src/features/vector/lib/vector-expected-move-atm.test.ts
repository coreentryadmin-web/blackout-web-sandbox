import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveExpectedMoveInputs } from "./vector-expected-move-atm";
import type { ReconstructContract } from "./vector-gex-reconstruct";

const TODAY = "2026-07-13"; // a Monday

function c(over: Partial<ReconstructContract>): ReconstructContract {
  return { strike: 7500, expiry: "2026-07-17", openInterest: 100, iv: 0.15, type: "call", ...over };
}

test("deriveExpectedMoveInputs: ATM IV = avg of call+put IV at the strike nearest spot", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7490, type: "call", iv: 0.2 }),
    c({ strike: 7500, type: "call", iv: 0.16 }),
    c({ strike: 7500, type: "put", iv: 0.18 }), // ATM (spot 7501) — avg(0.16,0.18)=0.17
    c({ strike: 7520, type: "put", iv: 0.25 }),
  ];
  const res = deriveExpectedMoveInputs(chain, 7501, "weekly", TODAY);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17");
  assert.ok(Math.abs(res!.atmIv - 0.17) < 1e-9, "ATM IV is the call/put average at the nearest strike");
  assert.equal(res!.spot, 7501);
  assert.ok(res!.dteDays > 0, "positive time to expiry");
});

test("deriveExpectedMoveInputs: quotes the FRONT expiry of the horizon, not a later one", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.16 }),
    c({ strike: 7500, expiry: "2026-08-21", type: "call", iv: 0.30 }), // later expiry, higher IV
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "all", TODAY);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17", "front expiry wins");
  assert.ok(Math.abs(res!.atmIv - 0.16) < 1e-9, "uses the front expiry's IV");
});

test("deriveExpectedMoveInputs: skips strikes with no usable IV; null when none usable", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, type: "call", iv: 0 }), // ATM but no IV
    c({ strike: 7500, type: "put", iv: 0 }),
    c({ strike: 7550, type: "call", iv: 0.19 }), // only usable IV → becomes the ATM pick
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "weekly", TODAY);
  assert.ok(res, "falls back to the nearest strike that HAS a real IV");
  assert.ok(Math.abs(res!.atmIv - 0.19) < 1e-9);

  const allZero = [c({ strike: 7500, iv: 0 }), c({ strike: 7510, iv: 0 })];
  assert.equal(deriveExpectedMoveInputs(allZero, 7500, "weekly", TODAY), null, "no real IV → null");
});

test("deriveExpectedMoveInputs: guards — no spot / empty chain → null", () => {
  assert.equal(deriveExpectedMoveInputs([], 7500, "weekly", TODAY), null, "empty chain");
  assert.equal(deriveExpectedMoveInputs([c({})], 0, "weekly", TODAY), null, "no spot");
});
