"use client";

import { Component, useMemo, type ReactNode } from "react";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { largoAnswerToEnvelope } from "@/features/largo/answer/answer-format";

/**
 * Renders a COMPLETED Largo assistant turn through the rich <BieAnswer> surface
 * (task #64 PR 3). Prefers a real `envelope` when one is available (forward-compat
 * with synthesis #59, which will make the query API return a populated
 * BieAnswerEnvelope); otherwise falls back to the transition shim
 * `largoAnswerToEnvelope`, which wraps the current `{answer, source}` markdown
 * string in a valid envelope. It lights up richer automatically once #59 lands —
 * no further UI change.
 *
 * Two guarantees:
 *  1. While STREAMING, the partial is rendered as plain markdown; we only swap to
 *     the structured card once the full answer is in (never parse a half-answer).
 *  2. If envelope construction or rich rendering throws, we degrade to the raw
 *     markdown string — a member never sees a broken card.
 */
export function LargoAnswerMessage({
  content,
  source,
  createdAt,
  envelope,
  streaming = false,
  className,
  onFollowup,
}: {
  content: string;
  source?: string | null;
  createdAt?: string | null;
  /** A real envelope from the query API once #59 ships; preferred when present. */
  envelope?: BieAnswerEnvelope | null;
  streaming?: boolean;
  className?: string;
  onFollowup?: (q: string) => void;
}) {
  const fallback = <LargoMessageBody content={content} className={className} />;

  const rich = useMemo<ReactNode | null>(() => {
    if (streaming || !content.trim()) return null;

    // Preferred path: a real, populated envelope — render everything it carries.
    if (envelope) {
      return (
        <BieAnswer envelope={envelope} bodyClassName={className} onFollowup={onFollowup} />
      );
    }

    // Transition path: wrap the markdown string. Only show bias/confidence when the
    // text states them, and only show an assembly time when we actually have one.
    try {
      const built = largoAnswerToEnvelope(content, {
        source: source ?? null,
        asOf: createdAt ?? undefined,
      });
      return (
        <BieAnswer
          envelope={built.envelope}
          showBias={built.showBias}
          showConfidence={built.showConfidence}
          showAsOf={Boolean(createdAt)}
          bodyClassName={className}
          onFollowup={onFollowup}
        />
      );
    } catch {
      return null;
    }
  }, [content, source, createdAt, envelope, streaming, className, onFollowup]);

  if (!rich) return fallback;

  return <BieAnswerBoundary fallback={fallback}>{rich}</BieAnswerBoundary>;
}

/** Error boundary: any render failure inside <BieAnswer> degrades to raw markdown. */
class BieAnswerBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
