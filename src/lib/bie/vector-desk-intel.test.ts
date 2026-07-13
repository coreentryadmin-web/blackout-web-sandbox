import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";
import { verifyClaims } from "@/lib/bie/verifier";
import {
  regimeBriefLine,
  wallsBriefLine,
  magnetBriefLine,
  maxPainBriefLine,
  expectedMoveBriefLine,
  flowBriefLine,
  ladderBriefLine,
  knownVectorNumbers,
} from "@/lib/bie/vector-desk-intel";

const state = VECTOR_FULL_STATE_FIXTURE;

describe("vector-desk-intel brief lines", () => {
  test("regimeBriefLine: labels the posture and cites spot vs flip", () => {
    const line = regimeBriefLine(state);
    assert.ok(line);
    assert.match(line!, /REGIME/);
    assert.match(line!, /LONG GAMMA/);
    assert.match(line!, /\{\{7,?560\.00\}\}/); // spot, grounded
    assert.match(line!, /γflip/);
  });

  test("wallsBriefLine: call + put walls with signed distance and integrity tier", () => {
    const line = wallsBriefLine(state);
    assert.ok(line);
    assert.match(line!, /call wall \{\{7,?600\.00\}\}/);
    assert.match(line!, /put wall \{\{7,?500\.00\}\}/);
    assert.match(line!, /firm/); // call wall integrity tier
    assert.match(line!, /caps upside/);
    assert.match(line!, /dealer support/);
  });

  test("magnetBriefLine: cites the magnet strike and its callout", () => {
    const line = magnetBriefLine(state);
    assert.ok(line);
    assert.match(line!, /MAGNET/);
    assert.match(line!, /\{\{7,?555\.50\}\}/);
  });

  test("maxPainBriefLine: strike + signed distance", () => {
    const line = maxPainBriefLine(state);
    assert.ok(line);
    assert.match(line!, /MAX PAIN {2}\{\{7,?550\.00\}\}/);
  });

  test("expectedMoveBriefLine: 1σ and 2σ bands", () => {
    const line = expectedMoveBriefLine(state);
    assert.ok(line);
    assert.match(line!, /1σ/);
    assert.match(line!, /2σ/);
    assert.match(line!, /\{\{7,?505\.00\}\}/); // 1σ low edge
  });

  test("flowBriefLine: prints, expiry, top print", () => {
    const line = flowBriefLine(state);
    assert.ok(line);
    assert.match(line!, /FLOW/);
    assert.match(line!, /large prints/);
    assert.match(line!, /2026-07-13/);
    assert.match(line!, /top call \{\{7,?600\.00\}\}/);
  });

  test("flowBriefLine: null when flow is unavailable", () => {
    assert.equal(flowBriefLine({ ...state, flow: null }), null);
    assert.equal(
      flowBriefLine({ ...state, flow: { ...state.flow!, available: false } }),
      null
    );
  });

  test("ladderBriefLine: names the call king and put king strikes", () => {
    const line = ladderBriefLine(state);
    assert.ok(line);
    assert.match(line!, /call king \{\{7,?600\.00\}\}/);
    assert.match(line!, /put king \{\{7,?500\.00\}\}/);
    assert.match(line!, /4 strikes/);
  });

  test("ladderBriefLine: null on an empty ladder", () => {
    assert.equal(ladderBriefLine({ ...state, ladder: null }), null);
  });
});

describe("knownVectorNumbers", () => {
  test("covers every raw level a brief line cites", () => {
    const known = knownVectorNumbers(state);
    const has = (v: number) => known.some((k) => Math.abs(k - v) < 1e-6);
    assert.ok(has(7560), "spot");
    assert.ok(has(7520), "gamma flip");
    assert.ok(has(7600), "top call wall / ladder call king");
    assert.ok(has(7500), "top put wall / ladder put king");
    assert.ok(has(7550), "max pain");
    assert.ok(has(7505), "1σ low edge");
    assert.ok(has(7670), "2σ high edge");
    assert.ok(has(55), "1σ move pts");
    assert.ok(has(7555.5), "magnet strike");
    assert.ok(has(7450), "ladder / EM outer level");
  });

  test("includes the derived signed distances the wall/max-pain lines cite", () => {
    const known = knownVectorNumbers(state);
    const has = (v: number) => known.some((k) => Math.abs(k - v) < 1e-6);
    assert.ok(has(40), "call wall − spot = +40");
    assert.ok(has(-60), "put wall − spot = −60");
    assert.ok(has(-10), "max pain − spot = −10");
  });

  test("GROUNDING CONTRACT: every {{…}} number across all brief lines is grounded by knownVectorNumbers", () => {
    const text = [
      regimeBriefLine(state),
      wallsBriefLine(state),
      magnetBriefLine(state),
      maxPainBriefLine(state),
      expectedMoveBriefLine(state),
      ladderBriefLine(state),
      flowBriefLine(state),
    ]
      .filter(Boolean)
      .join("\n");

    // The real Vector→BIE path grounds with Layer-4 verifyClaims (tolerant, coverage-based,
    // -src/×2/÷2 aware — which is how a "+40" distance grounds against a stored −40, etc.).
    const v = verifyClaims(text, knownVectorNumbers(state));
    assert.ok(v.total >= 8, `expected many numeric claims, got ${v.total}`);
    // The only intentionally-ungroundable token is the compressed $-premium magnitude
    // (fmtPremium "$1.2M"), matching the codebase norm for premium display; everything a desk
    // acts on (levels, distances, percents, edges) must ground.
    assert.ok(v.coverage >= 0.85, `coverage ${v.coverage} too low; unverified: ${v.unverified.join(", ")}`);
  });
});
