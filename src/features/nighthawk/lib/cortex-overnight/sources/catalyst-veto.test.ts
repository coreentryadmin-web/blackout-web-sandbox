import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveCatalystVetoEvidence, earningsInHorizon, CATALYST_VETO_WEIGHT } from "./catalyst-veto";
import type { OvernightInputs, OvernightCatalystSlice } from "../types";

function baseInput(catalyst: OvernightCatalystSlice | null, over: Partial<OvernightInputs> = {}): OvernightInputs {
  return {
    ticker: "NVDA",
    direction: "long",
    now: "2026-07-14T21:00:00Z", // evening publish, Tue
    horizonDate: "2026-07-15", // next session
    catalyst,
    wall: null,
    darkPool: null,
    iv: null,
    sector: null,
    flow: null,
    errors: {},
    ...over,
  };
}

function catalyst(over: Partial<OvernightCatalystSlice> = {}): OvernightCatalystSlice {
  return {
    asOf: "2026-07-14T21:00:00Z",
    earningsDate: null,
    earningsReportTime: null,
    binaryEvents: [],
    isCatalystPlay: false,
    ...over,
  };
}

test("catalyst-veto: HARD VETO when earnings report tomorrow (premarket) is inside the hold", () => {
  const items = deriveCatalystVetoEvidence(
    baseInput(catalyst({ earningsDate: "2026-07-15", earningsReportTime: "premarket" }))
  );
  const veto = items.find((i) => i.stance === "veto");
  assert.ok(veto, "expected a veto item");
  assert.equal(veto!.weight, CATALYST_VETO_WEIGHT);
  assert.match(veto!.detail, /earnings before the open \(premarket\) on 2026-07-15/);
  assert.match(veto!.detail, /VETO/);
});

test("catalyst-veto: afterhours earnings ON the horizon date still vetoes (resolves before grading)", () => {
  const items = deriveCatalystVetoEvidence(
    baseInput(catalyst({ earningsDate: "2026-07-15", earningsReportTime: "afterhours" }))
  );
  assert.ok(items.some((i) => i.stance === "veto"), "afterhours-on-horizon should veto");
});

test("catalyst-veto: NO veto on an explicitly-flagged catalyst play — emits an oppose instead", () => {
  const items = deriveCatalystVetoEvidence(
    baseInput(catalyst({ earningsDate: "2026-07-15", earningsReportTime: "premarket", isCatalystPlay: true }))
  );
  assert.ok(!items.some((i) => i.stance === "veto"), "catalyst play must be exempt from the veto");
  const oppose = items.find((i) => i.stance === "opposes");
  assert.ok(oppose, "catalyst play still records residual binary risk as an oppose");
  assert.match(oppose!.detail, /catalyst play/);
});

test("catalyst-veto: earnings AFTER the horizon does not veto (out of the hold)", () => {
  const items = deriveCatalystVetoEvidence(
    baseInput(catalyst({ earningsDate: "2026-07-20", earningsReportTime: "afterhours" }))
  );
  assert.ok(!items.some((i) => i.stance === "veto"));
  // No in-horizon event ⇒ the "clear overnight" support.
  assert.ok(items.some((i) => i.stance === "supports"));
});

test("catalyst-veto: dated FDA/binary event inside the hold vetoes", () => {
  const items = deriveCatalystVetoEvidence(
    baseInput(catalyst({ binaryEvents: [{ kind: "fda", date: "2026-07-15", label: "PDUFA XYZ-1" }] }))
  );
  const veto = items.find((i) => i.stance === "veto");
  assert.ok(veto);
  assert.match(veto!.detail, /fda binary event/);
});

test("catalyst-veto: clean name (no event in hold) emits the modest clear-overnight support", () => {
  const items = deriveCatalystVetoEvidence(baseInput(catalyst()));
  assert.equal(items.length, 1);
  assert.equal(items[0].stance, "supports");
  assert.match(items[0].detail, /clear of gap landmines/);
});

test("catalyst-veto: fail-soft — missing slice is absent (with the recorded error class when present)", () => {
  const a = deriveCatalystVetoEvidence(baseInput(null));
  assert.equal(a[0].stance, "absent");
  const b = deriveCatalystVetoEvidence(baseInput(null, { errors: { "catalyst-veto": "UW 503" } }));
  assert.match(b[0].detail, /reader failed \(UW 503\)/);
});

test("earningsInHorizon: boundary — on/before horizon is in-horizon, after is not", () => {
  assert.equal(earningsInHorizon(100, "premarket", 100), true);
  assert.equal(earningsInHorizon(99, "afterhours", 100), true);
  assert.equal(earningsInHorizon(101, "premarket", 100), false);
});
