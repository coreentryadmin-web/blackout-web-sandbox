// Shared BIE composer types — extracted so verdict.ts (and other synthesis modules) can reference
// BieComposed WITHOUT importing composers.ts (which would create an import cycle, since composers.ts
// dynamically imports those modules).

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

/**
 * Deterministic answer plus the raw source payload for Layer-4 claim verification. `envelope` is the
 * structured member-facing answer (task #59/#63); `answer` is its markdown rendering (kept for the
 * existing string Largo path — always present, backward-compatible). A leg that hasn't migrated yet
 * returns only `answer` (+context); composeBieAnswer wraps it into a minimal envelope.
 */
export type BieComposed = {
  answer: string;
  context: unknown;
  envelope?: BieAnswerEnvelope;
};

/**
 * One citation line for a 0DTE play's PINNED merit tier (PR-F wiring) — same
 * indented-under-the-play style as PR-H's Cortex citation lines. Structural read
 * over the opaque entry_context.tier passthrough blob: a malformed/absent blob
 * renders NOTHING, never an invented grade. The pinned letter can only be A/B/C
 * (assignZeroDteTier's range; A+ is display-earned from the record and F is
 * skips-only, so neither can appear on a committed play's pin). Lives in this leaf
 * (not composers.ts) so it is testable without composers' full intent graph.
 */
export function tierLine(t: { tier?: unknown; factors?: unknown } | null | undefined): string {
  if (t == null || typeof t.tier !== "string") return "";
  const labels = Array.isArray(t.factors)
    ? t.factors
        .map((f) => (f != null && typeof f === "object" ? (f as { label?: unknown }).label : null))
        .filter((l): l is string => typeof l === "string")
    : [];
  return `\n  Merit tier **${t.tier}** at commit${labels.length ? ` — ${labels.join(" · ")}` : ""}`;
}
