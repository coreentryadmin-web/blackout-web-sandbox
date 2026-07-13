// Presentational helpers for the BieAnswerEnvelope UI (task #64, BIE Master Spec
// §6 visual dominance + §4 honesty). Pure functions only — no React, no DOM — so
// the label/tone/count logic that drives the answer components is unit-testable.

import type {
  BieAnswerEnvelope,
  BieBias,
  BieConfidence,
  BieConfidenceLevel,
  BieEvidenceKind,
  BieFreshness,
  BieSection,
} from "@/lib/bie/answer-envelope";
import { makeEnvelope } from "@/lib/bie/answer-envelope";

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

// ── Live-terminal transition shim (task #64 PR 3) ──────────────────────────
// The query API still returns { answer, source, tools_used } (a markdown string)
// until synthesis (#59) makes it return a populated BieAnswerEnvelope. These helpers
// wrap that string in a valid envelope so the live terminal renders through
// <BieAnswer> now — surfacing ONLY what can be honestly derived (§4): a lead
// headline, the formatted body, and bias/confidence ONLY when the text explicitly
// states them (never a fabricated "neutral"/"moderate" on a plain answer).

/** Strip inline markdown from one line to make a plain-text headline. */
function stripInline(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s*_\([^)]*\)_\s*$/, "")
    .replace(/\*\*/g, "")
    .replace(/[*`_]/g, "")
    .trim();
}

/**
 * Detect an EXPLICIT bias marker — a trailing `_(bullish)_` annotation or a
 * "Bias: bearish" / "Verdict - neutral" phrase. Returns undefined when none is
 * present so the UI OMITS the bias pill rather than asserting a fabricated bias.
 */
export function biasFromMarkdown(markdown: string): BieBias | undefined {
  const annot = markdown.match(/_\((bullish|bearish|neutral|mixed)\)_/i);
  if (annot) return annot[1].toLowerCase() as BieBias;
  const labelled = markdown.match(
    /\b(?:bias|verdict|stance)\b\**\s*[:\-]\s*\**\s*(bullish|bearish|neutral|mixed)/i
  );
  if (labelled) return labelled[1].toLowerCase() as BieBias;
  return undefined;
}

/**
 * Detect an EXPLICIT confidence statement ("Confidence: high", "insufficient
 * evidence"). Returns undefined when absent so the UI OMITS the confidence badge
 * instead of asserting a canned "moderate" — false certainty is a §4 violation.
 */
export function confidenceFromMarkdown(markdown: string): BieConfidence | undefined {
  const m = markdown.match(/\bconfidence\b\**\s*[:\-]\s*\**\s*(high|moderate|low|insufficient)/i);
  if (m) return { level: m[1].toLowerCase() as BieConfidenceLevel, why: "" };
  if (/\binsufficient\s+evidence\b/i.test(markdown)) return { level: "insufficient", why: "" };
  return undefined;
}

/**
 * Split a markdown answer into an optional lead headline + body. Promotes the first
 * meaningful line to a headline ONLY when it reads like one (markdown heading, a
 * fully bold line, or a short lead ≤80 chars) and removes it from the body to avoid
 * duplication. Otherwise headline is "" (the UI renders no <h2>, keeps the full body).
 */
export function splitLeadHeadline(markdown: string): { headline: string; body: string } {
  const lines = markdown.split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || /^-{3,}$/.test(t)) continue;
    idx = i;
    break;
  }
  if (idx === -1) return { headline: "", body: markdown };

  const raw = lines[idx].trim();
  const isHeading = /^#{1,6}\s+/.test(raw);
  const isBoldLine = /^\*\*.+\*\*\s*(_\([^)]*\)_)?\s*$/.test(raw);
  const stripped = stripInline(raw);
  const promote = Boolean(stripped) && (isHeading || isBoldLine || stripped.length <= 80);
  if (!promote) return { headline: "", body: markdown };

  const rest = lines.slice(idx + 1).join("\n").trim();
  return { headline: stripped, body: rest };
}

/**
 * Wrap the query API's current markdown answer in a valid BieAnswerEnvelope for the
 * live terminal. `showBias`/`showConfidence` tell the renderer whether those chips
 * are real (parsed from the text) or defaulted (hide them). Replaced automatically
 * the moment the API returns a real envelope — the consumer prefers `res.envelope`.
 */
export function largoAnswerToEnvelope(
  answer: string,
  opts: { source?: string | null; asOf?: string } = {}
): { envelope: BieAnswerEnvelope; showBias: boolean; showConfidence: boolean } {
  const { headline, body } = splitLeadHeadline(answer);
  const bias = biasFromMarkdown(answer);
  const confidence = confidenceFromMarkdown(answer);
  const envelope = makeEnvelope({
    headline,
    bias: bias ?? "neutral",
    intent: opts.source ?? null,
    // `body` is "" only when the whole answer became the headline (single line);
    // compact <BieAnswer> then renders headline-only, no duplicate body.
    sections: [{ title: "Read", body }],
    evidence: [],
    // Placeholder when unknown; hidden via showConfidence:false so it's never shown.
    confidence: confidence ?? { level: "moderate", why: "" },
    asOf: opts.asOf,
  });
  return { envelope, showBias: bias !== undefined, showConfidence: confidence !== undefined };
}
