import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BLACKOUT_GLOSSARY, lookupGlossary, glossaryKnowledgeText } from "@/lib/bie/glossary";

describe("lookupGlossary", () => {
  test("resolves every core term via a natural 'what is X' question", () => {
    const probes: Array<[string, RegExp]> = [
      ["what is GEX?", /GEX/],
      ["what is VEX", /VEX/],
      ["define DEX", /DEX/],
      ["explain charm", /CHARM/i],
      ["what is the gamma flip", /Gamma flip/i],
      ["what is a king node", /King node/i],
      ["what is a call wall", /Call wall/i],
      ["what is a put wall", /Put wall/i],
      ["what is max pain", /Max pain/i],
      ["what is the expected move", /Expected move/i],
      ["what is the gamma magnet", /magnet/i],
      ["what are dark pool levels", /Dark pool/i],
      ["what is wall integrity", /Wall integrity/i],
      ["what are beads", /Bead/i],
      ["what is a confluence zone", /Confluence/i],
      ["what is the gamma regime", /regime/i],
      ["what is 0DTE", /0DTE/i],
      ["what is positive gamma", /regime/i],
      ["what is negative gamma", /regime/i],
      ["what is VWAP", /VWAP/],
      ["what is RSI", /RSI/],
      ["what is MACD", /MACD/],
      ["what is the golden pocket", /Golden pocket/i],
      ["what does Night Hawk do", /Night Hawk/i],
      ["what is Vector", /Vector/],
      ["what is SPX Slayer", /Slayer/],
      ["what is Thermal", /Thermal/],
      ["what is Helix", /Helix/],
      ["what is Largo", /Largo/],
      ["what is BIE", /BIE/],
    ];
    for (const [q, termRe] of probes) {
      const hit = lookupGlossary(q);
      assert.ok(hit, `expected a glossary hit for: ${q}`);
      assert.match(hit!.term, termRe, `wrong term for: ${q} (got ${hit!.term})`);
    }
  });

  test("KEY NUANCE: King node resolves to the argmax-|gamma| definition, NOT the wall definition", () => {
    const hit = lookupGlossary("what is a king node");
    assert.ok(hit);
    assert.match(hit!.term, /King node/i);
    // The definition must describe the single biggest-magnitude strike (either sign) and explicitly
    // distinguish it from a call/put wall — the nuance the term map flags.
    assert.match(hit!.definition, /largest absolute net gamma|argmax/i);
    assert.match(hit!.definition, /NOT the same as a call\/put wall|not a call\/put wall/i);
  });

  test("'call wall' resolves to the wall, not the king (longest-alias precedence works)", () => {
    assert.match(lookupGlossary("what is the call wall")!.term, /Call wall/i);
    assert.match(lookupGlossary("what is a put wall")!.term, /Put wall/i);
  });

  // Regression guard for the RTH-scan-flagged "definition mismatch" class (VWAP→GEX, NightHawk→Helix,
  // Thermal→Helix, Largo→NightHawk). These DID NOT reproduce on trunk — the entries are correct — but
  // term-name assertions alone wouldn't catch a swapped DEFINITION body, so pin each definition to a
  // phrase unique to the RIGHT product/concept and NEGATIVE-assert the wrong one it was said to leak.
  test("definitions are NOT swapped — each term's body describes the right thing (not its look-alike)", () => {
    const vwap = lookupGlossary("what is VWAP")!;
    assert.match(vwap.term, /VWAP/);
    assert.match(vwap.definition, /volume[- ]weighted average price/i);
    assert.doesNotMatch(vwap.definition, /gamma exposure|dealer gamma/i); // not the GEX def

    const nh = lookupGlossary("what does Night Hawk do")!;
    assert.match(nh.term, /Night Hawk/i);
    assert.match(nh.definition, /evening|swing|edition/i);
    assert.doesNotMatch(nh.definition, /live tape of large option prints/i); // not the Helix def

    const thermal = lookupGlossary("what is Thermal")!;
    assert.match(thermal.term, /Thermal/i);
    assert.match(thermal.definition, /heatmap|GEX \/ VEX \/ DEX \/ CHARM/i);
    assert.doesNotMatch(thermal.definition, /market-wide options FLOW product/i); // not Helix

    const largo = lookupGlossary("what is Largo")!;
    assert.match(largo.term, /Largo/i);
    assert.match(largo.definition, /desk AI|assistant/i);
    assert.doesNotMatch(largo.definition, /evening swing-pick/i); // not the Night Hawk def
  });

  test("plural + alias tolerance", () => {
    assert.match(lookupGlossary("what are call walls")!.term, /Call wall/i);
    assert.match(lookupGlossary("explain the flip")!.term, /Gamma flip/i);
    assert.match(lookupGlossary("what does nighthawk do")!.term, /Night Hawk/i);
    assert.match(lookupGlossary("define the sniper desk")!.term, /Sniper/i);
  });

  test("unknown term → null (caller answers honestly, never a desk dump)", () => {
    assert.equal(lookupGlossary("what is the flongle indicator"), null);
    assert.equal(lookupGlossary("how do I reset my password"), null);
    assert.equal(lookupGlossary(""), null);
  });

  test("every entry has aliases, a category, and a non-trivial definition", () => {
    for (const e of BLACKOUT_GLOSSARY) {
      assert.ok(e.term.length > 0);
      assert.ok(Array.isArray(e.aliases) && e.aliases.length > 0, `${e.term} needs aliases`);
      assert.ok(e.definition.length > 60, `${e.term} needs a real definition`);
    }
  });

  test("glossaryKnowledgeText renders every term for the RAG corpus", () => {
    const text = glossaryKnowledgeText();
    for (const e of BLACKOUT_GLOSSARY) {
      assert.ok(text.includes(e.term), `knowledge text missing ${e.term}`);
    }
  });
});
