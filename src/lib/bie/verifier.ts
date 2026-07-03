// BLACKOUT Intelligence Engine — Layer 4 numeric claim verifier (pure).
// Every figure an LLM answer contains must be traceable to data the platform
// actually served that turn (live feed + tool results). Numbers that can't be
// traced are flagged — the answer states uncertainty instead of wearing fake
// precision. Deterministic and unit-tested; no model judges another model here.

export type ClaimVerification = {
  total: number;
  verified: number;
  unverified: number[];
  /** verified / total (1 when the answer makes no numeric claims). */
  coverage: number;
};

/** Numbers an answer "claims": decimals, percents, $-amounts, 3+ digit ints.
 *  Small bare integers (list counts, "3 lines"), years, and times are not claims. */
export function extractNumericClaims(text: string): number[] {
  const out: number[] = [];
  // Strip markdown emphasis + commas inside numbers for cleaner matching.
  const cleaned = text.replace(/[*_`]/g, "").replace(/(\d),(\d{3})\b/g, "$1$2");
  const re = /\$?\s?(-?\d+(?:\.\d+)?)\s?%?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1]!;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const hasDecimal = raw.includes(".");
    const abs = Math.abs(n);
    const isDollar = cleaned[m.index] === "$" || cleaned.slice(Math.max(0, m.index - 1), m.index) === "$";
    const isPct = cleaned.slice(m.index + m[0].length - 1, m.index + m[0].length) === "%" || m[0].trimEnd().endsWith("%");
    // Years and clock-like values are prose, not claims.
    if (!hasDecimal && abs >= 1900 && abs <= 2100) continue;
    // Bare small integers without $/% context are counts ("3 plays"), not claims.
    if (!hasDecimal && !isDollar && !isPct && abs <= 31) continue;
    out.push(n);
  }
  return out;
}

/** Collect every numeric value reachable in the turn's source data (tool results,
 *  live-feed objects, payloads) — the ground truth an answer may cite. */
export function collectContextNumbers(source: unknown, out: number[] = [], depth = 0): number[] {
  if (depth > 8 || source == null) return out;
  if (typeof source === "number") {
    if (Number.isFinite(source)) out.push(source);
    return out;
  }
  if (typeof source === "string") {
    // Strings inside tool results often carry formatted numbers ("7,502.5", "$4.20").
    for (const n of extractAllNumbers(source)) out.push(n);
    return out;
  }
  if (Array.isArray(source)) {
    for (const v of source.slice(0, 200)) collectContextNumbers(v, out, depth + 1);
    return out;
  }
  if (typeof source === "object") {
    for (const v of Object.values(source as Record<string, unknown>)) collectContextNumbers(v, out, depth + 1);
  }
  return out;
}

function extractAllNumbers(text: string): number[] {
  const out: number[] = [];
  const cleaned = text.replace(/(\d),(\d{3})\b/g, "$1$2");
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** A claim is verified when a source number matches within 0.5% (or 0.02 absolute
 *  for small values) — tolerant of rounding, intolerant of invention. Derived
 *  values the desk itself teaches (percent deltas, x2/x0.5 of a source value)
 *  also count, so "target $8.40" verifies against a $4.20 entry. */
export function verifyClaims(answerText: string, contextNumbers: number[]): ClaimVerification {
  const claims = extractNumericClaims(answerText);
  if (claims.length === 0) return { total: 0, verified: 0, unverified: [], coverage: 1 };

  const ctx = contextNumbers.filter((n) => Number.isFinite(n));
  const matches = (claim: number): boolean =>
    ctx.some((src) => {
      const candidates = [src, src * 2, src * 0.5, -src, src * 100, src / 100];
      return candidates.some((c) => {
        const tol = Math.max(Math.abs(c) * 0.005, 0.02);
        return Math.abs(claim - c) <= tol;
      });
    });

  const unverified: number[] = [];
  let verified = 0;
  for (const claim of claims) {
    if (matches(claim)) verified += 1;
    else unverified.push(claim);
  }
  return {
    total: claims.length,
    verified,
    unverified: unverified.slice(0, 10),
    coverage: Math.round((verified / claims.length) * 100) / 100,
  };
}
