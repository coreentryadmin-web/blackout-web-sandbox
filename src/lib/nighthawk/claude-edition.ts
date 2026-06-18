import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { TickerDossier } from "./dossier";
import { buildClaudePrompt, buildMarketRecap } from "./format";
import type { IndexDossier } from "./index-dossier";
import type { MarketWideContext } from "./market-wide";
import {
  applyPremiumCapToPlay,
  filterPlaysWithinPremiumCap,
  type ClaudePlayRaw,
} from "./play-constraints";
import {
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
  PLAYBOOK_PREMIUM_CAP_LINE,
} from "./constants";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";

const SYSTEM = `You are an elite options strategist. Output ONLY a valid JSON array. No markdown fences. Every number and level must come from the prompt data.

HARD RULE — AFFORDABLE CONTRACTS:
${PLAYBOOK_PREMIUM_CAP_LINE}
Every play MUST include entry_premium (per-share, ≤ ${MAX_OPTION_PREMIUM_PER_SHARE}) and options_play with "entry prem ~$X.XX". Never recommend contracts above $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot.`;
function parsePlaysJson(raw: string): ClaudePlayRaw[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as ClaudePlayRaw[];
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ClaudePlayRaw[];
  } catch {
    return [];
  }
}

export function mapClaudePlayToEdition(play: ClaudePlayRaw, rank: number, dossiers: Record<string, TickerDossier>): PlaybookPlay {
  const ticker = String(play.ticker ?? "?").toUpperCase();
  const dossier = dossiers[ticker];
  const playType = String(play.type ?? "stock").toLowerCase();
  const base: PlaybookPlay = {
    rank,
    ticker,
    direction: String(play.direction ?? "LONG"),
    conviction: String(play.conviction ?? "B"),
    play_type: playType === "index" ? "index" : playType === "etf" ? "etf" : "stock",
    thesis: String(play.key_signal ?? play.bias ?? ""),
    key_signal: String(play.key_signal ?? ""),
    entry_range: [play.entry_condition, play.entry_range].filter(Boolean).join(" · ") || "—",
    target: [play.target, play.target_note].filter(Boolean).join(" — ") || "—",
    stop: [play.stop, play.stop_note].filter(Boolean).join(" — ") || "—",
    options_play: String(play.options_play ?? "—"),
    risk_note: String(play.risk_note ?? ""),
    score: Number(play.score ?? dossier?.scored?.score ?? 0),
    flow_streak_days: dossier?.flow_streak.streak_days || undefined,
    iv_rank: dossier?.iv_rank ?? undefined,
  };
  return applyPremiumCapToPlay(base, play);
}
export async function generateEditionPlays(params: {
  ctx: MarketWideContext;
  dossiers: TickerDossier[];
  ranked: ScoredCandidate[];
  indexDossiers?: IndexDossier[];
}): Promise<{ plays: PlaybookPlay[]; recap: ReturnType<typeof buildMarketRecap>; raw: string | null }> {
  const recap = buildMarketRecap(params.ctx);
  const dossierMap = Object.fromEntries(params.dossiers.map((d) => [d.ticker, d]));

  if (!anthropicConfigured()) {
    const fallback = params.ranked.slice(0, 5).map((s, i) =>
      mapClaudePlayToEdition(
        {
          ticker: s.ticker,
          type: "stock",
          direction: s.direction === "long" ? "LONG" : "SHORT",
          conviction: s.conviction,
          key_signal: dossierMap[s.ticker]?.tech?.summary ?? "Mechanical fallback — Claude unavailable.",
          entry_range: "See technical levels",
          target: dossierMap[s.ticker]?.tech?.resistance_levels?.[0]?.toString() ?? "—",
          stop: dossierMap[s.ticker]?.tech?.support_levels?.[0]?.toString() ?? "—",
          options_play: "—",
          score: s.score,
        },
        i + 1,
        dossierMap
      )
    );
    return { plays: fallback, recap, raw: null };
  }

  const prompt = buildClaudePrompt({
    ctx: params.ctx,
    recap,
    dossiers: params.dossiers,
    ranked: params.ranked,
    indexDossiers: params.indexDossiers,
  });

  const raw = await anthropicText(prompt, 4500, SYSTEM);
  if (!raw) {
    return { plays: [], recap, raw: null };
  }

  const parsed = parsePlaysJson(raw).slice(0, 8);
  const mapped = parsed.map((p, i) => mapClaudePlayToEdition(p, i + 1, dossierMap));
  const { plays, rejected } = filterPlaysWithinPremiumCap(mapped);
  const capped = plays.slice(0, 5).map((p, i) => ({ ...p, rank: i + 1 }));

  if (rejected.length) {
    console.warn(
      "[nighthawk/edition] premium cap rejected:",
      rejected.map((p) => `${p.ticker} $${p.entry_premium ?? "?"}/sh`)
    );
  }

  return { plays: capped, recap, raw };
}