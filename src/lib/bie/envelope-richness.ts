import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

/**
 * True when the envelope carries real synthesis structure (multi-section, evidence, scenarios,
 * levels, unavailable sources, or a section with its own evidence/levels/provenance/bias/confidence).
 * Trivial single-section shims from string-only legs return false so the client uses markdown.
 */
export function isRichBieEnvelope(env: BieAnswerEnvelope | null | undefined): boolean {
  if (!env) return false;
  const sections = env.sections ?? [];
  if (sections.length > 1) return true;
  if ((env.evidence?.length ?? 0) > 0) return true;
  if ((env.scenarios?.length ?? 0) > 0) return true;
  if ((env.levels?.length ?? 0) > 0) return true;
  if ((env.unavailableSources?.length ?? 0) > 0) return true;
  return sections.some(
    (s) =>
      (s.evidence?.length ?? 0) > 0 ||
      (s.levels?.length ?? 0) > 0 ||
      s.table != null ||
      s.provenance != null ||
      s.bias != null ||
      s.confidence != null
  );
}
