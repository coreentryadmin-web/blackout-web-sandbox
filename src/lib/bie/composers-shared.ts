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
