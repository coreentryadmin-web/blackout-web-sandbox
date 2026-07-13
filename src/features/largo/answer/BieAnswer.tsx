"use client";

import { clsx } from "clsx";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { BiasPill, ConfidenceBadge, SourceStamp, UnavailableChip } from "./BieChips";
import { BieEvidencePanel } from "./BieEvidencePanel";
import { BieKeyLevelsTable } from "./BieKeyLevelsTable";
import { BieScenarioCards } from "./BieScenarioCards";
import { BieSectionCard } from "./BieSectionCard";
import { answeredParts, relativeTime } from "./answer-format";

/**
 * Whether the envelope is "shallow" — a single section with no cross-cutting
 * structure. This is the shape `envelopeFromMarkdown` produces on the transition
 * path (query API still returns a markdown string). Depth matches merit (§3): a
 * shallow answer renders as compact prose under the header, a rich one expands into
 * section cards + evidence + levels + scenarios.
 */
function isCompact(env: BieAnswerEnvelope): boolean {
  return (
    env.sections.length <= 1 &&
    (env.evidence?.length ?? 0) === 0 &&
    (env.levels?.length ?? 0) === 0 &&
    (env.scenarios?.length ?? 0) === 0 &&
    !env.sections[0]?.evidence?.length &&
    !env.sections[0]?.levels?.length
  );
}

/**
 * Top-level renderer for a BieAnswerEnvelope (BIE Master Spec §4/§6). Binds directly
 * to the merged contract (src/lib/bie/answer-envelope.ts) so it lights up richer the
 * moment synthesis (#59) returns a populated envelope — no UI change required.
 */
export function BieAnswer({
  envelope,
  className,
  onFollowup,
}: {
  envelope: BieAnswerEnvelope;
  className?: string;
  /** Optional: follow-up chips wire back into the terminal's runQuery. */
  onFollowup?: (q: string) => void;
}) {
  const compact = isCompact(envelope);
  const { answered, total } = answeredParts(envelope.sections);
  const asOfRel = relativeTime(envelope.asOf);

  return (
    <div className={clsx("bie-answer", compact && "bie-answer-compact", className)}>
      <header className="bie-answer-head">
        <div className="bie-answer-head-row">
          <h2 className="bie-answer-headline">{envelope.headline}</h2>
          <BiasPill bias={envelope.bias} />
        </div>
        <ConfidenceBadge confidence={envelope.confidence} className="bie-answer-conf" />
      </header>

      {/* Sources requested but unavailable this turn — surfaced up top, never hidden (§4). */}
      {envelope.unavailableSources && envelope.unavailableSources.length > 0 ? (
        <div className="bie-answer-unavailable">
          {envelope.unavailableSources.map((u, i) => (
            <UnavailableChip key={`${u.source}-${i}`} reason={`${u.source}: ${u.reason}`} />
          ))}
        </div>
      ) : null}

      {compact ? (
        envelope.sections[0]?.body ? (
          <LargoMessageBody content={envelope.sections[0].body} className="bie-answer-body" />
        ) : null
      ) : (
        <div className="bie-answer-sections">
          {envelope.sections.map((s, i) => (
            <BieSectionCard key={`${s.title}-${i}`} section={s} />
          ))}
        </div>
      )}

      <BieEvidencePanel evidence={envelope.evidence} />
      <BieKeyLevelsTable levels={envelope.levels} />
      <BieScenarioCards scenarios={envelope.scenarios} />

      {envelope.invalidation ? (
        <p className="bie-answer-invalidation">
          <span className="bie-answer-invalidation-label">Invalidation</span>
          {envelope.invalidation}
        </p>
      ) : null}

      <footer className="bie-answer-foot">
        {total > 1 ? (
          <span
            className={clsx("bie-answer-parts", answered < total && "bie-answer-parts-partial")}
          >
            Answered {answered}/{total} parts
          </span>
        ) : null}
        {asOfRel ? <span className="bie-answer-asof">Assembled {asOfRel}</span> : null}
      </footer>

      {onFollowup && envelope.followups && envelope.followups.length > 0 ? (
        <div className="bie-answer-followups">
          <span className="bie-block-label">Ask next</span>
          <div className="bie-answer-followups-row">
            {envelope.followups.slice(0, 4).map((f) => (
              <button
                key={f}
                type="button"
                className="bie-followup-chip"
                onClick={() => onFollowup(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
