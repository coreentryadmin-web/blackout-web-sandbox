import { mapClaudePlayToEdition } from "./claude-edition";
import { EDITION_MIN_PUBLISH_PLAYS, MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import type { TickerDossier } from "./dossier";
import { GROUNDING_MIN_OI } from "./grounding";
import {
  fetchEditionChains,
  type ChainStrikeRow,
  type EditionChainData,
} from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";

/** Pick the nearest affordable, liquid chain contract for a directional play. */
export function pickAffordableChainContract(
  ticker: string,
  direction: "long" | "short",
  chain: EditionChainData | undefined
): { options_play: string; entry_premium: number } | null {
  if (!chain?.rows?.length) return null;
  const side = direction === "short" ? "put" : "call";
  const spot = chain.spot > 0 ? chain.spot : 0;

  const affordable = (row: ChainStrikeRow): number | null => {
    const ask = side === "put" ? row.put_ask : row.call_ask;
    const oi = side === "put" ? row.put_oi : row.call_oi;
    if (ask == null || !Number.isFinite(ask) || ask <= 0 || ask > MAX_OPTION_PREMIUM_PER_SHARE) return null;
    if (oi < GROUNDING_MIN_OI) return null;
    return Number(ask.toFixed(2));
  };

  const candidates = [...chain.rows]
    .map((row) => ({ row, premium: affordable(row) }))
    .filter((c): c is { row: ChainStrikeRow; premium: number } => c.premium != null)
    .sort((a, b) => {
      const distA = spot > 0 ? Math.abs(a.row.strike - spot) : 0;
      const distB = spot > 0 ? Math.abs(b.row.strike - spot) : 0;
      if (distA !== distB) return distA - distB;
      return a.row.expiry.localeCompare(b.row.expiry);
    });

  const best = candidates[0];
  if (!best) return null;
  const sideLabel = side === "put" ? "Put" : "Call";
  return {
    options_play: `${ticker} $${best.row.strike} ${sideLabel} ${best.row.expiry}, entry prem ~$${best.premium.toFixed(2)}`,
    entry_premium: best.premium,
  };
}

/**
 * When critic/grounding leaves fewer than {@link EDITION_MIN_PUBLISH_PLAYS}, backfill from the
 * ranked candidate pool with chain-grounded affordable contracts (or honest levels-only cards).
 */
export async function backfillThinEditionPlays(params: {
  finalPlays: PlaybookPlay[];
  ranked: ScoredCandidate[];
  dossiers: Record<string, TickerDossier>;
  minPlays?: number;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const minPlays = params.minPlays ?? EDITION_MIN_PUBLISH_PLAYS;
  if (params.finalPlays.length >= minPlays) {
    return { plays: params.finalPlays, notes: [] };
  }

  const used = new Set(params.finalPlays.map((p) => p.ticker.toUpperCase()));
  const pool = params.ranked.filter((r) => !used.has(r.ticker.toUpperCase()));
  if (!pool.length) return { plays: params.finalPlays, notes: [] };

  const dossierList = pool
    .map((r) => params.dossiers[r.ticker.toUpperCase()])
    .filter((d): d is TickerDossier => Boolean(d));

  const chains = await fetchEditionChains({
    stockTickers: pool.map((r) => r.ticker),
    dossiers: dossierList,
  });

  const notes: string[] = [];
  const backfilled: PlaybookPlay[] = [...params.finalPlays];

  for (const scored of pool) {
    if (backfilled.length >= minPlays) break;
    const ticker = scored.ticker.toUpperCase();
    const dossier = params.dossiers[ticker];
    if (!dossier) continue;

    const contract = pickAffordableChainContract(ticker, scored.direction, chains[ticker]);
    const support = dossier.tech?.support_levels?.[0];
    const resistance = dossier.tech?.resistance_levels?.[0];
    const play = mapClaudePlayToEdition(
      {
        ticker,
        type: "stock",
        direction: scored.direction === "long" ? "LONG" : "SHORT",
        conviction: scored.conviction,
        key_signal:
          dossier.tech?.summary ??
          `Ranked-pool backfill (score ${Math.round(scored.score)}) — verify before entry.`,
        entry_range: support != null ? `Near $${support}` : "See technical levels",
        target: resistance != null ? String(resistance) : "-",
        stop: support != null ? String(support) : "-",
        options_play: contract?.options_play ?? "-",
        entry_premium: contract?.entry_premium,
        score: scored.score,
      },
      backfilled.length + 1,
      params.dossiers
    );
    backfilled.push(play);
    used.add(ticker);
    notes.push(
      `Backfill ${ticker} (score ${Math.round(scored.score)})${contract ? " — chain-grounded contract" : " — levels only"}.`
    );
  }

  if (!notes.length) return { plays: params.finalPlays, notes: [] };

  const reranked = backfilled.map((p, i) => ({ ...p, rank: i + 1 }));
  return {
    plays: reranked,
    notes: [
      `Thin edition backfill: added ${notes.length} ranked-pool play(s) to reach minimum ${minPlays}.`,
      ...notes,
    ],
  };
}
