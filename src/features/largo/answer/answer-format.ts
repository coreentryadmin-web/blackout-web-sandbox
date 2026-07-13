// Presentational helpers for the BieAnswerEnvelope UI (task #64, BIE Master Spec
// §6 visual dominance + §4 honesty). Pure functions only — no React, no DOM — so
// the label/tone/count logic that drives the answer components is unit-testable.

import type {
  BieBias,
  BieConfidenceLevel,
  BieEvidenceKind,
  BieFreshness,
  BieSection,
} from "@/lib/bie/answer-envelope";

/** Display label for a bias. */
export const BIAS_LABEL: Record<BieBias, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
  mixed: "Mixed",
};

/** CSS modifier for a bias pill/tone (see globals.css .bie-bias-*). */
export function biasToneClass(bias: BieBias): string {
  return `bie-bias-${bias}`;
}

/** Display label for a confidence level. */
export const CONFIDENCE_LABEL: Record<BieConfidenceLevel, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  insufficient: "Insufficient evidence",
};

export function confidenceToneClass(level: BieConfidenceLevel): string {
  return `bie-conf-${level}`;
}

/** Short uppercase tag for an evidence kind (the honesty taxonomy chip). */
export const EVIDENCE_KIND_LABEL: Record<BieEvidenceKind, string> = {
  fact: "Fact",
  calc: "Calc",
  inference: "Inference",
  scenario: "Scenario",
};

export function evidenceKindToneClass(kind: BieEvidenceKind): string {
  return `bie-kind-${kind}`;
}

/** Freshness label — never call stale "live" (§4 honesty spine). */
export const FRESHNESS_LABEL: Record<BieFreshness, string> = {
  live: "Live",
  recent: "Recent",
  stale: "Stale",
  unknown: "Age unknown",
};

export function freshnessToneClass(freshness: BieFreshness): string {
  return `bie-fresh-${freshness}`;
}

/**
 * Compact "3m ago / 2h ago / just now" from an ISO timestamp, relative to `now`.
 * Returns null when the input is absent/unparseable so the UI can omit it rather
 * than render a fake time.
 */
export function relativeTime(asOf: string | null | undefined, now: number = Date.now()): string | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return null;
  const diff = now - t;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * "Answered N/N parts" accounting for the multi-part footer (§3: verify every
 * sub-question was addressed). A section counts as answered when it is NOT flagged
 * unavailable. Returns {answered,total} — total 0 means a single-part answer with
 * no section breakdown, and the footer is suppressed.
 */
export function answeredParts(sections: BieSection[]): { answered: number; total: number } {
  const total = sections.length;
  const answered = sections.filter((s) => !s.unavailable).length;
  return { answered, total };
}

/**
 * Best-effort headline for the transition path where the query API still returns a
 * markdown string (no populated envelope yet). Takes the first bold/heading/
 * non-empty line, strips markdown, and truncates — so `envelopeFromMarkdown` gets a
 * real headline instead of a generic one until synthesis (#59) ships.
 */
export function headlineFromMarkdown(markdown: string, fallback = "Largo read"): string {
  const lines = markdown.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (!line || /^-{3,}$/.test(line)) continue;
    const stripped = line
      .replace(/^#{1,6}\s+/, "")
      // Drop a trailing bias annotation like `_(bullish)_` BEFORE stripping the
      // underscores/asterisks it depends on, else the parens survive.
      .replace(/\s*_\([^)]*\)_\s*$/, "")
      .replace(/\*\*/g, "")
      .replace(/[*`_]/g, "")
      .trim();
    if (!stripped) continue;
    return stripped.length > 90 ? `${stripped.slice(0, 89).trimEnd()}…` : stripped;
  }
  return fallback;
}
