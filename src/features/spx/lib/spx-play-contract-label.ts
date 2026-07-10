/** Human-readable SPX 0DTE contract labels for desk Open/Watch/Closed chips. */

export type ParsedSpxContract = { strike: number; side: "call" | "put" };

const STRIKE_MIN = 1000;
const STRIKE_MAX = 99_999;

function validStrike(n: number): boolean {
  return Number.isFinite(n) && n >= STRIKE_MIN && n <= STRIKE_MAX;
}

/**
 * Parse compact or OCC-style SPXW labels without confusing the expiry date for strike.
 * Examples: `7550C`, `SPXW 260710 C6071`, `SPXW 260710C6071`, `7450 Put`
 */
export function parseSpxContractLabel(raw: string): ParsedSpxContract | null {
  const s = raw.trim();
  if (!s) return null;

  const occTail = s.match(/([CP])\s*(\d{4,5})\s*$/i);
  if (occTail) {
    const strike = Number(occTail[2]);
    if (validStrike(strike)) {
      return { strike, side: occTail[1]!.toUpperCase() === "C" ? "call" : "put" };
    }
  }

  const compact = s.match(/(\d{4,5})\s*([CP])\b/i);
  if (compact) {
    const strike = Number(compact[1]);
    if (validStrike(strike)) {
      return { strike, side: compact[2]!.toUpperCase() === "C" ? "call" : "put" };
    }
  }

  const words = s.match(/(\d{4,5})\s*(Call|Put)\b/i);
  if (words) {
    const strike = Number(words[1]);
    if (validStrike(strike)) {
      return { strike, side: words[2]!.toLowerCase() === "call" ? "call" : "put" };
    }
  }

  return null;
}

export function formatSpxContractLabel(
  raw: string | null | undefined,
  fallback?: { strike: number; direction?: string | null }
): string {
  if (raw) {
    const parsed = parseSpxContractLabel(raw);
    if (parsed) {
      return `${parsed.strike} ${parsed.side === "call" ? "Call" : "Put"}`;
    }
  }

  if (fallback && validStrike(Math.round(fallback.strike))) {
    const strike = Math.round(fallback.strike);
    const side = fallback.direction === "short" ? "Put" : "Call";
    return `${strike} ${side}`;
  }

  return raw?.trim() || "—";
}
