// Shared rich-narrative helper — the ONE place deterministic BIE composers turn titled prose
// sections into a full BieAnswerEnvelope, so every answer type (concept, data-read, …) is rich and
// CONSISTENT in shape (mirrors how spx-desk-brief.ts builds multi-section THESIS/WHY/MECHANIC/LEVELS
// narrative). A one-liner answer is the thing we're moving away from: prefer several substantive
// sections. Empty/blank sections are dropped so a partially-populated answer stays clean and honest.

import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidence,
  type BieEvidence,
  type BieLevel,
  type BieScenario,
  type BieSection,
} from "@/lib/bie/answer-envelope";

export type RichSection = {
  title: string;
  /** Member-readable prose/markdown. Blank → the section is dropped. */
  body: string;
  bias?: BieBias;
};

export type BuildRichEnvelopeInput = {
  headline: string;
  bias?: BieBias;
  intent?: string;
  sections: RichSection[];
  evidence?: BieEvidence[];
  levels?: BieLevel[];
  scenarios?: BieScenario[];
  confidence?: BieConfidence;
  invalidation?: string | null;
  followups?: string[];
};

/**
 * Assemble a rich multi-section envelope from titled prose. The single constructor every rich
 * deterministic composer should call — keeps headline/sections/evidence/levels/scenarios/confidence
 * uniform and produces the backward-compatible `markdown` for the existing string Largo path.
 */
export function buildRichEnvelope(input: BuildRichEnvelopeInput): BieAnswerEnvelope {
  const sections: BieSection[] = input.sections
    .filter((s) => s.body && s.body.trim().length > 0)
    .map((s) => ({ title: s.title, body: s.body.trim(), ...(s.bias ? { bias: s.bias } : {}) }));

  return makeEnvelope({
    headline: input.headline,
    bias: input.bias ?? "neutral",
    intent: input.intent ?? null,
    sections,
    evidence: input.evidence ?? [],
    levels: input.levels,
    scenarios: input.scenarios,
    confidence:
      input.confidence ?? {
        level: "high",
        why: "Deterministic answer grounded in the platform's own code, data, and docs — no LLM.",
      },
    invalidation: input.invalidation ?? null,
    followups: input.followups,
  });
}
