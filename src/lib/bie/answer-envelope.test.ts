import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  makeEnvelope,
  renderEnvelopeMarkdown,
  envelopeFromMarkdown,
  freshnessFromAgeMs,
  BIE_ANSWER_ENVELOPE_VERSION,
  type BieAnswerEnvelope,
} from "@/lib/bie/answer-envelope";

describe("freshnessFromAgeMs", () => {
  test("buckets by age", () => {
    assert.equal(freshnessFromAgeMs(0), "live");
    assert.equal(freshnessFromAgeMs(30_000), "live");
    assert.equal(freshnessFromAgeMs(120_000), "recent");
    assert.equal(freshnessFromAgeMs(30 * 60_000), "stale");
    assert.equal(freshnessFromAgeMs(null), "unknown");
    assert.equal(freshnessFromAgeMs(-5), "unknown");
  });
});

describe("makeEnvelope", () => {
  test("fills version, asOf, and a markdown rendering", () => {
    const env = makeEnvelope({
      headline: "SPX long-gamma, range-bound",
      bias: "neutral",
      intent: "vector_read",
      sections: [
        {
          title: "Regime",
          body: "Spot above the gamma flip → dealers fade moves.",
          bias: "neutral",
          evidence: [
            { kind: "fact", text: "Spot 7,560 vs flip 7,520", provenance: { source: "Vector GEX", freshness: "live" } },
            { kind: "inference", text: "Range/mean-revert until spot loses the flip" },
          ],
          confidence: { level: "moderate", why: "One decisive regime signal, no confluence stack yet." },
        },
      ],
      evidence: [{ kind: "calc", text: "+0.53% above the flip" }],
      confidence: { level: "moderate", why: "Live positioning, single-lens read." },
      invalidation: "5m close below 7,520 flips to short gamma.",
      scenarios: [
        { kind: "base", thesis: "Pin toward the magnet", trigger: "holds above 7,520", invalidation: "loses 7,520" },
      ],
      levels: [{ label: "gamma flip", price: 7520 }, { label: "call wall", price: 7600 }],
      followups: ["Which walls are building?"],
      unavailableSources: [{ source: "dark pool", reason: "no prints in-window" }],
    });

    assert.equal(env.version, BIE_ANSWER_ENVELOPE_VERSION);
    assert.ok(env.asOf, "asOf filled");
    assert.ok(env.markdown.length > 0, "markdown rendered");
    // Structured fields preserved.
    assert.equal(env.sections.length, 1);
    assert.equal(env.bias, "neutral");
    // Markdown carries the honesty taxonomy + provenance + unavailable disclosure.
    assert.match(env.markdown, /\[FACT\]/);
    assert.match(env.markdown, /\[INFERENCE\]/);
    assert.match(env.markdown, /Vector GEX/);
    assert.match(env.markdown, /Confidence: moderate/);
    assert.match(env.markdown, /Invalidation:/);
    assert.match(env.markdown, /Unavailable this turn:.*dark pool/);
    assert.match(env.markdown, /SCENARIOS|Scenarios/i);
    assert.match(env.markdown, /Key levels/);
  });

  test("an unavailable SECTION renders honestly, never fabricated", () => {
    const env = makeEnvelope({
      headline: "Partial read",
      bias: "neutral",
      sections: [
        { title: "SPX flip", body: "SPX flip 7,520.", evidence: [] },
        { title: "MSFT beads", body: "", unavailable: { reason: "no rail recorded off-hours" } },
      ],
      evidence: [],
      confidence: { level: "low", why: "One of two sections unavailable." },
    });
    assert.match(env.markdown, /## MSFT beads\n_unavailable — no rail recorded off-hours_/);
    // The unavailable section's body is not fabricated.
    assert.ok(!env.markdown.includes("MSFT beads\n\n"));
  });
});

describe("renderEnvelopeMarkdown", () => {
  test("renders structured section tables", () => {
    const md = renderEnvelopeMarkdown({
      version: 1,
      headline: "HELIX",
      bias: "neutral",
      sections: [
        {
          title: "Data",
          body: "",
          table: {
            headers: ["Ticker", "Premium"],
            rows: [["SPX", "$1.2M"]],
          },
        },
      ],
      evidence: [],
      confidence: { level: "high", why: "live tape" },
      asOf: "2026-07-13T15:00:00.000Z",
    });
    assert.match(md, /\| Ticker \| Premium \|/);
    assert.match(md, /\| SPX \| \$1\.2M \|/);
  });

  test("is a pure function of the structured fields (ignores a pre-set markdown)", () => {
    const base: Omit<BieAnswerEnvelope, "markdown"> = {
      version: 1,
      headline: "H",
      bias: "bullish",
      sections: [{ title: "S", body: "B" }],
      evidence: [],
      confidence: { level: "high", why: "strong confluence" },
      asOf: "2026-07-13T15:00:00.000Z",
    };
    const md = renderEnvelopeMarkdown(base);
    assert.match(md, /\*\*H\*\* {2}_\(bullish\)_/);
    assert.match(md, /## S/);
    assert.match(md, /Confidence:\*\* high — strong confluence/);
  });
});

describe("envelopeFromMarkdown (transition shim)", () => {
  test("wraps a plain string in a valid single-section envelope", () => {
    const env = envelopeFromMarkdown("**SPX Live Desk read**\n…", { headline: "SPX desk read", bias: "bearish", intent: "spx_desk_read" });
    assert.equal(env.version, 1);
    assert.equal(env.bias, "bearish");
    assert.equal(env.sections.length, 1);
    assert.ok(env.markdown.includes("SPX Live Desk read"));
    assert.equal(env.confidence.level, "moderate");
  });
});
