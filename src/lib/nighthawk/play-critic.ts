import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import { mapClaudePlayToEdition } from "./claude-edition";
import type { TickerDossier } from "./dossier";
import { buildMarketRecap, formatTickerDossierText } from "./format";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";

const SYSTEM = `You are a skeptical options risk manager reviewing a playbook before publication. Output ONLY a valid JSON array. No markdown fences.

For each play in the input list, output one object:
{ "rank": <original rank>, "verdict": "keep"|"downgrade"|"cut", "reason": "<brief reason>", "corrected_conviction": "A+"|"A"|"B"|"C" }

Verify each play for:
- Flow direction matches thesis and play direction
- Entry/target/stop use real levels from dossier data (not fabricated)
- No contradiction with risk reversal skew
- At least 2 confirming signals from dossier
- Alignment with current market regime (tide, VIX IV rank)

Be skeptical. Cut weak or contradictory plays. Downgrade inflated conviction.`;

type CriticVerdict = {
  rank: number;
  verdict: "keep" | "downgrade" | "cut";
  reason: string;
  corrected_conviction: string;
};

function parseCriticJson(raw: string): CriticVerdict[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as CriticVerdict[];
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as CriticVerdict[];
  } catch {
    return [];
  }
}

function mechanicalReplacement(
  candidate: ScoredCandidate,
  dossier: TickerDossier | undefined,
  rank: number,
  dossierMap: Record<string, TickerDossier>
): PlaybookPlay {
  return mapClaudePlayToEdition(
    {
      ticker: candidate.ticker,
      type: "stock",
      direction: candidate.direction === "long" ? "LONG" : "SHORT",
      conviction: candidate.conviction,
      key_signal: dossier?.tech?.summary ?? "Critic replacement — promoted from ranked pool.",
      entry_range: "See technical levels",
      target: dossier?.tech?.resistance_levels?.[0]?.toString() ?? "—",
      stop: dossier?.tech?.support_levels?.[0]?.toString() ?? "—",
      options_play: "—",
      score: candidate.score,
    },
    rank,
    dossierMap
  );
}

function scoredForPlay(
  play: PlaybookPlay,
  dossiers: Record<string, TickerDossier>,
  ranked: ScoredCandidate[]
): ScoredCandidate | undefined {
  const fromRanked = ranked.find((r) => r.ticker.toUpperCase() === play.ticker.toUpperCase());
  if (fromRanked) return fromRanked;
  const dossier = dossiers[play.ticker.toUpperCase()];
  return dossier?.scored;
}

export async function critiquePlays(params: {
  plays: PlaybookPlay[];
  dossiers: Record<string, TickerDossier>;
  ranked: ScoredCandidate[];
  ctx: MarketWideContext;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const { plays, dossiers, ranked, ctx } = params;
  if (!anthropicConfigured() || !plays.length) {
    return { plays, notes: [] };
  }

  const recap = buildMarketRecap(ctx);
  const promptParts: string[] = [
    "MARKET REGIME",
    recap.summary,
    `Tide: ${recap.tide}`,
    `VIX IV rank: ${ctx.vix_iv_rank ?? "unknown"}`,
    "",
    "PLAYS TO REVIEW",
  ];

  for (const play of plays) {
    const scored = scoredForPlay(play, dossiers, ranked);
    const dossier = dossiers[play.ticker.toUpperCase()];
    promptParts.push(`--- Play #${play.rank}: ${play.ticker} ${play.direction} (${play.conviction}) ---`);
    promptParts.push(`Thesis: ${play.thesis || play.key_signal}`);
    promptParts.push(`Entry: ${play.entry_range}`);
    promptParts.push(`Target: ${play.target}`);
    promptParts.push(`Stop: ${play.stop}`);
    promptParts.push(`Options: ${play.options_play}`);
    if (dossier && scored) {
      promptParts.push("");
      promptParts.push(formatTickerDossierText(dossier, scored));
    }
    promptParts.push("");
  }

  const raw = await anthropicText(promptParts.join("\n"), 3000, SYSTEM);
  if (!raw) {
    return { plays, notes: [] };
  }

  const verdicts = parseCriticJson(raw);
  if (!verdicts.length) {
    return { plays, notes: [] };
  }

  const notes: string[] = [];
  const verdictByRank = new Map(verdicts.map((v) => [Number(v.rank), v]));
  const surviving: PlaybookPlay[] = [];
  const usedTickers = new Set<string>();

  for (const play of plays) {
    const verdict = verdictByRank.get(play.rank);
    if (!verdict) {
      surviving.push(play);
      usedTickers.add(play.ticker.toUpperCase());
      continue;
    }

    notes.push(`#${play.rank} ${play.ticker}: ${verdict.verdict} — ${verdict.reason}`);

    if (verdict.verdict === "cut") {
      continue;
    }

    if (verdict.verdict === "downgrade") {
      surviving.push({
        ...play,
        conviction: verdict.corrected_conviction || play.conviction,
      });
    } else {
      surviving.push(play);
    }
    usedTickers.add(play.ticker.toUpperCase());
  }

  const targetCount = plays.length;
  while (surviving.length < targetCount) {
    const next = ranked.find((r) => !usedTickers.has(r.ticker.toUpperCase()));
    if (!next) break;
    usedTickers.add(next.ticker.toUpperCase());
    const replacement = mechanicalReplacement(
      next,
      dossiers[next.ticker.toUpperCase()],
      surviving.length + 1,
      dossiers
    );
    surviving.push(replacement);
    notes.push(`Promoted ${next.ticker} as replacement (rank ${surviving.length})`);
  }

  const reranked = surviving.map((p, i) => ({ ...p, rank: i + 1 }));
  return { plays: reranked, notes };
}
