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

/** Desk chip copy — e.g. `7400C @ 5.2` */
export function formatPremiumAt(premium: string | null | undefined): string | null {
  if (!premium?.trim() || premium.trim() === "—") return null;
  const s = premium.trim().replace(/^~?\$/, "");
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return ((a + b) / 2).toFixed(1);
  }
  const single = s.match(/(\d+(?:\.\d+)?)/);
  if (single) return Number(single[1]).toFixed(1);
  return null;
}

export function formatSpxContractChipLabel(
  raw: string | null | undefined,
  fallback?: { strike: number; direction?: string | null },
  premium?: string | null
): string {
  const parsed = raw ? parseSpxContractLabel(raw) : null;
  let compact: string | null = null;
  if (parsed) {
    compact = `${parsed.strike}${parsed.side === "call" ? "C" : "P"}`;
  } else if (fallback && validStrike(Math.round(fallback.strike))) {
    compact = `${Math.round(fallback.strike)}${fallback.direction === "short" ? "P" : "C"}`;
  }

  const prem = formatPremiumAt(premium);
  if (compact && prem) return `${compact} @ ${prem}`;
  if (compact) return compact;
  return formatSpxContractLabel(raw, fallback);
}
