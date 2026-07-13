// BIE compound-question DECOMPOSITION — the "15 questions in one ask" splitter (task #57).
//
// Pure + side-effect-free so it's exhaustively unit-testable. Its ONE job: split a member message
// into distinct sub-questions WHEN it is confidently compound, and otherwise return the message
// unchanged as a single element. The single-question no-regression guarantee is the whole point —
// composeCompound only engages when this returns ≥2, so a normal question must NEVER be split.
//
// Three confident detectors, in priority order:
//   1. NUMBERED list — "(1) … (2) …", "1) …", "1. …" (≥2 markers). The most explicit signal.
//   2. MULTIPLE question marks — "GEX? VEX? NVDA flip?" (≥2 "?"-terminated clauses). A terse barrage.
//   3. RUN-ON — comma / ";" / "and" clauses, but ONLY for a long message (>100 chars) with ≥3
//      clauses, so a short single question ("compare SPY and QQQ") is never over-split.
// Anything not matching a detector returns [message] — a single question, handled unchanged.

/** Hard cap on sub-questions so a pathological input can't fan out unboundedly. */
export const MAX_SUB_QUESTIONS = 20;

function clean(s: string): string {
  return s.trim().replace(/^[\s;,.:—-]+/, "").replace(/[\s;,]+$/, "").trim();
}

/** (1)…(2)… / 1)…2)… / 1.…2.… — returns the text after each marker, or [] when <2 markers. */
function splitNumbered(q: string): string[] {
  const markerRe = /(?:\(\d{1,2}\)|\b\d{1,2}\)|\b\d{1,2}\.)\s+/g;
  const markers = [...q.matchAll(markerRe)];
  if (markers.length < 2) return [];
  const parts: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index! + markers[i]![0].length;
    const end = i + 1 < markers.length ? markers[i + 1]!.index! : q.length;
    const text = clean(q.slice(start, end));
    if (text.length >= 3) parts.push(text);
  }
  return parts;
}

/** "A? B? C?" — split on "?" when the message carries ≥2 of them. */
function splitByQuestionMarks(q: string): string[] {
  if ((q.match(/\?/g) ?? []).length < 2) return [];
  return q
    .split("?")
    .map((s) => clean(s))
    .filter((s) => s.length >= 2);
}

/** Long run-on: comma / ";" / "and" clauses. Conservative — long message + ≥3 clauses only. */
function splitRunOn(q: string): string[] {
  if (q.length < 100) return [];
  const parts = q
    .split(/;|,|\band\b/i)
    .map((s) => clean(s))
    .filter((s) => s.length >= 8);
  return parts.length >= 3 ? parts : [];
}

/**
 * Split a member message into sub-questions. Returns ≥2 ONLY when confidently compound; otherwise
 * `[message]` (a single question — the caller then falls through to the normal single-intent path
 * with zero behavior change). Capped at MAX_SUB_QUESTIONS.
 */
export function splitCompoundQuestion(question: string): string[] {
  const q = (question ?? "").trim();
  if (!q) return [];

  const numbered = splitNumbered(q);
  if (numbered.length >= 2) return numbered.slice(0, MAX_SUB_QUESTIONS);

  const byQ = splitByQuestionMarks(q);
  if (byQ.length >= 2) return byQ.slice(0, MAX_SUB_QUESTIONS);

  const runOn = splitRunOn(q);
  if (runOn.length >= 3) return runOn.slice(0, MAX_SUB_QUESTIONS);

  return [q];
}

/** True when the message is confidently compound (≥2 sub-questions). */
export function isCompoundQuestion(question: string): boolean {
  return splitCompoundQuestion(question).length >= 2;
}

// ── Synthesis (pure, testable) ─────────────────────────────────────────────

export type CompoundPart = {
  index: number;
  /** Short label for the sub-question (first ~72 chars). */
  label: string;
  /** True when a grounded answer came back; false = honestly unavailable. */
  ok: boolean;
  /** The grounded sub-answer, or the honest "unavailable — <reason>" note. */
  text: string;
  intent: string | null;
  ms: number;
};

/** A compact label for a sub-question — the first line, trimmed to ~72 chars. */
export function labelForSubQuestion(subQ: string): string {
  const one = subQ.replace(/\s+/g, " ").trim();
  return one.length > 72 ? `${one.slice(0, 69)}…` : one;
}

/**
 * Synthesize the ONE structured answer from all parts (after every friend reports). Each part is
 * labeled "**N) <label>:**" and carries EITHER its grounded answer OR its honest "unavailable"
 * note — never fabricated, never silently dropped. Pure so the formatting is unit-tested directly.
 */
export function synthesizeCompoundAnswer(parts: CompoundPart[]): string {
  const answered = parts.filter((p) => p.ok).length;
  const header = `Answering ${parts.length} parts (${answered} with live data${
    answered < parts.length ? `, ${parts.length - answered} unavailable` : ""
  }):`;
  const blocks = parts.map((p) => {
    const head = `**${p.index}) ${p.label}:**`;
    return p.ok ? `${head}\n${p.text}` : `${head} ${p.text}`;
  });
  return [header, "", ...blocks].join("\n\n");
}
