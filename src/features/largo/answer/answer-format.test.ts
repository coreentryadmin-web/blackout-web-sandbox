import { test } from "node:test";
import assert from "node:assert/strict";

import {
  answeredParts,
  biasFromMarkdown,
  biasToneClass,
  confidenceFromMarkdown,
  confidenceToneClass,
  evidenceKindToneClass,
  freshnessToneClass,
  headlineFromMarkdown,
  largoAnswerToEnvelope,
  relativeTime,
  splitLeadHeadline,
} from "./answer-format";
import type { BieSection } from "@/lib/bie/answer-envelope";

test("tone-class helpers are stable and scoped", () => {
  assert.equal(biasToneClass("bullish"), "bie-bias-bullish");
  assert.equal(confidenceToneClass("insufficient"), "bie-conf-insufficient");
  assert.equal(evidenceKindToneClass("calc"), "bie-kind-calc");
  assert.equal(freshnessToneClass("stale"), "bie-fresh-stale");
});

test("relativeTime formats and rejects bad input", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");
  assert.equal(relativeTime(null, now), null);
  assert.equal(relativeTime("not-a-date", now), null);
  assert.equal(relativeTime("2026-07-13T11:59:30Z", now), "just now");
  assert.equal(relativeTime("2026-07-13T11:45:00Z", now), "15m ago");
  assert.equal(relativeTime("2026-07-13T09:00:00Z", now), "3h ago");
  assert.equal(relativeTime("2026-07-11T12:00:00Z", now), "2d ago");
  // A future timestamp is clamped to "just now", never negative.
  assert.equal(relativeTime("2026-07-13T12:05:00Z", now), "just now");
});

test("answeredParts counts unavailable sections as unanswered", () => {
  const sections: BieSection[] = [
    { title: "SPX", body: "..." },
    { title: "Flow", body: "..." },
    { title: "News", body: "", unavailable: { reason: "Benzinga key missing" } },
  ];
  assert.deepEqual(answeredParts(sections), { answered: 2, total: 3 });
  assert.deepEqual(answeredParts([]), { answered: 0, total: 0 });
});

test("headlineFromMarkdown extracts first meaningful line, stripped and truncated", () => {
  assert.equal(headlineFromMarkdown("**SPX holding above VWAP**  _(bullish)_"), "SPX holding above VWAP");
  assert.equal(headlineFromMarkdown("---\n\n## Read\nbody"), "Read");
  assert.equal(headlineFromMarkdown("   \n\n"), "Largo read");
  const long = "x".repeat(120);
  const out = headlineFromMarkdown(long);
  assert.ok(out.length <= 90 && out.endsWith("…"));
});

test("biasFromMarkdown reads explicit markers only, else undefined", () => {
  assert.equal(biasFromMarkdown("SPX holding **VWAP** _(bullish)_"), "bullish");
  assert.equal(biasFromMarkdown("**Bias:** Bearish into the close"), "bearish");
  assert.equal(biasFromMarkdown("Verdict - neutral"), "neutral");
  assert.equal(biasFromMarkdown("Price is above VWAP and grinding higher"), undefined);
});

test("confidenceFromMarkdown reads explicit statements only, else undefined", () => {
  assert.equal(confidenceFromMarkdown("Confidence: High")?.level, "high");
  assert.equal(confidenceFromMarkdown("confidence - low")?.level, "low");
  assert.equal(confidenceFromMarkdown("There is insufficient evidence here")?.level, "insufficient");
  assert.equal(confidenceFromMarkdown("SPX is bid above 7500"), undefined);
});

test("splitLeadHeadline promotes a heading/bold/short lead and de-dupes the body", () => {
  const a = splitLeadHeadline("**SPX bid above the flip**\n\nStructure favors continuation.");
  assert.equal(a.headline, "SPX bid above the flip");
  assert.equal(a.body, "Structure favors continuation.");

  const b = splitLeadHeadline("VIX 14.2 — calm regime");
  assert.equal(b.headline, "VIX 14.2 — calm regime");
  assert.equal(b.body, "");

  const long = "x".repeat(120) + " and more prose here to keep it flowing";
  const c = splitLeadHeadline(long);
  assert.equal(c.headline, "");
  assert.equal(c.body, long);
});

test("largoAnswerToEnvelope hides bias/confidence when the text doesn't state them", () => {
  const plain = largoAnswerToEnvelope("Price is above VWAP, grinding higher.", {
    source: "bie-router",
  });
  assert.equal(plain.showBias, false);
  assert.equal(plain.showConfidence, false);
  assert.equal(plain.envelope.intent, "bie-router");
  assert.equal(plain.envelope.sections.length, 1);

  const explicit = largoAnswerToEnvelope("**Bias:** bullish. Confidence: high. Hold above 7500.");
  assert.equal(explicit.showBias, true);
  assert.equal(explicit.envelope.bias, "bullish");
  assert.equal(explicit.showConfidence, true);
  assert.equal(explicit.envelope.confidence.level, "high");
});

test("largoAnswerToEnvelope honors a provided asOf for the footer", () => {
  const asOf = "2026-07-13T11:00:00Z";
  const { envelope } = largoAnswerToEnvelope("Some read", { asOf });
  assert.equal(envelope.asOf, asOf);
});
