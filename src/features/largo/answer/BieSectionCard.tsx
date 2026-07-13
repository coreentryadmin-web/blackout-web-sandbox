"use client";

import type { BieSection } from "@/lib/bie/answer-envelope";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { BiasPill, ConfidenceBadge, SourceStamp, UnavailableChip } from "./BieChips";
import { BieEvidencePanel } from "./BieEvidencePanel";
import { BieKeyLevelsTable } from "./BieKeyLevelsTable";

/**
 * One analysis/section card — typically one per sub-question. Renders the section
 * body through the existing Largo markdown renderer, plus any section-scoped bias,
 * evidence, key levels, confidence, and provenance. An unavailable section is shown
 * as an explicit chip (§4) — never silently dropped.
 */
export function BieSectionCard({ section }: { section: BieSection }) {
  return (
    <section className="bie-section" aria-label={section.title}>
      <div className="bie-section-head">
        <h3 className="bie-section-title">{section.title}</h3>
        {section.bias ? <BiasPill bias={section.bias} /> : null}
      </div>

      {section.unavailable ? (
        <UnavailableChip reason={section.unavailable.reason} />
      ) : (
        <>
          {section.body ? (
            <LargoMessageBody content={section.body} className="bie-section-body" />
          ) : null}
          <BieEvidencePanel evidence={section.evidence} />
          <BieKeyLevelsTable levels={section.levels} />
          {section.confidence ? (
            <ConfidenceBadge confidence={section.confidence} className="bie-section-conf" />
          ) : null}
          {section.provenance ? (
            <div className="bie-section-source">
              <SourceStamp provenance={section.provenance} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
