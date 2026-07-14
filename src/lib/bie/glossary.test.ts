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

  // PR-L1 — live-battery substance gaps. "What does positive/negative gamma mean" resolves to the
  // Gamma regime entry, whose text previously spoke only the long/short-gamma register: a member
  // asking in the positive/negative vocabulary got an answer that never used their words nor the
  // suppress/stabilize (resp. amplify/accelerate) mechanics. The definition now answers in BOTH
  // registers — pin the exact vocabulary so it can't regress to jargon-only.
  test("positive/negative gamma questions get the suppress/amplify mechanics in the member's own vocabulary", () => {
    const pos = lookupGlossary("what does positive gamma mean for the market?")!;
    assert.match(pos.term, /Gamma regime/i);
    assert.match(pos.definition, /positive gamma/i);
    assert.match(pos.definition, /suppress/i);
    assert.match(pos.definition, /stabiliz/i);
    assert.match(pos.definition, /pins|pin\b/i);

    const neg = lookupGlossary("what does negative gamma mean?")!;
    assert.match(neg.term, /Gamma regime/i);
    assert.match(neg.definition, /negative gamma/i);
    assert.match(neg.definition, /amplif/i);
    assert.match(neg.definition, /accelerate/i);
    assert.match(neg.definition, /volatility feeds on itself/i);
  });

  // PR-L1 — reported live: "what is Thermal" answered with the DARK-POOL definition. The matcher
  // itself was never the culprit (the collision was the question-less answer-cache key, see
  // platform-cache.test.ts) — but pin the matcher level too so an alias regression can't recreate
  // the same member-visible symptom from a second direction.
  test("REGRESSION (PR-L1): 'what is Thermal' resolves to Thermal, never the dark-pool entry", () => {
    const hit = lookupGlossary("what is Thermal")!;
    assert.equal(hit.term, "Thermal");
    assert.doesNotMatch(hit.definition, /dark[- ]pool/i);
    // And the dark-pool question keeps its own entry — no swap in either direction.
    assert.match(lookupGlossary("what is a dark pool level?")!.term, /Dark pool/i);
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

describe("Cortex / 0DTE decision-layer concepts (PR-H)", () => {
  test("every new decision-layer concept resolves via a natural question", () => {
    const probes: Array<[string, RegExp]> = [
      ["what is the cortex?", /Cortex/],
      ["what is a cortex veto", /veto/i],
      ["what is veto asymmetry", /asymmetry/i],
      ["what is evidence decay", /decay/i],
      ["explain the evidence half-life", /decay|half-life/i],
      ["what is the opening harvest", /Opening harvest/i],
      ["what is a thesis-break exit", /Thesis-break/i],
      ["what is the profit ratchet", /Profit ratchet/i],
      ["what is gate calibration", /Gate calibration/i],
      ["what is counterfactual skip grading", /skip grading/i],
      ["what are merit tiers", /Merit tiers/i],
      ["what are conviction bands", /Merit tiers/i],
    ];
    for (const [q, termRe] of probes) {
      const hit = lookupGlossary(q);
      assert.ok(hit, `expected a glossary hit for: ${q}`);
      assert.match(hit!.term, termRe, `wrong term for: ${q} (got ${hit!.term})`);
    }
  });

  test("each new entry is member-plain and carries a concrete example", () => {
    const terms = [
      "Cortex (Night Hawk Cortex)",
      "Evidence veto (Cortex veto)",
      "Veto asymmetry",
      "Evidence decay (half-life)",
      "Opening harvest",
      "Thesis-break exit",
      "Profit ratchet",
      "Gate calibration",
      "Counterfactual skip grading",
      "Merit tiers (conviction bands)",
    ];
    for (const term of terms) {
      const entry = BLACKOUT_GLOSSARY.find((e) => e.term === term);
      assert.ok(entry, `missing glossary entry: ${term}`);
      assert.ok(entry!.definition.length > 120, `${term}: definition too thin`);
      assert.match(entry!.definition, /Example:/, `${term}: needs a concrete example`);
    }
  });

  test("key semantics are pinned: asymmetry direction, 3-half-life absence, green-never-finishes-red, conservative counterfactuals", () => {
    assert.match(
      lookupGlossary("veto asymmetry")!.definition,
      /one loud bearish fact can kill an entry, while one loud bullish signal can never buy one/i
    );
    assert.match(lookupGlossary("evidence decay")!.definition, /three half-lives/i);
    assert.match(lookupGlossary("profit ratchet")!.definition, /green never finishes red/i);
    assert.match(lookupGlossary("counterfactual skip grading")!.definition, /conservatively AGAINST/i);
    assert.match(lookupGlossary("what is a thesis-break exit")!.definition, /even at a loss/i);
  });

  test("longest-alias precedence: 'cortex veto' resolves to the veto entry, not the Cortex product entry", () => {
    assert.match(lookupGlossary("what is a cortex veto")!.term, /Evidence veto/i);
    assert.match(lookupGlossary("what is the cortex")!.term, /^Cortex/);
  });
});

describe("Night Hawk overnight-edition concepts (PR-N9)", () => {
  test("every new overnight concept resolves via a natural question", () => {
    const probes: Array<[string, RegExp]> = [
      ["what is publish context?", /Publish context/i],
      ["what is the publish pin", /Publish context/i],
      ["what is evidence pinning", /Publish context/i],
      ["what is the morning confirmation?", /Morning confirmation/i],
      ["what is the morning check", /Morning confirmation/i],
      ["what is a morning verdict", /Morning confirmation/i],
      ["what is a pulled play", /Pulled play/i],
      ["what is the pull latch", /Pulled play/i],
      ["what is an unfilled grade", /Unfilled/i],
      ["what is fillability", /Unfilled/i],
      ["what are the publish gates", /Publish gates/i],
      ["what is the band sanity gate", /Publish gates/i],
      ["what is the Night Audit", /Night Audit/i],
    ];
    for (const [q, termRe] of probes) {
      const hit = lookupGlossary(q);
      assert.ok(hit, `expected a glossary hit for: ${q}`);
      assert.match(hit!.term, termRe, `wrong term for: ${q} (got ${hit!.term})`);
    }
  });

  test("key semantics are pinned: first-write-wins, binding INVALIDATED, both-directions exclusion, fillability rule", () => {
    assert.match(lookupGlossary("publish context")!.definition, /FIRST-WRITE-WINS/i);
    assert.match(lookupGlossary("publish context")!.definition, /never reconstructed/i);
    assert.match(lookupGlossary("morning confirmation")!.definition, /INVALIDATED is BINDING/i);
    assert.match(lookupGlossary("morning confirmation")!.definition, /DEGRADED stays advisory/i);
    assert.match(lookupGlossary("pulled play")!.definition, /BOTH directions/i);
    assert.match(lookupGlossary("pulled play")!.definition, /never hidden or deleted/i);
    assert.match(lookupGlossary("unfilled grade")!.definition, /session LOW reached the top of the band/i);
  });

  test("HONESTY: in-progress work is described as in progress, never as shipped", () => {
    // The publish gates ship in a sibling PR — the entry must say the gates are not live yet.
    assert.match(lookupGlossary("publish gates")!.definition, /ship in a sibling PR|not yet block/i);
    // The Night Audit is planned work — the entry must say so plainly.
    assert.match(lookupGlossary("night audit")!.definition, /IN PROGRESS, not shipped/i);
  });

  test("longest-alias precedence: the edition concepts don't steal the Night Hawk product entry (and vice versa)", () => {
    assert.match(lookupGlossary("what does Night Hawk do")!.term, /^Night Hawk$/);
    assert.match(lookupGlossary("what is the Night Audit")!.term, /Night Audit/i);
  });
});
