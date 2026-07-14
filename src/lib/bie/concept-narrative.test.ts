import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lookupGlossary } from "@/lib/bie/glossary";
import { buildConceptEnvelope, conceptHasRichExplanation } from "@/lib/bie/concept-narrative";
import { CONCEPT_RICH } from "@/lib/bie/concept-rich";

// The battery the coordinator named (concepts a member most commonly asks about).
const BATTERY = [
  "what is GEX",
  "what is VEX",
  "what is the gamma flip",
  "what is a king node",
  "what is a call wall",
  "what is a put wall",
  "what is max pain",
  "what is expected move",
  "what is the gamma regime",
  "what is 0DTE",
  "what is Helix",
  "what is Thermal",
  "what is Night Hawk",
  "what is Largo",
  "what is Vector",
  "what is an anchor",
];

describe("concept enrichment: every core concept becomes a rich multi-section explanation", () => {
  test("each battery concept resolves AND produces a rich (≥3 section) envelope, far longer than the old one-liner", () => {
    for (const q of BATTERY) {
      const entry = lookupGlossary(q);
      assert.ok(entry, `no glossary hit for: ${q}`);
      const env = buildConceptEnvelope(entry!);
      // Rich = several substantive sections, not one dictionary line.
      assert.ok(env.sections.length >= 3, `${q}: expected ≥3 sections, got ${env.sections.length}`);
      // Every section has real prose.
      for (const s of env.sections) assert.ok(s.body.trim().length > 20, `${q}/${s.title}: too thin`);
      // The rendered answer is materially longer than the bare definition (the old answer).
      const oldAnswer = `**${entry!.term}**\n\n${entry!.definition}`;
      assert.ok(
        env.markdown.length > oldAnswer.length * 1.8,
        `${q}: enriched answer (${env.markdown.length}) not materially richer than old (${oldAnswer.length})`
      );
      // Honesty: it's a full envelope with a confidence + the structured sections the UI binds to.
      assert.equal(env.intent, "concept_read");
      assert.equal(env.confidence.level, "high");
    }
  });

  test("the core desk concepts carry the FULL rich explanation (all four rich fields present)", () => {
    for (const term of [
      "GEX (Gamma Exposure)",
      "Gamma flip",
      "King node (GEX king)",
      "Call wall",
      "Put wall",
      "Max pain",
      "0DTE",
    ]) {
      assert.ok(conceptHasRichExplanation(term), `${term} should have rich content`);
      const r = CONCEPT_RICH[term]!;
      assert.ok(r.howItWorks && r.whyItMatters && r.example && r.onPlatform, `${term} missing a rich field`);
    }
  });

  test("a concept with NO rich content still answers honestly from its definition (single clean section, no empty headers)", () => {
    // RSI has a definition but no CONCEPT_RICH entry → one 'What it is' section, never padded.
    const entry = lookupGlossary("what is RSI");
    assert.ok(entry);
    const env = buildConceptEnvelope(entry!);
    assert.equal(env.sections.length, 1);
    assert.equal(env.sections[0]!.title, "What it is");
    // No blank sections leaked into the markdown.
    assert.doesNotMatch(env.markdown, /##\s*(How it works|Why it matters|Example|On the platform)\s*\n\s*\n/);
  });

  test("the rich sections read like an explanation: How it works + Why it matters + Example + On the platform all render for GEX", () => {
    const env = buildConceptEnvelope(lookupGlossary("what is GEX")!);
    const titles = env.sections.map((s) => s.title);
    for (const t of ["What it is", "How it works", "Why it matters", "Example", "On the platform"]) {
      assert.ok(titles.includes(t), `GEX missing section: ${t}`);
    }
    // Grounded, no fabricated certainty — examples are labelled illustrative.
    assert.match(env.markdown, /[Ii]llustrative/);
  });

  test("BEFORE→AFTER sample capture (printed for the live audit record)", () => {
    const samples = ["what is GEX", "what is the gamma flip", "what is max pain", "what is Helix"];
    for (const q of samples) {
      const entry = lookupGlossary(q)!;
      const before = `**${entry.term}**\n\n${entry.definition}`;
      const after = buildConceptEnvelope(entry).markdown;
      console.log(`\n### ${q}\nBEFORE (${before.length} chars, 1 block):\n${before}\n\nAFTER (${after.length} chars, ${buildConceptEnvelope(entry).sections.length} sections):\n${after}\n`);
      assert.ok(after.length > before.length);
    }
  });
});

// ── PR-L1: live-battery substance vocabulary ─────────────────────────────────────────────────────
// The deployed battery (largo-battery-v2) scores each concept answer against the natural vocabulary
// of a CORRECT answer (must-have tokens + at-least-one-of tokens). 13 concepts "failed" live — the
// root cause was the answer-cache key collision (see platform-cache.test.ts), plus two genuinely
// thin answers (positive/negative gamma spoke only the long/short register). This suite renders the
// FULL member-facing envelope for every probed question and asserts the substance is present, so a
// future content edit can't silently strip the domain vocabulary a correct answer naturally uses.
describe("concept answers carry the domain substance the live battery probes (PR-L1)", () => {
  const lc = (s: string) => s.toLowerCase();
  const PROBES: Array<[question: string, mustAll: string[], mustAny: string[]]> = [
    ["What is GEX?", ["gamma", "exposure"], ["dealer", "hedge", "strike"]],
    ["What is a gamma flip?", ["gamma"], ["flip", "zero", "positive", "negative", "regime"]],
    ["What is max pain?", ["strike"], ["expire", "pain", "worthless", "option"]],
    ["What is VEX?", ["vanna"], ["exposure", "vol", "iv"]],
    ["What is a King node?", ["strike"], ["largest", "biggest", "strongest", "wall", "gamma"]],
    ["What is an Anchor in BlackOut?", ["anchor"], ["level", "reference", "rail", "wall"]],
    ["What does Night Hawk do?", [], ["overnight", "swing", "edition", "play"]],
    ["What is a call wall?", ["call"], ["resistance", "gamma", "strike"]],
    ["What is a put wall?", ["put"], ["support", "gamma", "strike"]],
    ["What is the options-implied expected move?", ["expected move"], ["straddle", "iv", "range", "sigma", "implied"]],
    ["What is a gamma magnet?", ["magnet"], ["pull", "pin", "strike", "toward", "gamma"]],
    ["What does positive gamma mean for the market?", ["positive gamma"], ["suppress", "stabil", "dampen", "pin"]],
    ["What does negative gamma mean?", ["negative gamma"], ["amplif", "volatil", "trend", "accelerat"]],
    ["What is a dark pool level?", ["dark pool"], ["off-exchange", "off exchange", "block", "support", "resistance", "level"]],
    ["What is 0DTE?", ["0dte"], ["zero", "same day", "same-day", "expire", "expiration", "today"]],
    ["What is Vector?", ["vector"], ["gex", "chart", "gamma", "dealer", "positioning", "wall"]],
    ["What is Helix?", ["helix"], ["flow", "tape", "prints", "options", "institutional"]],
    ["What is Largo?", ["largo"], ["desk", "assistant", "ask", "answer", "intelligence"]],
    ["What is wall integrity?", ["integrity"], ["confidence", "strength", "score"]],
    ["What is charm?", ["charm"], ["delta", "decay", "time", "greek"]],
    ["what is Thermal", ["thermal"], ["heatmap", "gex", "matrix"]],
  ];

  test("every probed question renders an envelope containing its substance vocabulary", () => {
    for (const [q, mustAll, mustAny] of PROBES) {
      const entry = lookupGlossary(q);
      assert.ok(entry, `no glossary hit for: ${q}`);
      const md = lc(buildConceptEnvelope(entry!).markdown);
      for (const t of mustAll) {
        assert.ok(md.includes(lc(t)), `${q}: answer missing required token "${t}"`);
      }
      if (mustAny.length) {
        assert.ok(
          mustAny.some((t) => md.includes(lc(t))),
          `${q}: answer has none of [${mustAny.join(", ")}]`
        );
      }
    }
  });

  test("each probed question resolves to a DISTINCT correct entry — no shared/hijacked answers", () => {
    // The live symptom was 13 different questions all rendering the GEX envelope. The cache fix
    // (platform-cache.test.ts) removes the serving-layer collision; this asserts the content layer
    // maps each probe to its own term, so the same symptom can't come back via alias drift.
    const terms = PROBES.map(([q]) => lookupGlossary(q)!.term);
    // positive + negative gamma deliberately share the Gamma regime entry — every other probe is unique.
    const unique = new Set(terms);
    assert.ok(unique.size >= PROBES.length - 1, `expected distinct entries, got ${unique.size}/${PROBES.length}`);
    assert.equal(terms.filter((t) => /Gamma regime/i.test(t)).length, 2);
  });
});
