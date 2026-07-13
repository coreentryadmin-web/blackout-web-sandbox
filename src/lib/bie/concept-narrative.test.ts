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
