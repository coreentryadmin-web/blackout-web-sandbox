import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  planVerdictLegs,
  assembleVerdictEnvelope,
  type VerdictInputs,
} from "@/lib/bie/verdict-core";

// ── planVerdictLegs — the relevance gate (depth matches merit) ───────────────
describe("verdict-core: planVerdictLegs relevance gating", () => {
  test("flagship 0DTE index verdict → gamma+flow+macro+breadth, NOT single-name earnings/fundamentals", () => {
    const p = planVerdictLegs("is SPX 7500 0DTE good today", "SPX");
    assert.equal(p.isIndex, true);
    assert.equal(p.horizon, "0dte");
    assert.equal(p.gamma, true);
    assert.equal(p.flow, true);
    // An index 0DTE strike verdict has no single-name event/fundamentals leg.
    assert.equal(p.earnings, false);
    assert.equal(p.fundamentals, false);
    // Same-day index read pulls the market backdrop.
    assert.equal(p.macro, true);
    assert.equal(p.breadth, true);
  });

  test("flagship single-name hold-into-earnings → earnings+fundamentals ON, breadth OFF", () => {
    const p = planVerdictLegs("hold NVDA into earnings", "NVDA");
    assert.equal(p.isIndex, false);
    assert.equal(p.horizon, "swing");
    assert.equal(p.gamma, true);
    assert.equal(p.flow, true);
    assert.equal(p.earnings, true);
    assert.equal(p.fundamentals, true);
    // A single-name hold doesn't need index breadth.
    assert.equal(p.breadth, false);
  });

  test("market risk-on question → macro+breadth ON (market-wide backdrop)", () => {
    const p = planVerdictLegs("is the market risk-on today", "SPX");
    assert.equal(p.macro, true);
    assert.equal(p.breadth, true);
  });

  test("peers requested only when asked", () => {
    assert.equal(planVerdictLegs("hold NVDA into earnings", "NVDA").related, false);
    assert.equal(planVerdictLegs("NVDA verdict vs its peers", "NVDA").related, true);
  });
});

// ── assembleVerdictEnvelope — the pure synthesizer ───────────────────────────
function fullInputs(over: Partial<VerdictInputs> = {}): VerdictInputs {
  return {
    ticker: "NVDA",
    question: "hold NVDA into earnings",
    plan: planVerdictLegs("hold NVDA into earnings", "NVDA"),
    positioning: { spot: 142, flip: 138, call_wall: 150, put_wall: 130, max_pain: 140, gamma_posture: "long" },
    regime: "short",
    flow: { count: 120, total_premium: 4_200_000, call_premium: 3_000_000, put_premium: 1_200_000 },
    earnings: { earnings_date: "2026-07-20", days_until: 2, report_time: "after", is_confirmed: true },
    fundamentals: { days_to_cover: 6.2, short_volume_ratio: 0.41, price_target: null, as_of: "2026-07-10" },
    macro: null,
    breadth: null,
    related: null,
    unavailable: [],
    ...over,
  };
}

