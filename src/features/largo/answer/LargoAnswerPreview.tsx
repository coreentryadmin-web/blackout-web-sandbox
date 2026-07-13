"use client";

import { makeEnvelope, type BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { BieAnswer } from "./BieAnswer";

// Admin-only render harness (no Storybook in this repo) that exercises every branch
// of the answer components against hand-built envelopes: a deep multi-section answer
// with evidence/levels/scenarios/unavailable, and a compact single-section answer.
// These are FIXTURES — not live data — so the timestamps are relative to render time.

function iso(minsAgo: number): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

const DEEP: BieAnswerEnvelope = makeEnvelope({
  headline: "SPX structurally bid above 7,500 flip; overhead call wall caps the push",
  bias: "bullish",
  intent: "level_analysis",
  sections: [
    {
      title: "Directional read",
      body: "Price is holding **above the 7,500 gamma flip**, so dealer hedging is stabilizing dips. But the move lacks confirmation: cumulative flow is *weakening into* the 7,540 call wall and breadth is only neutral.",
      bias: "bullish",
      evidence: [
        {
          kind: "fact",
          text: "SPX 7,512, +0.4% on the session.",
          provenance: { source: "Polygon quote", asOf: iso(0.5), freshness: "live" },
        },
        {
          kind: "calc",
          text: "Net GEX flips positive at 7,500; dealers long gamma above.",
          provenance: { source: "Vector GEX", asOf: iso(3), freshness: "recent" },
        },
        {
          kind: "inference",
          text: "Weak cumulative flow into the wall argues for chop, not breakout.",
          provenance: { source: "HELIX flow", asOf: iso(2), freshness: "recent" },
        },
      ],
      confidence: {
        level: "moderate",
        why: "Two confluent sources agree on the flip; flow confirmation is missing.",
      },
      levels: [
        { label: "Call wall", price: 7540, note: "primary overhead cap", provenance: { source: "Vector GEX", asOf: iso(3), freshness: "recent" } },
        { label: "Gamma flip", price: 7500, note: "regime pivot", provenance: { source: "Vector GEX", asOf: iso(3), freshness: "recent" } },
        { label: "VWAP", price: 7498.36, provenance: { source: "Vector technicals", asOf: iso(1), freshness: "live" } },
      ],
    },
    {
      title: "News / catalysts",
      body: "",
      unavailable: { reason: "Benzinga key not configured this environment" },
    },
  ],
  evidence: [
    {
      kind: "scenario",
      text: "A close back under 7,500 flips dealers short gamma and opens air to 7,460.",
      provenance: { source: "Vector GEX", asOf: iso(3), freshness: "recent" },
    },
  ],
  confidence: {
    level: "moderate",
    why: "Gamma structure is clear; directional flow is not confirming continuation.",
  },
  invalidation: "Sustained trade below 7,500 (loses the flip) negates the bullish structure.",
  scenarios: [
    { kind: "bull", thesis: "Reclaim + hold 7,540 call wall", trigger: "15m close > 7,540", confirm: "flow turns positive", targets: ["7,565", "7,590"], risks: ["wall re-loads higher"] },
    { kind: "base", thesis: "Chop 7,500–7,540 into PM", trigger: "rejection at wall", confirm: "declining RVOL" },
    { kind: "bear", thesis: "Lose the flip, dealers short gamma", trigger: "close < 7,500", invalidation: "reclaim 7,505", targets: ["7,460"], risks: ["gap-fill snapback"] },
  ],
  levels: [
    { label: "PDH", price: 7528, provenance: { source: "Vector session", asOf: iso(90), freshness: "stale" } },
    { label: "Max pain", price: 7490, note: "0DTE", provenance: { source: "Polygon options", asOf: iso(6), freshness: "recent" } },
  ],
  followups: ["What flips the flow bullish?", "Show me the 0DTE call wall history", "Compare to yesterday's structure"],
  unavailableSources: [{ source: "Benzinga news", reason: "API key missing" }],
});

const COMPACT: BieAnswerEnvelope = makeEnvelope({
  headline: "VIX 14.2 — low, calm regime",
  bias: "neutral",
  intent: "market_status",
  sections: [
    {
      title: "Read",
      body: "VIX is **14.2**, near the low end of its 30-day range — a calm, mean-reverting tape. No stress signal in vol right now.",
    },
  ],
  evidence: [],
  confidence: { level: "high", why: "Single unambiguous live reading." },
});

export function LargoAnswerPreview() {
  return (
    <div className="bie-preview">
      <div className="bie-preview-block">
        <p className="bie-preview-caption">Deep dive — multi-section, evidence, levels, scenarios, unavailable part</p>
        <div className="bie-preview-surface">
          <BieAnswer envelope={DEEP} onFollowup={() => {}} />
        </div>
      </div>
      <div className="bie-preview-block">
        <p className="bie-preview-caption">Compact — single-section (the envelopeFromMarkdown transition shape)</p>
        <div className="bie-preview-surface">
          <BieAnswer envelope={COMPACT} />
        </div>
      </div>
    </div>
  );
}
