"use client";

import type { BieEvidence } from "@/lib/bie/answer-envelope";
import { EvidenceKindChip, SourceStamp } from "./BieChips";

/**
 * Evidence panel (§4/§5): each item shows its honesty kind (fact/calc/inference/
 * scenario), the statement, and its provenance — keeping evidence visibly separate
 * from interpretation. Renders nothing when there's no evidence.
 */
export function BieEvidencePanel({
  evidence,
  label = "Evidence",
}: {
  evidence: BieEvidence[] | undefined;
  label?: string;
}) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="bie-evidence">
      <p className="bie-block-label">{label}</p>
      <ul className="bie-evidence-list">
        {evidence.map((e, i) => (
          <li key={i} className="bie-evidence-item">
            <EvidenceKindChip kind={e.kind} />
            <span className="bie-evidence-text">{e.text}</span>
            <SourceStamp provenance={e.provenance} />
          </li>
        ))}
      </ul>
    </div>
  );
}