describe("verdict-core: assembleVerdictEnvelope structure", () => {
  test("full inputs → populated envelope: sections, evidence with kinds+provenance, scenarios, levels, invalidation", () => {
    const env = assembleVerdictEnvelope(fullInputs());
    assert.equal(env.version, 1);
    assert.equal(env.intent, "verdict");
    // Anchor + flow + earnings + fundamentals each produced a section.
    const titles = env.sections.map((s) => s.title);
    assert.ok(titles.includes("Dealer positioning"), `has positioning section: ${titles}`);
    assert.ok(titles.includes("Options flow"));
    assert.ok(titles.includes("Earnings"));
    assert.ok(titles.some((t) => /short interest/i.test(t)));
    // Evidence carries the honesty taxonomy (fact/inference) + provenance.
    assert.ok(env.evidence.some((e) => e.kind === "fact"));
    assert.ok(env.evidence.every((e) => typeof e.text === "string" && e.text.length > 0));
    assert.ok(env.evidence.some((e) => e.provenance?.source));
    // Scenarios: bull/base/bear present when there's a positioning anchor.
    assert.deepEqual((env.scenarios ?? []).map((s) => s.kind), ["bull", "base", "bear"]);
    // Levels include the gamma flip + walls.
    assert.ok((env.levels ?? []).some((l) => l.label === "gamma flip" && l.price === 138));
    assert.ok((env.levels ?? []).some((l) => l.label === "call wall" && l.price === 150));
    // Invalidation names the flip; confidence is a graded level.
    assert.match(env.invalidation ?? "", /138/);
    assert.ok(["high", "moderate", "low", "insufficient"].includes(env.confidence.level));
    // Earnings-in-2d fires the binary-event inference.
    assert.ok(env.evidence.some((e) => e.kind === "inference" && /binary event/i.test(e.text)));
    // Markdown is a rendered string that mentions the confidence.
    assert.match(env.markdown, /Confidence:/);
  });

  test("confidence scales with surface coverage — 4+ live surfaces → high", () => {
    const env = assembleVerdictEnvelope(
      fullInputs({
        // positioning + flow + earnings + fundamentals = 4 substantive sections.
      })
    );
    assert.equal(env.confidence.level, "high");
  });

  test("no data at all → insufficient confidence, no scenarios fabricated", () => {
    const env = assembleVerdictEnvelope(
      fullInputs({
        positioning: null,
        regime: "unknown",
        flow: null,
        earnings: null,
        fundamentals: null,
        unavailable: [{ source: "GEX positioning", reason: "cold matrix / no spot" }],
      })
    );
    assert.equal(env.confidence.level, "insufficient");
    assert.equal(env.sections.length, 0);
    assert.equal(env.scenarios, undefined);
    assert.equal(env.invalidation, null);
    // The requested-but-thin source is surfaced, never silently dropped (master spec §4).
    assert.deepEqual(env.unavailableSources, [{ source: "GEX positioning", reason: "cold matrix / no spot" }]);
  });

  test("requested-but-thin legs are surfaced in unavailableSources verbatim", () => {
    const env = assembleVerdictEnvelope(
      fullInputs({
        fundamentals: null,
        unavailable: [{ source: "fundamentals/short-interest", reason: "no data for ticker" }],
      })
    );
    assert.ok(
      env.unavailableSources?.some((u) => u.source === "fundamentals/short-interest"),
      "thin fundamentals surfaced"
    );
    // A missing leg drops its section but doesn't crash the envelope.
    assert.ok(!env.sections.some((s) => /short interest/i.test(s.title)));
  });
});

// ── Cortex citation leg (PR-H) — cited alongside the verdict's own inputs ─────
describe("verdict-core: Cortex evidence section (PR-H)", () => {
  test("a pinned citation renders as a section + FACT evidence with the pinned source label", () => {
    const env = assembleVerdictEnvelope(
      fullInputs({
        cortex: {
          mode: "pinned",
          headline: "Cortex PASS (pinned at commit, 2026-07-14): score +1.85, conviction A",
          lines: ["+1.05 [wall-trend] call wall grew 3 samples."],
          asOf: "2026-07-14T14:31:00Z",
        },
      })
    );
    const s = env.sections.find((x) => x.title === "Cortex evidence (0DTE)");
    assert.ok(s, "cortex section present");
    assert.match(s!.body, /score \+1\.85, conviction A/);
    assert.match(s!.body, /wall-trend/);
    assert.equal(s!.provenance?.source, "Night Hawk Cortex (pinned at commit)");
    const ev = env.evidence.find((e) => e.text.includes("Cortex PASS"));
    assert.equal(ev?.kind, "fact"); // pinned record = fact
  });

  test("a live citation is tagged calc (derived now, not a record)", () => {
    const env = assembleVerdictEnvelope(
      fullInputs({
        cortex: { mode: "live", headline: "Cortex (live, long): net score +1.2, conviction B", lines: [], asOf: null },
      })
    );
    const ev = env.evidence.find((e) => e.text.includes("net score +1.2"));
    assert.equal(ev?.kind, "calc");
    assert.equal(env.sections.find((x) => x.title === "Cortex evidence (0DTE)")?.provenance?.source, "Night Hawk Cortex (live)");
  });

  test("no citation → no cortex section, envelope unchanged (regression)", () => {
    const env = assembleVerdictEnvelope(fullInputs());
    assert.equal(env.sections.find((x) => x.title === "Cortex evidence (0DTE)"), undefined);
  });
});
