/**
 * DETERMINISTIC NIGHT HAWK EDITION SYNTHESIS (Phase 3 rebuild — no Claude LLM).
 *
 * generateEditionPlays() is the edition builder's synthesis entry point. It was originally
 * a Claude LLM call with a deterministic fallback. Phase 3 removes the LLM entirely — the
 * deterministic selector (`buildDeterministicEditionPlays`) is now the SOLE path. The ranked
 * candidates + prefetched chains + dossiers contain every number the plays need; the only
 * Claude-exclusive step was "choose + phrase", which the selector already rebuilds from the
 * same scored data.
 *
 * All post-synthesis gates (sector concentration, geometry rejection audit, funnel reporting)
 * are preserved identically.
 */
import type { TickerDossier } from "./dossier";
import { buildDeterministicEditionPlays } from "./deterministic-edition";
import { buildMarketRecap, type EngineState } from "./format";
import type { MarketWideContext } from "./market-wide";
import type { SpxDeskSummary, FlowTapeSummary } from "@/lib/platform/types";
import type { PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import {
  fetchEditionChains,
} from "./option-chain-prompt";
import {
  applyPremiumCapToPlay,
  type ClaudePlayRaw,
  validatePlayGeometry,
  capSectorConcentration,
  SECTOR_CONCENTRATION_MAX_PER_SECTOR,
} from "./play-constraints";
import {
  EDITION_CHAIN_PREFETCH,
  EDITION_SYNTHESIS_OVERSHOOT,
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
} from "./constants";
import type { GroundingSummary } from "./grounding";
import type { ScoredCandidate } from "./scorer";
import { assignNighthawkTier, nhTierInputFromScored, nhConvictionRank } from "./nighthawk-tiers";
import type { PlaybookPlay } from "./types";
import type { HuntMode } from "./types";
import type { NighthawkRejectionDetail } from "./play-outcomes";

export function mapClaudePlayToEdition(play: ClaudePlayRaw, rank: number, dossiers: Record<string, TickerDossier>): PlaybookPlay {
  const ticker = String(play.ticker ?? "?").toUpperCase();
  const dossier = dossiers[ticker];
  const playType = String(play.type ?? "stock").toLowerCase();
  const pinnedScore = dossier?.scored?.score ?? Number(play.score ?? 0);
  const modelConviction = String(play.conviction ?? "B");
  const scored = dossier?.scored;
  const deterministicConviction = scored
    ? assignNighthawkTier(nhTierInputFromScored(scored)).tier
    : assignNighthawkTier({ score: pinnedScore, confirmingSignals: null, earningsRisk: false }).tier;
  const conviction =
    nhConvictionRank(modelConviction) < nhConvictionRank(deterministicConviction)
      ? modelConviction
      : deterministicConviction;
  const scoredDirection = dossier?.scored?.direction;
  const modelDirection = String(play.direction ?? "LONG");
  if (
    scoredDirection &&
    (scoredDirection === "short") !== modelDirection.toUpperCase().includes("SHORT")
  ) {
    console.warn(
      `[nighthawk/edition] ${ticker}: model direction ${modelDirection} diverges from scored flow direction ${scoredDirection}`
    );
  }
  const base: PlaybookPlay = {
    rank,
    ticker,
    direction: modelDirection,
    conviction,
    play_type: playType === "index" ? "index" : playType === "etf" ? "etf" : "stock",
    thesis: String(play.key_signal ?? play.bias ?? ""),
    key_signal: String(play.key_signal ?? ""),
    entry_range: [play.entry_condition, play.entry_range].filter(Boolean).join(" | ") || "-",
    target: [play.target, play.target_note].filter(Boolean).join(" - ") || "-",
    stop: [play.stop, play.stop_note].filter(Boolean).join(" - ") || "-",
    options_play: String(play.options_play ?? "-"),
    risk_note: String(play.risk_note ?? ""),
    score: pinnedScore,
    flow_streak_days: dossier?.flow_streak.streak_days ?? undefined,
    iv_rank: dossier?.iv_rank ?? undefined,
  };
  return applyPremiumCapToPlay(base, play);
}

export async function generateEditionPlays(params: {
  ctx: MarketWideContext;
  dossiers: TickerDossier[];
  ranked: ScoredCandidate[];
  huntMode?: HuntMode;
  maxDte?: number;
  engineState?: EngineState | null;
  spxDesk?: SpxDeskSummary | null;
  flowTape?: FlowTapeSummary | null;
  playOutcomes?: PlayOutcomeStats | null;
}): Promise<{
  plays: PlaybookPlay[];
  recap: ReturnType<typeof buildMarketRecap>;
  raw: string | null;
  funnel?: {
    parsed: number;
    stock: number;
    geometry_ok: number;
    premium_ok: number;
    strike_ok: number;
    grounded: number;
    dropped_ungrounded: number;
    flagged: number;
  };
  grounding?: GroundingSummary;
  geometryRejected?: Array<{ ticker: string; drops: string[]; play: PlaybookPlay; scored: ScoredCandidate | null }>;
  stageRejected?: Array<{ ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored: ScoredCandidate | null }>;
}> {
  const recap = buildMarketRecap(params.ctx);
  const dossierMap = Object.fromEntries(params.dossiers.map((d) => [d.ticker, d]));

  const detTickers = params.ranked.slice(0, EDITION_CHAIN_PREFETCH).map((s) => s.ticker);
  const detChains = await fetchEditionChains({ stockTickers: detTickers, dossiers: params.dossiers });
  const { plays: detPlays, funnel: detFunnel } = buildDeterministicEditionPlays({
    ranked: params.ranked,
    dossierMap,
    chains: detChains,
    target: EDITION_SYNTHESIS_OVERSHOOT,
  });

  // SECTOR CONCENTRATION CAP: nothing stopped the whole book being five correlated
  // same-sector longs. Applied on the deterministic output so a lower-ranked play
  // from another sector backfills the freed slot.
  const sectorByTicker = Object.fromEntries(
    params.dossiers.map((d) => [d.ticker.toUpperCase(), d.sector ?? null])
  );
  const sectorCap = capSectorConcentration(detPlays, sectorByTicker);
  const stageRejected: Array<{ ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored: ScoredCandidate | null }> = [];
  if (sectorCap.dropped.length) {
    console.warn(
      "[nighthawk/edition] sector-concentration cap dropped:",
      sectorCap.dropped.map((d) => `${d.ticker} (${d.sector})`)
    );
    for (const d of sectorCap.dropped) {
      stageRejected.push({
        ticker: d.ticker,
        play: d.play,
        detail: {
          stage: "sector_concentration",
          sector: d.sector,
          already_filled: d.filled,
          max_per_sector: SECTOR_CONCENTRATION_MAX_PER_SECTOR,
        },
        scored: dossierMap[d.ticker]?.scored ?? null,
      });
    }
  }
  const capped = sectorCap.plays.map((p, i) => ({ ...p, rank: i + 1 }));

  return {
    plays: capped,
    recap,
    raw: null,
    stageRejected: stageRejected.length ? stageRejected : undefined,
    funnel: {
      parsed: detFunnel.candidates,
      stock: detFunnel.contract_ok,
      geometry_ok: detFunnel.geometry_ok,
      premium_ok: detFunnel.premium_ok,
      strike_ok: detFunnel.contract_ok,
      grounded: detFunnel.grounded,
      dropped_ungrounded: detFunnel.dropped_ungrounded,
      flagged: 0,
    },
  };
}
