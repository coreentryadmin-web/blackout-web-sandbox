import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import { fetchTickerDossier } from "./dossier";
import { formatTickerDossierText } from "./format";
import type { PlaybookPlay } from "./types";

const SYSTEM = `You are Night Hawk — the evening playbook analyst for BlackOut Trading. A member clicked a ranked play and wants a thorough institutional-grade briefing on WHY it made tonight's top 5.

Rules:
- Use ONLY facts from the data block. Do not invent flow prints, levels, premiums, or catalysts.
- Be detailed and structured — this should read like a desk note, not a tweet.
- Use plain text with **Bold section headers** on their own line (no markdown tables or # headings).
- Cover every dimension present in the data; if a dimension is missing, say it was not in tonight's scan.
- End with **Bottom line:** — one paragraph on conviction and what would invalidate the setup tomorrow.

Required sections (include all that apply):
**Why ranked #N**
**Market & sector context**
**Options flow & strike activity**
**Positioning / GEX / max pain**
**Technicals & key levels**
**News & catalysts**
**The contract & premium**
**Entry · target · stop logic**
**Risks & invalidation**
**Bottom line:**`;

function formatMarketRecapBlock(recap: Record<string, unknown> | null | undefined): string {
  if (!recap) return "Market recap not available.";
  const lines: string[] = [];
  for (const key of [
    "tide",
    "spx_vix",
    "sector_strength",
    "sector_weakness",
    "catalysts",
  ] as const) {
    const v = recap[key];
    if (typeof v === "string" && v.trim()) lines.push(`${key}: ${v}`);
  }
  if (recap.vix_iv_rank != null) lines.push(`VIX IV rank: ${recap.vix_iv_rank}`);
  if (Array.isArray(recap.vix_term) && recap.vix_term.length) {
    lines.push(`VIX term: ${JSON.stringify(recap.vix_term).slice(0, 400)}`);
  }
  if (Array.isArray(recap.top_net_impact) && recap.top_net_impact.length) {
    lines.push(
      `Top net impact: ${recap.top_net_impact
        .slice(0, 8)
        .map((r) => String((r as Record<string, unknown>).ticker ?? ""))
        .filter(Boolean)
        .join(", ")}`
    );
  }
  return lines.join("\n") || "Market recap sparse.";
}

function formatPlayBlock(play: PlaybookPlay): string {
  return [
    `Rank: #${play.rank}`,
    `Ticker: ${play.ticker}`,
    `Direction: ${play.direction}`,
    `Conviction: ${play.conviction}`,
    `Play type: ${play.play_type}`,
    `Score: ${play.score}`,
    play.flow_streak_days != null ? `Flow streak: ${play.flow_streak_days}d` : null,
    play.iv_rank != null ? `IV rank: ${play.iv_rank}` : null,
    play.entry_premium != null ? `Entry premium: $${play.entry_premium}/share` : null,
    play.entry_cost_per_contract != null
      ? `Cost per 1-lot: $${play.entry_cost_per_contract}`
      : null,
    `Thesis: ${play.thesis || "—"}`,
    `Key signal: ${play.key_signal || "—"}`,
    `Entry: ${play.entry_range}`,
    `Target: ${play.target}`,
    `Stop: ${play.stop}`,
    `Contract: ${play.options_play}`,
    play.risk_note ? `Risk note: ${play.risk_note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function resolveDossierContext(
  ticker: string,
  stored?: string
): Promise<string> {
  if (stored?.trim()) return stored;
  try {
    const dossier = await fetchTickerDossier(ticker);
    const scored = dossier.scored ?? {
      ticker: dossier.ticker,
      score: 0,
      conviction: "B" as const,
      direction: "long" as const,
      flow_score: 0,
      tech_score: 0,
      pos_score: 0,
      news_score: 0,
      smart_money_score: 0,
    };
    return formatTickerDossierText(dossier, scored);
  } catch {
    return "Dossier unavailable — explain from play card and market recap only.";
  }
}

export async function generatePlayExplanation(params: {
  play: PlaybookPlay;
  editionFor: string;
  recapHeadline?: string | null;
  recapSummary?: string | null;
  marketRecap?: Record<string, unknown> | null;
  dossierContext: string;
}): Promise<string | null> {
  if (!anthropicConfigured()) {
    return [
      `**Why ranked #${params.play.rank}**`,
      params.play.thesis || params.play.key_signal || "No thesis on file.",
      "",
      "**The contract**",
      params.play.options_play,
      "",
      "**Levels**",
      `Entry: ${params.play.entry_range}`,
      `Target: ${params.play.target}`,
      `Stop: ${params.play.stop}`,
      "",
      "**Bottom line:**",
      "Claude is not configured — this is the playbook card only. Set ANTHROPIC_API_KEY for full Hawk Intel briefings.",
    ].join("\n");
  }

  const prompt = `Edition for session: ${params.editionFor}
${params.recapHeadline ? `Headline: ${params.recapHeadline}` : ""}
${params.recapSummary ? `Session summary: ${params.recapSummary}` : ""}

=== MARKET RECAP ===
${formatMarketRecapBlock(params.marketRecap)}

=== PLAYBOOK CARD ===
${formatPlayBlock(params.play)}

=== TICKER DOSSIER (evening scan) ===
${params.dossierContext}

Write the full detailed briefing for ${params.play.ticker} ranked #${params.play.rank}.`;

  return anthropicText(prompt, 3200, SYSTEM, { timeoutMs: 60_000, maxRetries: 1 });
}
