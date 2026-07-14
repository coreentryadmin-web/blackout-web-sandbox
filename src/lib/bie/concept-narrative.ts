// Concept answers as full EXPLANATIONS, not dictionary lines. Turns a glossary entry (+ its rich
// content, if any) into a multi-section BieAnswerEnvelope: What it is · How it works · Why it matters
// · Example · On the platform. This is BIE being the AI — a sharp desk analyst explaining a concept,
// deterministic and grounded (no LLM), honest by construction (every claim traces to the code/docs
// the platform runs on). A term with no rich content still answers from its definition, just shorter.

import type { GlossaryEntry } from "@/lib/bie/glossary";
import { CONCEPT_RICH } from "@/lib/bie/concept-rich";
import { buildRichEnvelope, type RichSection } from "@/lib/bie/rich-narrative";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

/** A few natural next-concept prompts so the answer invites deeper exploration. */
const CONCEPT_FOLLOWUPS = ["What is the gamma flip?", "What is a King node?", "How does GEX work?"];

/**
 * Build the rich concept explanation envelope. Sections are only emitted when their content exists,
 * so a fully-populated core concept (GEX, gamma flip, walls, …) becomes a 4–5 section explanation
 * while a thinner term stays a clean single "What it is" section — never padded with empty headers.
 */
export function buildConceptEnvelope(entry: GlossaryEntry): BieAnswerEnvelope {
  const rich = CONCEPT_RICH[entry.term] ?? {};
  const sections: RichSection[] = [
    { title: "What it is", body: entry.definition },
    { title: "How it works", body: rich.howItWorks ?? "" },
    { title: "Why it matters", body: rich.whyItMatters ?? "" },
    { title: "Example", body: rich.example ?? "" },
    { title: "On the platform", body: rich.onPlatform ?? "" },
  ];

  const hasRich = Boolean(rich.howItWorks || rich.whyItMatters || rich.example || rich.onPlatform);

  return buildRichEnvelope({
    headline: entry.term,
    intent: "concept_read",
    sections,
    followups: CONCEPT_FOLLOWUPS,
    confidence: {
      level: "high",
      why: hasRich
        ? "Definitional + explanatory answer grounded in the platform's own code, data model, and docs — no LLM, no guessing."
        : "Definition grounded in the platform's own code/docs — no LLM.",
    },
  });
}

/** True when a term carries the full rich explanation (used by tests + coverage reporting). */
export function conceptHasRichExplanation(term: string): boolean {
  const r = CONCEPT_RICH[term];
  return Boolean(r && (r.howItWorks || r.whyItMatters || r.example || r.onPlatform));
}
