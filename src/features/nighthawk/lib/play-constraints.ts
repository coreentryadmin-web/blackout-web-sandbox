import {
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
} from "./constants";
import { entryRangeMid } from "./entry-range";
import { parsePlayLevels } from "./play-levels";
import type { PlaybookPlay } from "./types";

export type ClaudePlayRaw = {
  ticker?: string;
  type?: string;
  direction?: string;
  conviction?: string;
  bias?: string;
  entry_condition?: string;
  entry_range?: string;
  target?: string;
  target_note?: string;
  stop?: string;
  stop_note?: string;
  risk_reward?: string;
  options_play?: string;
  entry_premium?: number | string;
  key_signal?: string;
  risk_note?: string;
  score?: number;
};

/** Parse a per-share premium from Claude output or contract string. */
export function parseEntryPremiumPerShare(
  play: Pick<ClaudePlayRaw, "entry_premium" | "options_play">
): number | null {
  const direct = Number(play.entry_premium);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const text = String(play.options_play ?? "");
  if (!text) return null;

  // ~$4.20 prem, entry prem ~$8, @$12.50, premium $3.15
  const patterns = [
    /(?:entry\s*)?prem(?:ium)?\s*[~@]?\s*\$?\s*(\d+(?:\.\d+)?)/i,
    /@\s*\$?\s*(\d+(?:\.\d+)?)/,
    /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|\s*per|\s*prem)/i,
    /~\s*\$?\s*(\d+(?:\.\d+)?)/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }

  return null;
}

export function entryPremiumWithinCap(premiumPerShare: number | null): boolean {
  // null means the premium is unknown — treat as passing (no cap applies without data).
  if (premiumPerShare == null) return true;
  return premiumPerShare <= MAX_OPTION_PREMIUM_PER_SHARE;
}

export function formatPremiumCapLabel(premiumPerShare: number | null): string | null {
  if (premiumPerShare == null) return null;
  const cost = Math.round(premiumPerShare * 100);
  return `~$${premiumPerShare.toFixed(2)} prem · $${cost.toLocaleString()}/lot`;
}

export function applyPremiumCapToPlay(play: PlaybookPlay, raw: ClaudePlayRaw): PlaybookPlay {
  const premium = parseEntryPremiumPerShare(raw);
  const withinCap = entryPremiumWithinCap(premium);

  return {
    ...play,
    entry_premium: premium ?? undefined,
    entry_cost_per_contract:
      premium != null ? Math.round(premium * 100) : undefined,
    // When premium is unknown (null), we cannot enforce the cap — treat as passing.
    premium_cap_ok: withinCap,
    risk_note:
      !withinCap && premium != null
        ? `Premium cap exceeded (>$${MAX_OPTION_PREMIUM_PER_SHARE}/share · >$${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()}/lot). ${play.risk_note ?? ""}`.trim()
        : play.risk_note || undefined,
  };
}

export function filterPlaysWithinPremiumCap(plays: PlaybookPlay[]): {
  plays: PlaybookPlay[];
  rejected: PlaybookPlay[];
} {
  const ok: PlaybookPlay[] = [];
  const rejected: PlaybookPlay[] = [];
  for (const p of plays) {
    // Only reject when the cap is explicitly exceeded (premium known and > cap).
    // null entry_premium means unknown — pass through rather than silently drop affordable plays.
    if (p.premium_cap_ok === false) {
      rejected.push(p);
    } else {
      ok.push(p);
    }
  }
  return { plays: ok, rejected };
}

export type PlayGeometryVerdict = {
  ok: boolean;
  /** Hard failures — the play must not publish (untradeable/self-contradicting risk plan). */
  drops: string[];
  /** Soft notes — kept, but logged (e.g. conditional prose entry with no numeric range). */
  flags: string[];
};

/**
 * Deterministic trade-geometry validation of the levels members act on (audit HIGH:
 * entry/target/stop reached members with no numeric check anywhere in the publish
 * path — target and stop on the SAME side of entry would publish, and the corrupt
 * entry-range class was only caught retrospectively by the track-record math).
 *
 * Uses the SAME parser the outcome grader uses (parsePlayLevels), so what we validate
 * here is exactly what resolveOutcome will grade against — one source of truth.
 *
 * Direction convention mirrors play-outcomes.ts: anything containing "SHORT" is a
 * short; everything else grades long.
 */
