import {
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
} from "./constants";
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
