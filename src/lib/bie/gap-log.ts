// BIE gap logger — a lightweight recorder for questions BIE could NOT answer with grounded data,
// so the gap list is observable and the glossary/composers can be grown to close it.
//
// Two classes of gap: a CONCEPT miss (no glossary definition for the asked term) and a LIVE-DATA
// miss (a vector/spx read whose state came back null — markets closed, cold matrix, off-universe
// ticker). Both should produce an HONEST answer to the member AND a recorded gap here — never a
// crash and never a silent desk-dump.
//
// Storage is a capped Redis list via the shared cache (memory-fallback when Redis is absent), so it
// is fail-open, needs no migration, and is unit-testable. Recording must NEVER throw into the
// caller — a logging failure can't be allowed to break an answer.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export type BieGap = {
  /** The member question (truncated). */
  question: string;
  /** The intent that produced no grounded answer (e.g. "concept_read", "vector_read"). */
  intent: string;
  /** Why it was a gap: "no_definition", "no_live_state", etc. */
  reason: string;
  /** ISO timestamp. */
  at: string;
};

const KEY = "bie:answer-gaps";
/** Keep the most recent N gaps — a rolling window, not an unbounded log. */
const MAX_GAPS = 200;
/** Long TTL so the list survives across sessions but self-cleans if the recorder goes quiet. */
const TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Record a gap. Fail-open and best-effort — any storage error is swallowed so a logging failure can
 * never break the answer path. Newest-first, capped at MAX_GAPS.
 */
export async function recordBieGap(gap: { question: string; intent: string; reason: string }): Promise<void> {
  try {
    const list = (await sharedCacheGet<BieGap[]>(KEY)) ?? [];
    const entry: BieGap = {
      question: (gap.question ?? "").slice(0, 300),
      intent: gap.intent,
      reason: gap.reason,
      at: new Date().toISOString(),
    };
    await sharedCacheSet(KEY, [entry, ...list].slice(0, MAX_GAPS), TTL_SEC);
  } catch {
    /* fail-open: a gap-log write must never surface to the caller */
  }
}

/** Read the recent gap list (newest first) — the observable "what BIE couldn't answer" feed. */
export async function fetchBieGaps(limit = 50): Promise<BieGap[]> {
  try {
    const list = (await sharedCacheGet<BieGap[]>(KEY)) ?? [];
    return list.slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