export function validatePlayGeometry(play: PlaybookPlay): PlayGeometryVerdict {
  const drops: string[] = [];
  const flags: string[] = [];
  const { entry_range_low: lo, entry_range_high: hi, target, stop } = parsePlayLevels(play);

  // Target/stop must parse — a play whose risk plan cannot be read cannot be traded
  // (and the grader would mark it unresolvable anyway).
  if (target == null) drops.push("target has no parseable price");
  if (stop == null) drops.push("stop has no parseable price");

  let mid: number | null = null;
  if (lo == null || hi == null) {
    // Conditional prose entry ("Break above X | ...") with no numeric band — keep,
    // but note it; the grader will fall back the same way.
    flags.push("entry range has no parseable numeric band");
  } else {
    mid = entryRangeMid(lo, hi);
    if (mid == null) {
      // entryRangeMid rejects non-positive bounds and width > 20% of the average —
      // the exact corrupt-range class (e.g. "$17–$452") PR #207 could only null out
      // AFTER publication. Now it never publishes.
      drops.push(`entry range ${lo}-${hi} corrupt (non-positive bound or width > 20% of mid)`);
    }
  }

  if (mid != null && target != null && stop != null) {
    const isShort = String(play.direction ?? "LONG").toUpperCase().includes("SHORT");
    if (isShort) {
      if (target >= mid) drops.push(`SHORT target ${target} is not below entry mid ${mid.toFixed(2)}`);
      if (stop <= mid) drops.push(`SHORT stop ${stop} is not above entry mid ${mid.toFixed(2)}`);
    } else {
      if (target <= mid) drops.push(`LONG target ${target} is not above entry mid ${mid.toFixed(2)}`);
      if (stop >= mid) drops.push(`LONG stop ${stop} is not below entry mid ${mid.toFixed(2)}`);
    }
  }

  return { ok: drops.length === 0, drops, flags };
}

/** Split plays by the publish-time geometry gate — used as a final write-side guard. */
export function partitionPlaysByGeometry(plays: PlaybookPlay[]): {
  passing: PlaybookPlay[];
  failing: Array<{ play: PlaybookPlay; drops: string[] }>;
} {
  const passing: PlaybookPlay[] = [];
  const failing: Array<{ play: PlaybookPlay; drops: string[] }> = [];
  for (const play of plays) {
    const verdict = validatePlayGeometry(play);
    if (verdict.ok) passing.push(play);
    else failing.push({ play, drops: verdict.drops });
  }
  return { passing, failing };
}

// ── Ticker-family dedup (PR-N14: GOOGL/GOOG, BRK.A/BRK.B are the same company) ─────

const TICKER_FAMILY_MAP: Record<string, string> = {
  GOOG: "GOOGL",
  "BRK.B": "BRK.A",
  "BRK/B": "BRK.A",
  BRKB: "BRK.A",
  FOX: "FOXA",
  LBRDK: "LBRDA",
  DISCK: "DISCA",
  NWSA: "NWS",
};

export function canonicalTicker(ticker: string): string {
  const t = ticker.toUpperCase();
  return TICKER_FAMILY_MAP[t] ?? t;
}

export function deduplicateTickerFamilies<T extends { ticker: string }>(
  items: T[]
): { kept: T[]; dropped: Array<{ item: T; canonical: string; kept_ticker: string }> } {
  const seen = new Map<string, string>();
  const kept: T[] = [];
  const dropped: Array<{ item: T; canonical: string; kept_ticker: string }> = [];
  for (const item of items) {
    const canon = canonicalTicker(item.ticker);
    const existing = seen.get(canon);
    if (existing) {
      dropped.push({ item, canonical: canon, kept_ticker: existing });
    } else {
      seen.set(canon, item.ticker.toUpperCase());
      kept.push(item);
    }
  }
  return { kept, dropped };
}

/** Default same-sector cap applied by {@link capSectorConcentration} (task #141: named so
 *  the durable rejection-audit row can cite the exact threshold that fired, instead of a
 *  bare literal duplicated at the call site). Value unchanged (was an inline `2` default). */
export const SECTOR_CONCENTRATION_MAX_PER_SECTOR = 2;

/**
 * Cap same-sector concentration in the final selection (audit MEDIUM: nothing stopped
 * five correlated semis longs from filling the whole book). Keeps ranked order; a play
 * beyond the cap is dropped and a lower-ranked play from another sector backfills via
 * the caller's overshoot buffer. Plays with no known sector are exempt (null ≠ a
 * sector; treating unknowns as one bucket would randomly cap them).
 */
export function capSectorConcentration(
  plays: PlaybookPlay[],
  sectorByTicker: Record<string, string | null | undefined>,
  maxPerSector = SECTOR_CONCENTRATION_MAX_PER_SECTOR
): {
  plays: PlaybookPlay[];
  // task #141: `filled` (the sector's count AT drop time) and the full `play` are NEW
  // fields alongside the pre-existing `ticker`/`sector` — additive only — so the durable
  // rejection-audit row (alert_audit_log) can answer "how many other tickers already
  // filled this sector" and carry the full play snapshot without the caller re-deriving
  // either from `plays`. Rejection LOGIC/threshold is byte-for-byte unchanged.
  dropped: Array<{ ticker: string; sector: string; filled: number; play: PlaybookPlay }>;
} {
  const counts = new Map<string, number>();
  const kept: PlaybookPlay[] = [];
  const dropped: Array<{ ticker: string; sector: string; filled: number; play: PlaybookPlay }> = [];
  for (const p of plays) {
    const sector = (sectorByTicker[p.ticker.toUpperCase()] ?? "").trim().toLowerCase();
    if (!sector) {
      kept.push(p);
      continue;
    }
    const n = counts.get(sector) ?? 0;
    if (n >= maxPerSector) {
      dropped.push({ ticker: p.ticker, sector, filled: n, play: p });
      continue;
    }
    counts.set(sector, n + 1);
    kept.push(p);
  }
  return { plays: kept, dropped };
}
