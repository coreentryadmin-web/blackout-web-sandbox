"use client";

import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";
import type {
  BieBias,
  BieConfidence,
  BieEvidenceKind,
  BieProvenance,
} from "@/lib/bie/answer-envelope";
import {
  BIAS_LABEL,
  CONFIDENCE_LABEL,
  EVIDENCE_KIND_LABEL,
  FRESHNESS_LABEL,
  biasToneClass,
  confidenceToneClass,
  evidenceKindToneClass,
  freshnessToneClass,
  relativeTime,
} from "./answer-format";

/** Directional bias pill (bullish/bearish/neutral/mixed). */
export function BiasPill({ bias, className }: { bias: BieBias; className?: string }) {
  return (
    <span className={clsx("bie-pill", biasToneClass(bias), className)}>{BIAS_LABEL[bias]}</span>
  );
}

/**
 * Confidence badge — evidence-quality calibrated (§1.7/§4), never a fake %. The
 * `why` line is always shown so the level is justified, not asserted.
 */
export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: BieConfidence;
  className?: string;
}) {
  return (
    <span
      className={clsx("bie-conf", confidenceToneClass(confidence.level), className)}
      title={confidence.why}
    >
      <span className="bie-conf-dot" aria-hidden />
      <span className="bie-conf-level">{CONFIDENCE_LABEL[confidence.level]}</span>
      {confidence.why ? <span className="bie-conf-why">— {confidence.why}</span> : null}
    </span>
  );
}

/** Honesty-taxonomy chip: fact / calc / inference / scenario. */
export function EvidenceKindChip({ kind }: { kind: BieEvidenceKind }) {
  return (
    <span className={clsx("bie-kind", evidenceKindToneClass(kind))}>
      {EVIDENCE_KIND_LABEL[kind]}
    </span>
  );
}

/**
 * Source + timestamp + freshness stamp (§4 provenance). ALWAYS renders the source;
 * the relative time and a freshness tag appear when known. Stale data is labelled
 * "Stale" — never dressed up as live.
 */
export function SourceStamp({ provenance }: { provenance?: BieProvenance | null }) {
  if (!provenance) return null;
  const rel = relativeTime(provenance.asOf);
  const freshness = provenance.freshness;
  return (
    <span className="bie-source" role="note">
      <span className="bie-source-label">{provenance.source}</span>
      {freshness ? (
        <span className={clsx("bie-fresh", freshnessToneClass(freshness))}>
          {FRESHNESS_LABEL[freshness]}
        </span>
      ) : null}
      {rel ? <span className="bie-source-time">{rel}</span> : null}
    </span>
  );
}

/** Explicit "unavailable" chip — a failed/missing part is surfaced, never hidden (§4). */
export function UnavailableChip({ reason }: { reason: string }) {
  return (
    <span className="bie-unavailable" role="note">
      <AlertTriangle size={12} aria-hidden />
      <span>Unavailable — {reason}</span>
    </span>
  );
}
