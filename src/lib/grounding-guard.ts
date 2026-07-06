// Shared numeric-grounding guard for LLM narrative surfaces. Extracted from
// src/app/api/market/gex-heatmap/explain/route.ts's narrativeLevelsAreGrounded
// (the ONLY surface that had this check) so every other LLM-generated prose
// surface (spx-play-claude.ts, spx-commentary.ts, nighthawk/play-explainer.ts,
// flow-brief/route.ts, nights-watch/position-narrative.ts, nighthawk/play-critic.ts)
// can apply the identical fabrication check instead of shipping ungrounded numbers
// unchecked.

export type GroundingCheckResult = {
  grounded: boolean;
  /** The first ungrounded value found (for logging/diagnostics), else null. */
  ungroundedValue: number | null;
};

/**
 * Cheap post-generation FABRICATION GUARD: extract every number in `text` that READS LIKE a
 * price level and confirm it matches one of the caller-supplied `known` values within tolerance.
 * A prompt can instruct a model to "ground every number in the data," but that's only an
 * instruction — this verifies it structurally. Returns `grounded: true` when every plausible
 * level matches (or the text names no price levels at all); `grounded: false` when ANY cited
 * level is absent from `known` — the caller should discard the text / fall back to a
 * deterministic alternative rather than publish a possibly-fabricated number.
 *
 * Conservative by design — ignores:
 *   • percentages ("0.42%"), which are day-change / distance figures, not levels;
 *   • money magnitudes ("$688M", "$1.2B"), aggregate dollar figures;
 *   • small integers <10 (sentence counts, "3 to 5 sentences", "0DTE");
 * so it doesn't false-positive on legitimate non-level numbers. Tolerance scales with magnitude
 * so a "745" read against a known 745.0 level passes, but a hallucinated "812" against a
 * 730-760 band fails.
 */
function levelTolerance(lvl: number): number {
  return Math.max(lvl * 0.0015, 0.5); // ~0.15% or half a point
}

export function checkNumbersGrounded(text: string, known: number[]): GroundingCheckResult {
  if (known.length === 0) return { grounded: true, ungroundedValue: null };

  // Bracket of plausible levels — a number far outside the known band can't be a real level
  // even if it's numerically "close" to nothing.
  const minKnown = Math.min(...known);
  const maxKnown = Math.max(...known);
  const tol = levelTolerance;

  // Match decimal numbers; the trailing context lets us reject %/money/units in code below.
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;

    const start = m.index;
    const end = start + raw.length;
    const before = text.slice(Math.max(0, start - 1), start);
    const after = text.slice(end, end + 2);

    // Skip percentages and explicit money (those aren't price levels).
    if (after.startsWith("%")) continue;
    if (before === "$") continue;
    // Skip a number immediately followed by a money/scale suffix (e.g. "688M", "1.2B", "250K").
    if (/^[%MBK]/.test(after)) continue;
    // Skip small integers — sentence counts, "0DTE", "3-5", single-digit references.
    if (value < 10) continue;
    // Only judge numbers that fall in (or very near) the known band; anything wildly outside
    // isn't being used as a price level (e.g. a year, a count of contracts).
    if (value < minKnown * 0.9 || value > maxKnown * 1.1) continue;

    // Grounded iff it matches some known level within tolerance.
    const grounded = known.some((lvl) => Math.abs(lvl - value) <= tol(lvl));
    if (!grounded) {
      return { grounded: false, ungroundedValue: value };
    }
  }
  return { grounded: true, ungroundedValue: null };
}

/**
 * SPX Live Desk AI (Largo commentary) cites two number classes in one read:
 *   • SPX strikes / levels (6000+) — must be strictly grounded (same as play-gate).
 *   • Session metrics (IV rank, VIX, breadth %, point distances, confluence score) in the
 *     10–999 band — models round these and often quote decimals as whole percents (0.43 → 43).
 * Using collectKnownNumbers() alone false-positive blocks legitimate reads when the model
 * rounds VIX/IV rank or cites a pt distance that isn't stored as its own numeric leaf.
 *
 * Price levels (>= 1000): strict tolerance. Metrics (10–999): wider tolerance against the
 * augmented known set built by augmentKnownCommentaryNumbers().
 */
export function checkCommentaryGrounded(text: string, known: number[]): GroundingCheckResult {
  if (known.length === 0) return { grounded: true, ungroundedValue: null };

  const minKnown = Math.min(...known);
  const maxKnown = Math.max(...known);
  const metricTol = (n: number) => Math.max(n * 0.04, 2.5);

  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;

    const start = m.index;
    const end = start + raw.length;
    const before = text.slice(Math.max(0, start - 1), start);
    const after = text.slice(end, end + 2);

    if (after.startsWith("%")) continue;
    if (before === "$") continue;
    if (/^[%MBK]/.test(after)) continue;
    if (value < 10) continue;
    if (value < minKnown * 0.9 || value > maxKnown * 1.1) continue;

    const tol = value >= 1000 ? levelTolerance(value) : metricTol(value);
    const grounded = known.some((lvl) => Math.abs(lvl - value) <= tol);
    if (!grounded) {
      return { grounded: false, ungroundedValue: value };
    }
  }
  return { grounded: true, ungroundedValue: null };
}

/** Expand a desk-context number set with rounded forms and decimal→percent aliases. */
export function augmentKnownCommentaryNumbers(known: number[]): number[] {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    out.add(n);
    if (Math.abs(n) >= 1) {
      out.add(Math.round(n));
      out.add(parseFloat(n.toFixed(1)));
    }
    // Breadth/change fields often arrive as 0–1 decimals but the model cites whole percents.
    if (n > 0 && n <= 1) {
      out.add(parseFloat((n * 100).toFixed(1)));
      out.add(Math.round(n * 100));
    }
  };
  for (const n of known) add(n);
  return Array.from(out);
}

/**
 * Recursively collect every finite number in an arbitrary JSON-like value. For LLM surfaces
 * whose "known good" source is a whole context object handed to the prompt (as opposed to a
 * hand-picked list of specific fields, e.g. gex-heatmap/explain's knownPriceLevels), walking
 * the object directly is more robust than enumerating fields by hand — a missed field would
 * silently produce false-positive "ungrounded" flags on legitimate numbers.
 */
export function collectKnownNumbers(value: unknown, seen: Set<number> = new Set()): number[] {
  if (typeof value === "number") {
    if (Number.isFinite(value)) seen.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectKnownNumbers(item, seen);
  } else if (value != null && typeof value === "object") {
    for (const v of Object.values(value)) collectKnownNumbers(v, seen);
  }
  return Array.from(seen);
}

/**
 * Extract every bare numeric token from free text, with NO contextual filtering (unlike
 * checkNumbersGrounded's extraction, which skips %/money/small-ints when judging the
 * GENERATED text). Use this to build the "known good" set from already-formatted context
 * TEXT rather than a structured object — e.g. a dossier string built by
 * formatTickerDossierText(), where a real level can appear as "$182.50" or "6020-6030" and
 * would be invisible to collectKnownNumbers (which only walks number-typed object leaves).
 */
export function extractNumbersFromText(text: string): number[] {
  const found = new Set<number>();
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(value)) found.add(value);
  }
  return Array.from(found);
}
